import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type Bot, type BotDefinition, createBot } from '../bot/define-bot';
import { defineForm } from '../forms/define-form';
import type { ModelGateway, TurnHandoff, TurnRequest, TurnResult } from '../gateway';
import type { ProtocolEvent } from '../protocol/events';
import { defineTool } from '../tools/define-tool';
import { HANDOFF, handoffArguments } from '../tools/handoff';
import { SHOW_FORM } from '../tools/show-form';
import { createOpenAIGateway } from './gateway';
import { testConversations } from './testing/conversations';
import {
  type FixtureEvent,
  OPENAI_TEST_BASE_URL,
  responseObject,
  sseStream,
  textTurnEvents,
} from './testing/msw';

// The reserved `handoff` (ADR-0030) and `show_form` (ADR-0031) tools against recorded streams.
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
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const offer = defineForm({
  name: 'offer',
  description: 'Contact details for a sales offer.',
  title: 'Get an offer',
  fields: [{ name: 'email', type: 'email', label: 'Email', required: true }],
});
const contact = defineForm({
  name: 'contact',
  model: false,
  title: 'Contact',
  fields: [{ name: 'email', type: 'email', label: 'Email', required: true }],
});
const echo = defineTool({
  name: 'echo',
  description: 'Echoes a word.',
  input: z.object({ word: z.string() }),
  execute: ({ word }) => word,
});

const bot = (definition: Partial<BotDefinition> = {}): Bot =>
  createBot({ id: 'support', model: 'm', instructions: 'Help.', ...definition });

const functionCall = (id: string, name: string, args: string, index = 1): FixtureEvent => ({
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

function callStep(...calls: FixtureEvent[]): FixtureEvent[] {
  return [
    { type: 'response.created', response: { id: 'resp', status: 'in_progress' } },
    ...calls,
    {
      type: 'response.completed',
      response: responseObject('completed', { input: 50, cached: 0, output: 10 }),
    },
  ];
}

interface Served {
  readonly bodies: Record<string, unknown>[];
  readonly stored: unknown[];
}

function serve(responses: readonly FixtureEvent[][]): Served {
  const served: Served = { bodies: [], stored: [] };
  server.use(
    http.post(`${OPENAI_TEST_BASE_URL}/responses`, async ({ request }) => {
      served.bodies.push((await request.json()) as Record<string, unknown>);
      const next = responses[Math.min(served.bodies.length, responses.length) - 1];
      return new HttpResponse(sseStream(next ?? []), {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }),
    http.post(`${OPENAI_TEST_BASE_URL}/conversations/conv_1/items`, async ({ request }) => {
      served.stored.push(await request.json());
      return HttpResponse.json({ object: 'list', data: [] });
    }),
  );
  return served;
}

async function run(
  subject: Bot,
  overrides: Partial<TurnRequest> = {},
): Promise<{ result: TurnResult; events: ProtocolEvent[] }> {
  const events: ProtocolEvent[] = [];
  const result = await gateway.runTurn({
    bot: subject,
    conversationId: 'conv_1',
    conversations: conversations.store,
    text: 'I want to talk to someone.',
    context: { locale: 'en' },
    safetyIdentifier: 'h'.repeat(64),
    visitorId: `v_${'ab'.repeat(16)}`,
    messageId: 'msg_t',
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
    ...overrides,
  });
  return { result, events };
}

/** A handoff hook that records the calls and answers with `answer`. */
function handoff(
  answer: Awaited<ReturnType<TurnHandoff['run']>>,
  offered = true,
): TurnHandoff & { readonly calls: { callId: string; arguments: string }[] } {
  const calls: { callId: string; arguments: string }[] = [];
  return {
    offered,
    calls,
    run: async (call) => {
      calls.push(call);
      return answer;
    },
  };
}

const outputs = (body: Record<string, unknown> | undefined) =>
  ((body?.['input'] ?? []) as { type: string; call_id: string; output: string }[])
    .filter((item) => item.type === 'function_call_output')
    .map(({ call_id, output }) => ({ call_id, output: JSON.parse(output) as unknown }));

describe('the reserved tools', () => {
  it('are offered in strict mode, from the bot settings only', async () => {
    const served = serve([textTurnEvents(['Hi'])]);
    await run(bot({ tools: [echo], handoff: true, forms: [offer, contact] }), {
      handoff: handoff({ state: 'sent' }),
      showForm: async () => ({ handle: 'h' }),
    });
    expect(served.bodies[0]?.['tool_choice']).toBe('auto');
    const tools = served.bodies[0]?.['tools'] as Record<string, unknown>[];
    expect(tools.map((tool) => tool['name'])).toEqual(['echo', HANDOFF, SHOW_FORM]);
    expect(tools[1]).toMatchObject({
      type: 'function',
      strict: true,
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            enum: ['visitor_asked', 'cannot_help', 'complaint', 'sensitive', 'sales'],
          },
        },
        required: ['reason'],
        additionalProperties: false,
      },
    });
    // Only forms the model may show, with their descriptions for the model.
    expect(tools[2]).toMatchObject({
      strict: true,
      parameters: { properties: { form: { type: 'string', enum: ['offer'] } }, required: ['form'] },
    });
    expect(tools[2]?.['description']).toContain('offer: Contact details for a sales offer.');
    expect(tools[2]?.['description']).not.toContain('contact');
  });

  it('asks for a nullable summary only when the bot passes content on', async () => {
    const served = serve([textTurnEvents(['Hi'])]);
    await run(bot({ handoff: { content: 'summary' } }), { handoff: handoff({ state: 'sent' }) });
    const [tool] = (served.bodies[0]?.['tools'] ?? []) as Record<string, unknown>[];
    expect(tool?.['parameters']).toMatchObject({
      properties: { summary: { type: ['string', 'null'] } },
      required: ['reason', 'summary'],
    });
  });

  it('leaves handoff out of the allowed tools once the conversation used its handoffs', async () => {
    const served = serve([textTurnEvents(['Hi'])]);
    await run(bot({ tools: [echo], handoff: true }), {
      handoff: handoff({ state: 'sent' }, false),
    });
    expect(served.bodies[0]?.['tool_choice']).toEqual({
      type: 'allowed_tools',
      mode: 'auto',
      tools: [{ type: 'function', name: 'echo' }],
    });
    // The tool list stays the same, for the prompt cache.
    expect(
      ((served.bodies[0]?.['tools'] ?? []) as { name: string }[]).map((tool) => tool.name),
    ).toEqual(['echo', HANDOFF]);
  });
});

describe('a handoff in a turn', () => {
  it('streams the state, answers the call with it and lets the model write on without it', async () => {
    const served = serve([
      callStep(functionCall('c1', HANDOFF, '{"reason":"complaint","summary":"Refund"}')),
      textTurnEvents(['A person will write to you.']),
    ]);
    const hook = handoff({ state: 'sent' });
    const { result, events } = await run(bot({ handoff: true }), { handoff: hook });
    expect(hook.calls).toEqual([
      { callId: 'c1', arguments: '{"reason":"complaint","summary":"Refund"}' },
    ]);
    expect(events.filter((event) => event.type !== 'text.delta')).toEqual([
      { type: 'handoff', messageId: 'msg_t', state: 'requested' },
      { type: 'handoff', messageId: 'msg_t', state: 'sent' },
    ]);
    expect(outputs(served.bodies[1])).toEqual([
      {
        call_id: 'c1',
        output: { state: 'sent', note: expect.stringContaining('reached the team') },
      },
    ]);
    // One handoff a turn: the next step no longer allows it.
    expect(served.bodies[1]?.['tool_choice']).toBe('none');
    expect(result.reason).toBe('completed');
  });

  it('shows the contact form after the requested state, and the model hears it waits', async () => {
    const served = serve([
      callStep(functionCall('c1', HANDOFF, '{"reason":"visitor_asked"}')),
      textTurnEvents(['Please fill in the form.']),
    ]);
    const form = { name: 'contact', handle: 'handle-1', purpose: 'handoff' as const };
    const { events } = await run(bot({ handoff: { form: 'contact' }, forms: [contact] }), {
      handoff: handoff({ state: 'requested', form }),
    });
    expect(events.filter((event) => event.type !== 'text.delta')).toEqual([
      { type: 'handoff', messageId: 'msg_t', state: 'requested' },
      { type: 'form', messageId: 'msg_t', callId: 'c1', ...form },
    ]);
    expect(outputs(served.bodies[1])).toEqual([
      {
        call_id: 'c1',
        output: {
          state: 'requested',
          form: 'contact',
          purpose: 'handoff',
          locale: 'en',
          note: expect.any(String),
        },
      },
    ]);
    expect(JSON.stringify(served.bodies[1])).not.toContain('handle-1');
  });

  it('answers a second handoff call in the same turn without running it', async () => {
    const served = serve([
      callStep(
        functionCall('c1', HANDOFF, '{"reason":"sales"}', 0),
        functionCall('c2', HANDOFF, '{"reason":"sales"}', 1),
      ),
      textTurnEvents(['Done.']),
    ]);
    const hook = handoff({ state: 'sent' });
    await run(bot({ handoff: true }), { handoff: hook });
    expect(hook.calls).toHaveLength(1);
    expect(outputs(served.bodies[1])).toEqual([
      { call_id: 'c1', output: expect.objectContaining({ state: 'sent' }) },
      { call_id: 'c2', output: expect.objectContaining({ state: 'limited' }) },
    ]);
  });
});

describe('show_form in a turn', () => {
  it('ends the turn when the form follows the answer, and sends the form event', async () => {
    const served = serve([
      textTurnEvents(['Here is the form.'], {
        extra: [functionCall('f1', SHOW_FORM, '{"form":"offer"}')],
      }),
    ]);
    const shown: string[] = [];
    const { result, events } = await run(bot({ forms: [offer] }), {
      showForm: async (name, callId) => {
        shown.push(`${name}:${callId}`);
        return { handle: 'handle-offer' };
      },
    });
    expect(served.bodies).toHaveLength(1);
    expect(shown).toEqual(['offer:f1']);
    expect(result).toMatchObject({ reason: 'completed', answerItemId: 'msg_out' });
    expect(events.filter((event) => event.type === 'form')).toEqual([
      {
        type: 'form',
        messageId: 'msg_t',
        callId: 'f1',
        name: 'offer',
        handle: 'handle-offer',
        purpose: 'lead',
      },
    ]);
    expect(served.stored).toEqual([
      {
        items: [
          {
            type: 'function_call_output',
            call_id: 'f1',
            output: expect.stringContaining('"status":"shown"'),
          },
        ],
      },
    ]);
    // The handle never reaches the model.
    expect(JSON.stringify(served.stored)).not.toContain('handle-offer');
  });

  it('shows one form a turn, and none the model may not show', async () => {
    const served = serve([
      callStep(
        functionCall('f1', SHOW_FORM, '{"form":"contact"}', 0),
        functionCall('f2', SHOW_FORM, '{"form":"offer"}', 1),
        functionCall('f3', SHOW_FORM, '{"form":"offer"}', 2),
      ),
      textTurnEvents(['Done.']),
    ]);
    const { events } = await run(bot({ forms: [offer, contact] }), {
      showForm: async () => ({ handle: 'h' }),
    });
    expect(
      events
        .filter((event) => event.type === 'form')
        .map((event) => event.type === 'form' && event.callId),
    ).toEqual(['f2']);
    expect(
      outputs(served.bodies[1]).map((output) => [
        output.call_id,
        (output.output as { status: string }).status,
      ]),
    ).toEqual([
      ['f1', 'not_shown'],
      ['f2', 'shown'],
      ['f3', 'not_shown'],
    ]);
    // A turn shows one form: the next step no longer allows the tool.
    expect(served.bodies[1]?.['tool_choice']).toBe('none');
  });

  it('refuses show_form when a handoff in the same answer asks for its own form', async () => {
    const served = serve([
      callStep(
        // The model asks for the lead form first; the handoff's contact form still wins.
        functionCall('f1', SHOW_FORM, '{"form":"offer"}', 0),
        functionCall('c1', HANDOFF, '{"reason":"sales"}', 1),
      ),
      textTurnEvents(['Please fill in the form.']),
    ]);
    const shown: string[] = [];
    const form = { name: 'contact', handle: 'handle-1', purpose: 'handoff' as const };
    const { events } = await run(bot({ handoff: { form: 'contact' }, forms: [offer, contact] }), {
      handoff: handoff({ state: 'requested', form }),
      showForm: async (name) => {
        shown.push(name);
        return { handle: 'handle-offer' };
      },
    });
    expect(shown).toEqual([]);
    expect(events.filter((event) => event.type === 'form')).toEqual([
      { type: 'form', messageId: 'msg_t', callId: 'c1', ...form },
    ]);
    expect(
      outputs(served.bodies[1]).map((output) => [
        output.call_id,
        (output.output as { status?: string; state?: string }).status ??
          (output.output as { state?: string }).state,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ['f1', 'not_shown'],
        ['c1', 'requested'],
      ]),
    );
  });
});

describe('handoffArguments', () => {
  it('re-validates what the model wrote', () => {
    expect(handoffArguments('{"reason":"sales","summary":null}')).toEqual({ reason: 'sales' });
    expect(handoffArguments('{"reason":"bribe"}')).toEqual({ reason: 'cannot_help' });
    expect(handoffArguments('not json')).toEqual({ reason: 'cannot_help' });
    const long = handoffArguments(JSON.stringify({ reason: 'sales', summary: 'x'.repeat(900) }));
    expect(long.summary).toHaveLength(500);
  });
});
