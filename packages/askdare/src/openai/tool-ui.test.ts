import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { type Bot, createBot } from '../bot/define-bot';
import type { ModelGateway } from '../gateway';
import type { ProtocolEvent, ToolUiEvent } from '../protocol/events';
import { defineTool, type Tool } from '../tools/define-tool';
import { createOpenAIGateway } from './gateway';
import { testConversations } from './testing/conversations';
import {
  type FixtureEvent,
  OPENAI_TEST_BASE_URL,
  responseObject,
  sseStream,
  textTurnEvents,
} from './testing/msw';

// Tool UI payloads in a live turn (ADR-0017).
const server = setupServer();
let gateway: ModelGateway;
const conversations = testConversations();
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
  gateway = createOpenAIGateway({
    apiKey: 'sk-test',
    baseURL: OPENAI_TEST_BASE_URL,
    maxRetries: 0,
  });
});
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

const slots = defineTool({
  name: 'find_slots',
  description: 'Free slots on a day.',
  input: z.object({ day: z.string() }),
  execute: async ({ day }) => {
    // The first call finishes last, so the order can't come from finishing times.
    if (day === 'mon') await new Promise((resolve) => setTimeout(resolve, 20));
    return { day, slots: ['9:00'], costCenter: 'internal-7' };
  },
  ui: (result) => ({ day: result.day, slots: result.slots }),
});
const plain = defineTool({
  name: 'plain',
  description: 'No card.',
  input: z.object({}),
  execute: () => 'ok',
});
const failing = defineTool({
  name: 'failing',
  description: 'Fails.',
  input: z.object({}),
  execute: () => {
    throw new Error('down');
  },
  ui: () => ({ never: true }),
});
const throwing = defineTool({
  name: 'throwing',
  description: 'ui throws.',
  input: z.object({}),
  execute: () => ({ secret: 'payload-text' }),
  ui: () => {
    throw new Error('no card');
  },
});
const huge = defineTool({
  name: 'huge',
  description: 'Too big a card.',
  input: z.object({}),
  execute: () => ({ secret: 'payload-text' }),
  ui: (result) => ({ text: result.secret.repeat(1000) }),
});

const call = (id: string, name: string, args = '{}', index = 0): FixtureEvent => ({
  type: 'response.output_item.done',
  output_index: index,
  item: {
    type: 'function_call',
    id: `fc_${id}`,
    call_id: id,
    name,
    arguments: args,
    status: 'completed',
  },
});

const callStep = (...calls: FixtureEvent[]): FixtureEvent[] => [
  { type: 'response.created', response: { id: 'resp', status: 'in_progress' } },
  ...calls,
  {
    type: 'response.completed',
    response: responseObject('completed', { input: 50, cached: 0, output: 10 }),
  },
];

function serve(steps: readonly FixtureEvent[][]): void {
  let served = 0;
  server.use(
    http.post(`${OPENAI_TEST_BASE_URL}/responses`, () => {
      served += 1;
      return new HttpResponse(sseStream(steps[Math.min(served, steps.length) - 1] ?? []), {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }),
  );
}

async function run(tools: readonly Tool[], maxSteps = 4): Promise<ProtocolEvent[]> {
  const bot: Bot = createBot({
    id: 'support',
    model: 'm',
    instructions: 'Help.',
    tools,
    limits: { maxSteps },
  });
  const events: ProtocolEvent[] = [];
  await gateway.runTurn({
    bot,
    conversationId: 'conv_1',
    conversations: conversations.store,
    text: 'Book a call',
    context: { locale: 'en' },
    safetyIdentifier: 'h'.repeat(64),
    visitorId: `v_${'ab'.repeat(16)}`,
    messageId: 'msg_t',
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
  });
  return events;
}

const cards = (events: readonly ProtocolEvent[]): ToolUiEvent[] =>
  events.filter((event): event is ToolUiEvent => event.type === 'tool.ui');

describe('tool UI payloads in a turn', () => {
  it("sends each successful call's payload in call order, after the step's statuses", async () => {
    serve([
      callStep(
        call('c1', 'find_slots', '{"day":"mon"}', 0),
        call('c2', 'plain', '{}', 1),
        call('c3', 'find_slots', '{"day":"tue"}', 2),
      ),
      textTurnEvents(['Two days.']),
    ]);
    const events = await run([slots, plain]);
    expect(cards(events)).toEqual([
      {
        type: 'tool.ui',
        messageId: 'msg_t',
        callId: 'c1',
        name: 'find_slots',
        data: { day: 'mon', slots: ['9:00'] },
      },
      {
        type: 'tool.ui',
        messageId: 'msg_t',
        callId: 'c3',
        name: 'find_slots',
        data: { day: 'tue', slots: ['9:00'] },
      },
    ]);
    const lastStatus = events.findLastIndex((event) => event.type === 'tool.status');
    const firstCard = events.findIndex((event) => event.type === 'tool.ui');
    expect(firstCard).toBeGreaterThan(lastStatus);
    expect(firstCard).toBeLessThan(events.findIndex((event) => event.type === 'text.delta'));
    expect(JSON.stringify(events)).not.toContain('internal-7');
  });

  it('sends nothing for a failed call, a throwing ui or one over the limits, naming only the tool', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    serve([
      callStep(
        call('c1', 'failing', '{}', 0),
        call('c2', 'throwing', '{}', 1),
        call('c3', 'huge', '{}', 2),
      ),
      textTurnEvents(['Sorry.']),
    ]);
    const events = await run([failing, throwing, huge]);
    expect(cards(events)).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: 'text.delta', delta: 'Sorry.' });
    const messages = logged.mock.calls.map((args) => String(args[0]));
    expect(messages.some((message) => message.includes('ui of tool "throwing" failed'))).toBe(true);
    expect(messages.some((message) => message.includes('ui of tool "huge" was dropped'))).toBe(
      true,
    );
    expect(JSON.stringify(logged.mock.calls)).not.toContain('payload-text');
  });

  it("sends every step's payloads in call order and leaves the cap to the server", async () => {
    const days = ['mon', 'tue', 'wed'];
    serve([
      callStep(
        ...days.map((day, index) => call(`a${index}`, 'find_slots', `{"day":"${day}"}`, index)),
      ),
      callStep(
        ...days.map((day, index) => call(`b${index}`, 'find_slots', `{"day":"${day}"}`, index)),
      ),
      textTurnEvents(['Six lookups.']),
    ]);
    const events = await run([slots]);
    expect(cards(events).map((event) => event.callId)).toEqual([
      'a0',
      'a1',
      'a2',
      'b0',
      'b1',
      'b2',
    ]);
  });

  it('sends nothing for a call ID the protocol could not carry', async () => {
    serve([
      callStep(call('c'.repeat(129), 'find_slots', '{"day":"mon"}')),
      textTurnEvents(['Mon.']),
    ]);
    expect(cards(await run([slots]))).toEqual([]);
  });

  it('logs a RangeError of the developer as a failure, with the error', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dates = defineTool({
      name: 'dates',
      description: 'Bad date.',
      input: z.object({}),
      execute: () => ({ at: 'not a date' }),
      ui: (result) => ({ at: new Date(result.at).toISOString() }),
    });
    serve([callStep(call('c1', 'dates')), textTurnEvents(['Done.'])]);
    await run([dates]);
    const [message, error] = logged.mock.calls[0] ?? [];
    expect(String(message)).toContain('ui of tool "dates" failed');
    expect(error).toBeInstanceOf(RangeError);
  });
});
