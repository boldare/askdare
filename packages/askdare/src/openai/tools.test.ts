import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { type Bot, defineBot } from '../bot/define-bot';
import type { ModelGateway, TurnRequest } from '../gateway';
import type { ProtocolEvent } from '../protocol/events';
import { defineTool, type Tool } from '../tools/define-tool';
import { createOpenAIGateway } from './gateway';
import {
  type FixtureEvent,
  OPENAI_TEST_BASE_URL,
  responseObject,
  sseStream,
  textTurnEvents,
} from './testing/msw';

const server = setupServer();
let gateway: ModelGateway;
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

const VISITOR = `v_${'ab'.repeat(16)}`;

function callStep(calls: readonly { id: string; name: string; args: string }[]): FixtureEvent[] {
  return [
    { type: 'response.created', response: { id: 'resp', status: 'in_progress' } },
    ...calls.map(
      (call, index): FixtureEvent => ({
        type: 'response.output_item.done',
        output_index: index,
        item: {
          type: 'function_call',
          id: `fc_${call.id}`,
          call_id: call.id,
          name: call.name,
          arguments: call.args,
          status: 'completed',
        },
      }),
    ),
    {
      type: 'response.completed',
      response: responseObject('completed', { input: 50, cached: 0, output: 10 }),
    },
  ];
}

/** Answers POST /responses with the given steps in order and records every request body. */
function steps(...responses: (FixtureEvent[] | (() => Response))[]): Record<string, unknown>[] {
  const bodies: Record<string, unknown>[] = [];
  server.use(
    http.post(`${OPENAI_TEST_BASE_URL}/responses`, async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      const next = responses[Math.min(bodies.length, responses.length) - 1];
      if (typeof next === 'function') return next();
      return new HttpResponse(sseStream(next ?? []), {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }),
  );
  return bodies;
}

function makeBot(tools: Tool[], maxSteps = 5): Bot {
  return defineBot({
    id: 'support',
    model: 'm',
    instructions: 'Use tools.',
    tools,
    limits: { maxSteps },
  });
}

async function run(bot: Bot): Promise<{ events: ProtocolEvent[]; reason: string }> {
  const events: ProtocolEvent[] = [];
  const request: TurnRequest = {
    bot,
    conversationId: 'conv_1',
    text: 'Hi',
    context: { locale: 'pl' },
    safetyIdentifier: 'h'.repeat(64),
    visitorId: VISITOR,
    messageId: 'msg_t',
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
  };
  const result = await gateway.runTurn(request);
  return { events, reason: result.reason };
}

const outputsOf = (body: Record<string, unknown> | undefined) =>
  ((body?.['input'] ?? []) as { type: string; call_id: string; output: string }[]).map((item) => ({
    call_id: item.call_id,
    output: JSON.parse(item.output) as unknown,
  }));

const echo = defineTool({
  name: 'echo',
  description: 'Echoes a word.',
  input: z.object({ word: z.string(), times: z.number().int().nullable() }),
  execute: ({ word, times }, context) => ({
    said: word.repeat(times ?? 1),
    locale: context.locale,
    visitor: context.visitorId,
  }),
});

describe('defineTool', () => {
  it('rejects fields strict mode would refuse, and bad names', () => {
    expect(() =>
      defineTool({
        name: 'x',
        description: 'd',
        input: z.object({ a: z.string().optional() }),
        execute: () => 1,
      }),
    ).toThrow(/a is optional; use \.nullable\(\)/);
    expect(() =>
      defineTool({ name: 'bad name', description: 'd', input: z.object({}), execute: () => 1 }),
    ).toThrow(/name must be/);
    expect(() =>
      defineTool({
        name: 'x',
        description: 'd',
        input: z.object({ list: z.array(z.object({ b: z.number().default(1) })) }),
        execute: () => 1,
      }),
    ).toThrow(/list\[\]\.b is optional/);
  });

  it('rejects duplicate tool names on a bot', () => {
    expect(() => makeBot([echo, echo])).toThrow(/unique names/);
  });
});

describe('tool loop', () => {
  it('sends no tools for bots without tools', async () => {
    const bodies = steps(textTurnEvents(['Hi!']));
    await run(defineBot({ id: 'plain', model: 'm', instructions: 'x' }));
    expect(bodies[0]).not.toHaveProperty('tools');
    expect(bodies[0]).not.toHaveProperty('tool_choice');
  });

  it('executes a call with verified context and answers in the next step', async () => {
    const bodies = steps(
      callStep([{ id: 'c1', name: 'echo', args: '{"word":"ha","times":2}' }]),
      textTurnEvents(['Done.']),
    );
    const { events, reason } = await run(makeBot([echo]));
    expect(bodies[0]).toMatchObject({
      tool_choice: 'auto',
      parallel_tool_calls: true,
      tools: [{ name: 'echo', strict: true }],
    });
    expect(outputsOf(bodies[1])).toEqual([
      { call_id: 'c1', output: { said: 'haha', locale: 'pl', visitor: VISITOR } },
    ]);
    expect(events.filter((event) => event.type === 'tool.status')).toEqual([
      { type: 'tool.status', messageId: 'msg_t', callId: 'c1', name: 'echo', state: 'running' },
      { type: 'tool.status', messageId: 'msg_t', callId: 'c1', name: 'echo', state: 'done' },
    ]);
    expect(reason).toBe('completed');
  });

  it('reports invalid arguments, unknown tools, failures and timeouts to the model, not the visitor', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = defineTool({
      name: 'fails',
      description: 'd',
      input: z.object({}),
      execute: () => {
        throw new Error('db password leaked');
      },
    });
    const slow = defineTool({
      name: 'slow',
      description: 'd',
      input: z.object({}),
      timeoutMs: 100,
      execute: () => new Promise(() => {}),
    });
    const bodies = steps(
      callStep([
        { id: 'a', name: 'echo', args: '{"word":3}' },
        { id: 'b', name: 'nope', args: '{}' },
        { id: 'c', name: 'fails', args: '{}' },
        { id: 'd', name: 'slow', args: '{}' },
        { id: 'e', name: 'echo', args: 'not json' },
      ]),
      textTurnEvents(['Sorry.']),
    );
    const { events } = await run(makeBot([echo, failing, slow]));
    const outputs = outputsOf(bodies[1]);
    expect(outputs.map((item) => item.call_id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(outputs[0]?.output).toMatchObject({
      error: expect.stringContaining('Invalid arguments'),
    });
    expect(outputs[1]?.output).toEqual({ error: 'Unknown tool "nope".' });
    expect(outputs[2]?.output).toEqual({ error: 'The tool failed.' });
    expect(outputs[3]?.output).toEqual({ error: 'The tool timed out.' });
    expect(outputs[4]?.output).toEqual({ error: 'Arguments were not valid JSON.' });
    expect(JSON.stringify(bodies[1])).not.toContain('db password');
    expect(JSON.stringify(events)).not.toContain('db password');
    expect(
      events.filter((event) => event.type === 'tool.status' && event.state === 'error'),
    ).toHaveLength(5);
    consoleError.mockRestore();
  });

  it('runs parallel calls concurrently', async () => {
    const wait = defineTool({
      name: 'wait',
      description: 'd',
      input: z.object({}),
      execute: () => new Promise((resolve) => setTimeout(() => resolve('ok'), 80)),
    });
    steps(
      callStep([
        { id: 'x', name: 'wait', args: '{}' },
        { id: 'y', name: 'wait', args: '{}' },
      ]),
      textTurnEvents(['ok']),
    );
    const started = performance.now();
    await run(makeBot([wait]));
    expect(performance.now() - started).toBeLessThan(150);
  });

  it('replaces oversized results with an error', async () => {
    const big = defineTool({
      name: 'big',
      description: 'd',
      input: z.object({}),
      execute: () => 'x'.repeat(20_000),
    });
    const bodies = steps(callStep([{ id: 'b', name: 'big', args: '{}' }]), textTurnEvents(['ok']));
    await run(makeBot([big]));
    expect(outputsOf(bodies[1])).toEqual([
      { call_id: 'b', output: { error: 'The tool returned too much data.' } },
    ]);
  });

  it('forces a text answer on the last step', async () => {
    const loop = callStep([{ id: 'l', name: 'echo', args: '{"word":"a","times":null}' }]);
    const bodies = steps(loop, loop, textTurnEvents(['Final.']));
    const { reason } = await run(makeBot([echo], 3));
    expect(bodies.map((body) => body['tool_choice'])).toEqual(['auto', 'auto', 'none']);
    expect(reason).toBe('completed');
  });

  it('repairs a call an earlier, interrupted turn left without output', async () => {
    const bodies = steps(
      () =>
        HttpResponse.json(
          {
            error: {
              message: 'No tool output found for function call call_old.',
              type: 'invalid_request_error',
              param: 'input',
              code: null,
            },
          },
          { status: 400 },
        ),
      textTurnEvents(['Hello again.']),
    );
    const { reason } = await run(makeBot([echo]));
    expect(reason).toBe('completed');
    expect(bodies[1]?.['input']).toEqual([
      {
        type: 'function_call_output',
        call_id: 'call_old',
        output: JSON.stringify({ error: 'The previous request was interrupted.' }),
      },
      { role: 'user', content: 'Hi' },
    ]);
  });
});
