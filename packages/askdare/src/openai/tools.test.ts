import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';
import { type Bot, defineBot } from '../bot/define-bot';
import type { ModelGateway, StepRecord, ToolCallRecord, TurnRequest } from '../gateway';
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
import { isFailedOutput } from './tools';

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

async function run(bot: Bot): Promise<{
  events: ProtocolEvent[];
  reason: string;
  replies: readonly string[] | undefined;
  modelCalls: StepRecord[];
  calls: ToolCallRecord[];
}> {
  const events: ProtocolEvent[] = [];
  const modelCalls: StepRecord[] = [];
  const calls: ToolCallRecord[] = [];
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
    onStep: (step) => modelCalls.push(step),
    onToolCall: (call) => calls.push(call),
  };
  const result = await gateway.runTurn(request);
  return { events, reason: result.reason, replies: result.replies, modelCalls, calls };
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
    expect(() =>
      defineTool({
        name: 'x',
        description: 'd',
        input: z.object({}),
        execute: () => 1,
        replies: ['Yes'] as unknown as () => string[],
      }),
    ).toThrow(/replies must be a function/);
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
    const { events, reason, modelCalls, calls } = await run(makeBot([echo]));
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
    // Two model calls, one function call, for the turn's usage report.
    expect(modelCalls).toHaveLength(2);
    expect(calls).toEqual([
      {
        name: 'echo',
        startedAt: expect.any(Number),
        durationMs: expect.any(Number),
        outcome: 'ok',
      },
    ]);
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
    const { events, calls } = await run(makeBot([echo, failing, slow]));
    const outputs = outputsOf(bodies[1]);
    // In the order they finished.
    expect(calls.map((call) => `${call.name}:${call.outcome}`).sort()).toEqual([
      'echo:error',
      'echo:error',
      'fails:error',
      'nope:error',
      'slow:timeout',
    ]);
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
    // History recognizes the failures of a running tool by their output; the others by their
    // arguments or name, so a failed call never defines options after a reload either.
    expect(outputs.map((item) => isFailedOutput(JSON.stringify(item.output)))).toEqual([
      false,
      false,
      true,
      true,
      false,
    ]);
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
    expect(isFailedOutput(JSON.stringify(outputsOf(bodies[1])[0]?.output))).toBe(true);
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

describe('reply options from tools', () => {
  const order = defineTool({
    name: 'order_status',
    description: 'Status of an order.',
    input: z.object({ orderNumber: z.string() }),
    execute: async ({ orderNumber }) => ({
      orderNumber,
      status: orderNumber === '1' ? 'shipped' : 'unknown',
      shippedAt: new Date('2026-11-10T12:00:00Z'),
    }),
    // Typed from `execute`; the date arrives as the model saw it, a string.
    replies: (result) => {
      expectTypeOf(result).toEqualTypeOf<{
        orderNumber: string;
        status: string;
        shippedAt: string;
      }>();
      return result.status === 'shipped'
        ? ['Track the parcel', 'Cancel the order', 'Talk to a person']
        : undefined;
    },
  });

  it('turns a successful result into options for the answer, never into model input', async () => {
    const seen = vi.fn();
    const spy = defineTool({
      name: 'spy',
      description: 'd',
      input: z.object({}),
      execute: () => ({ at: new Date('2026-11-10T12:00:00Z') }),
      replies: (result) => {
        seen(result);
        return undefined;
      },
    });
    const bodies = steps(
      callStep([
        { id: 'o', name: 'order_status', args: '{"orderNumber":"1"}' },
        { id: 's', name: 'spy', args: '{}' },
      ]),
      textTurnEvents(['It shipped.']),
    );
    const { replies, reason } = await run(makeBot([order, spy]));
    expect(reason).toBe('completed');
    expect(replies).toEqual(['Track the parcel', 'Cancel the order', 'Talk to a person']);
    expect(outputsOf(bodies[1])[0]?.output).toEqual({
      orderNumber: '1',
      status: 'shipped',
      shippedAt: '2026-11-10T12:00:00.000Z',
    });
    expect(JSON.stringify(bodies)).not.toContain('Track the parcel');
    expect(seen).toHaveBeenCalledWith({ at: '2026-11-10T12:00:00.000Z' });
  });

  it('offers nothing when the tool defines none for its result, or has no replies', async () => {
    steps(
      callStep([
        { id: 'o', name: 'order_status', args: '{"orderNumber":"2"}' },
        { id: 'e', name: 'echo', args: '{"word":"a","times":null}' },
      ]),
      textTurnEvents(['No idea.']),
    );
    expect((await run(makeBot([order, echo]))).replies).toBeUndefined();
  });

  it('keeps at most 4 short, plain, distinct options and drops the rest', async () => {
    const noisy = defineTool({
      name: 'noisy',
      description: 'd',
      input: z.object({}),
      execute: () => null,
      replies: () => [
        '  Book   9:00 ',
        'Book 9:00',
        'See https://evil.example',
        'Open www.example.com',
        'x'.repeat(81),
        '',
        42 as unknown as string,
        'Line\nbreak',
        'Book 11:00',
        'Book 13:00',
        'Book 15:00',
        'Book 17:00',
      ],
    });
    steps(callStep([{ id: 'n', name: 'noisy', args: '{}' }]), textTurnEvents(['Pick one.']));
    expect((await run(makeBot([noisy]))).replies).toEqual([
      'Book 9:00',
      'Line break',
      'Book 11:00',
      'Book 13:00',
    ]);
  });

  it('offers nothing when every option is invalid, replies throws, or the call failed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const links = defineTool({
      name: 'links',
      description: 'd',
      input: z.object({}),
      execute: () => null,
      replies: () => ['https://evil.example', 'x'.repeat(81)],
    });
    const throws = defineTool({
      name: 'throws',
      description: 'd',
      input: z.object({}),
      execute: () => null,
      replies: () => {
        throw new Error('bad shape');
      },
    });
    const notArray = defineTool({
      name: 'not_array',
      description: 'd',
      input: z.object({}),
      execute: () => null,
      replies: () => 'Yes' as unknown as string[],
    });
    const replies = vi.fn(() => ['Try again']);
    const fails = defineTool({
      name: 'fails',
      description: 'd',
      input: z.object({}),
      execute: () => {
        throw new Error('down');
      },
      replies,
    });
    steps(
      callStep([
        { id: 'l', name: 'links', args: '{}' },
        { id: 't', name: 'throws', args: '{}' },
        { id: 'a', name: 'not_array', args: '{}' },
        { id: 'f', name: 'fails', args: '{}' },
        { id: 'i', name: 'order_status', args: '{"orderNumber":1}' },
      ]),
      textTurnEvents(['Sorry.']),
    );
    const result = await run(makeBot([links, throws, notArray, fails, order]));
    expect(result.reason).toBe('completed');
    expect(result.replies).toBeUndefined();
    expect(replies).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      '[askdare] replies of tool "throws" failed:',
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  it('takes the options of the last call that defined any, across parallel calls and steps', async () => {
    const pick = (name: string, items: readonly string[] | undefined) =>
      defineTool({
        name,
        description: 'd',
        input: z.object({}),
        execute: () => null,
        replies: () => items,
      });
    steps(
      callStep([{ id: 'a', name: 'first', args: '{}' }]),
      callStep([
        { id: 'b', name: 'second', args: '{}' },
        { id: 'c', name: 'none', args: '{}' },
      ]),
      textTurnEvents(['Done.']),
    );
    const bot = makeBot([pick('first', ['One']), pick('second', ['Two']), pick('none', undefined)]);
    expect((await run(bot)).replies).toEqual(['Two']);
  });
});
