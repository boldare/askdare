import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { type Bot, type BotDefinition, defineBot } from '../bot/define-bot';
import type { ModelGateway, StepRecord, ToolCallRecord, TurnRequest, TurnResult } from '../gateway';
import type { ProtocolEvent } from '../protocol/events';
import { defineTool } from '../tools/define-tool';
import { readSuggestedReplies, SUGGEST_REPLIES } from '../tools/suggest-replies';
import { createOpenAIGateway } from './gateway';
import {
  type FixtureEvent,
  OPENAI_TEST_BASE_URL,
  responseObject,
  sseStream,
  textTurnEvents,
} from './testing/msw';

// Model-suggested reply options (ADR-0015, variant A): the built-in `suggest_replies` tool.
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

const OPTIONS = '{"items":["Show prices","Talk to a person"]}';

const echo = defineTool({
  name: 'echo',
  description: 'Echoes a word.',
  input: z.object({ word: z.string() }),
  execute: ({ word }) => word,
});

function suggesting(definition: Partial<BotDefinition> = {}): Bot {
  return defineBot({
    id: 'support',
    model: 'm',
    instructions: 'Help.',
    ...definition,
    widget: { replies: 'suggest', ...definition.widget },
  });
}

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

/** A step that only calls functions, before writing anything. */
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

/** A step whose answer the model marked as commentary, as GPT-5.4 and later do before a call. */
function commentaryStep(text: string, ...calls: FixtureEvent[]): FixtureEvent[] {
  return [
    { type: 'response.created', response: { id: 'resp', status: 'in_progress' } },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: {
        id: 'msg_pre',
        type: 'message',
        role: 'assistant',
        status: 'in_progress',
        phase: 'commentary',
        content: [],
      },
    },
    {
      type: 'response.output_text.delta',
      item_id: 'msg_pre',
      output_index: 0,
      content_index: 0,
      delta: text,
      logprobs: [],
    },
    ...calls,
    {
      type: 'response.completed',
      response: responseObject('completed', { input: 50, cached: 0, output: 10 }),
    },
  ];
}

interface Served {
  readonly bodies: Record<string, unknown>[];
  /** Items added to the conversation outside a model call. */
  readonly stored: unknown[];
}

/** Answers POST /responses with the given steps in order, and stores added items. */
function serve(
  responses: readonly FixtureEvent[][],
  stored: () => Response = () => HttpResponse.json({ object: 'list', data: [] }),
): Served {
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
      return stored();
    }),
  );
  return served;
}

async function run(
  bot: Bot,
  overrides: Partial<TurnRequest> = {},
): Promise<{
  result: TurnResult;
  events: ProtocolEvent[];
  modelCalls: StepRecord[];
  calls: ToolCallRecord[];
}> {
  const events: ProtocolEvent[] = [];
  const modelCalls: StepRecord[] = [];
  const calls: ToolCallRecord[] = [];
  const result = await gateway.runTurn({
    bot,
    conversationId: 'conv_1',
    text: 'Is there a free plan?',
    context: { locale: 'en' },
    safetyIdentifier: 'h'.repeat(64),
    visitorId: `v_${'ab'.repeat(16)}`,
    messageId: 'msg_t',
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
    onStep: (step) => modelCalls.push(step),
    onToolCall: (call) => calls.push(call),
    ...overrides,
  });
  return { result, events, modelCalls, calls };
}

const outputs = (body: Record<string, unknown> | undefined) =>
  ((body?.['input'] ?? []) as { type: string; call_id: string; output: string }[]).map(
    ({ type, call_id, output }) => ({ type, call_id, output: JSON.parse(output) as unknown }),
  );

describe('defineBot', () => {
  it('keeps reply options off by default and away from browsers', () => {
    expect(defineBot({ id: 'a', model: 'm', instructions: 'x' }).widget.replies).toBe('off');
    expect(suggesting().widget.replies).toBe('suggest');
    expect(() =>
      defineBot({
        id: 'a',
        model: 'm',
        instructions: 'x',
        widget: { replies: 'always' as 'suggest' },
      }),
    ).toThrow(/widget\.replies/);
  });

  it('reserves the tool name', () => {
    const impostor = defineTool({
      name: SUGGEST_REPLIES,
      description: 'Mine.',
      input: z.object({ items: z.array(z.string()) }),
      execute: () => 'ok',
    });
    expect(() => defineBot({ id: 'a', model: 'm', instructions: 'x', tools: [impostor] })).toThrow(
      /reserved name suggest_replies/,
    );
  });
});

describe('suggest_replies', () => {
  it('is offered only to bots that opted in, after their tools, in strict mode', async () => {
    const plain = serve([textTurnEvents(['Hi'])]);
    await run(defineBot({ id: 'plain', model: 'm', instructions: 'x', tools: [echo] }));
    expect(plain.bodies[0]?.['tools']).toEqual([expect.objectContaining({ name: 'echo' })]);

    const opted = serve([textTurnEvents(['Hi'])]);
    await run(suggesting({ tools: [echo], knowledge: { vectorStoreId: 'vs_1' } }));
    expect(opted.bodies[0]).toMatchObject({
      tool_choice: 'auto',
      tools: [
        { name: 'echo' },
        {
          type: 'function',
          name: 'suggest_replies',
          strict: true,
          parameters: {
            type: 'object',
            properties: { items: { type: 'array', items: { type: 'string' } } },
            required: ['items'],
            additionalProperties: false,
          },
        },
        { type: 'file_search' },
      ],
    });
  });

  it('ends the turn when the options follow the answer, answering the call without the model', async () => {
    const served = serve([
      textTurnEvents(['No, but there is a trial.'], {
        extra: [functionCall('c1', SUGGEST_REPLIES, OPTIONS)],
      }),
    ]);
    const { result, events, modelCalls, calls } = await run(suggesting());
    expect(served.bodies).toHaveLength(1);
    expect(modelCalls).toHaveLength(1);
    expect(result).toMatchObject({
      reason: 'completed',
      answerItemId: 'msg_out',
      replies: ['Show prices', 'Talk to a person'],
    });
    // A call left without output would break the next turn (spike S1), so the server stores one.
    expect(served.stored).toEqual([
      {
        items: [
          {
            type: 'function_call_output',
            call_id: 'c1',
            output: expect.stringContaining('Do not list them'),
          },
        ],
      },
    ]);
    // Neither a tool status nor a tool call in the usage report: it isn't one of the bot's tools.
    expect(events.map((event) => event.type)).toEqual(['text.delta']);
    expect(calls).toEqual([]);
  });

  it('takes one more step when the options come first, without offering the tool again', async () => {
    const served = serve([
      callStep(functionCall('c1', SUGGEST_REPLIES, OPTIONS)),
      textTurnEvents(['No, but there is a trial.']),
    ]);
    const { result, modelCalls } = await run(suggesting());
    expect(modelCalls).toHaveLength(2);
    expect(outputs(served.bodies[1])).toEqual([
      { type: 'function_call_output', call_id: 'c1', output: expect.any(String) },
    ]);
    expect(served.bodies[0]?.['tool_choice']).toBe('auto');
    expect(served.bodies[1]?.['tool_choice']).toBe('none');
    expect(served.stored).toEqual([]);
    expect(result).toMatchObject({
      reason: 'completed',
      answerItemId: 'msg_out',
      replies: ['Show prices', 'Talk to a person'],
    });
  });

  it('takes one more step when the answer was commentary, so it ends with a visible answer', async () => {
    const served = serve([
      commentaryStep('No, but ', functionCall('c1', SUGGEST_REPLIES, OPTIONS)),
      textTurnEvents(['there is a trial.']),
    ]);
    const { result } = await run(suggesting());
    expect(served.bodies).toHaveLength(2);
    expect(result).toMatchObject({
      answerItemId: 'msg_out',
      replies: ['Show prices', 'Talk to a person'],
    });
  });

  it("answers the options and the bot's tools in one round, keeping the bot's tools", async () => {
    const served = serve([
      callStep(
        functionCall('c1', 'echo', '{"word":"hi"}', 0),
        functionCall('c2', SUGGEST_REPLIES, OPTIONS),
      ),
      callStep(functionCall('c3', 'echo', '{"word":"again"}')),
      textTurnEvents(['Done.']),
    ]);
    const { result, calls } = await run(suggesting({ tools: [echo] }));
    expect(outputs(served.bodies[1]).map((output) => output.call_id)).toEqual(['c2', 'c1']);
    expect(served.bodies[1]?.['tool_choice']).toEqual({
      type: 'allowed_tools',
      mode: 'auto',
      tools: [{ type: 'function', name: 'echo' }],
    });
    expect(calls.map((call) => call.name)).toEqual(['echo', 'echo']);
    expect(result.replies).toEqual(['Show prices', 'Talk to a person']);
  });

  it("lets a tool's own options win over the model's suggestion (ADR-0015)", async () => {
    const slots = defineTool({
      name: 'find_slots',
      description: 'Free slots.',
      input: z.object({}),
      execute: () => ({ slots: ['9:00'] }),
      replies: (result) => result.slots.map((slot) => `Book ${slot}`),
    });
    serve([
      callStep(
        functionCall('c1', 'find_slots', '{}', 0),
        functionCall('c2', SUGGEST_REPLIES, OPTIONS),
      ),
      textTurnEvents(['9:00 is free.']),
    ]);
    const { result } = await run(suggesting({ tools: [slots] }));
    expect(result.replies).toEqual(['Book 9:00']);
  });

  it('stops offering the tool once a tool has defined options', async () => {
    const slots = defineTool({
      name: 'find_slots',
      description: 'Free slots.',
      input: z.object({}),
      execute: () => ({ slots: ['9:00'] }),
      replies: (result) => result.slots.map((slot) => `Book ${slot}`),
    });
    const served = serve([
      callStep(functionCall('c1', 'find_slots', '{}', 0)),
      textTurnEvents(['9:00 is free.']),
    ]);
    await run(suggesting({ tools: [slots] }));
    expect(served.bodies[0]?.['tool_choice']).toBe('auto');
    expect(served.bodies[1]?.['tool_choice']).toEqual({
      type: 'allowed_tools',
      mode: 'auto',
      tools: [{ type: 'function', name: 'find_slots' }],
    });
  });

  it('keeps the options of a turn that ends in max_output_tokens, and drops unusable arguments', async () => {
    serve([
      textTurnEvents(['Partial'], {
        status: 'incomplete',
        incompleteReason: 'max_output_tokens',
        extra: [functionCall('c1', SUGGEST_REPLIES, OPTIONS)],
      }),
    ]);
    expect((await run(suggesting())).result).toMatchObject({
      reason: 'max_output_tokens',
      replies: ['Show prices', 'Talk to a person'],
    });

    for (const args of ['{"items":', '{"options":["Yes"]}', '{"items":[]}']) {
      const served = serve([
        textTurnEvents(['Answer.'], { extra: [functionCall('c1', SUGGEST_REPLIES, args)] }),
      ]);
      const { result } = await run(suggesting());
      // Nothing usable: the server sends no event for an empty list.
      expect(result.replies ?? []).toEqual([]);
      // The call is still answered.
      expect(served.stored).toHaveLength(1);
    }
  });

  it("can't suggest on the last step, so a one-step bot never offers the tool", async () => {
    const served = serve([textTurnEvents(['Hi'])]);
    await run(suggesting({ limits: { maxSteps: 1 }, knowledge: { vectorStoreId: 'vs_1' } }));
    expect(served.bodies[0]?.['tool_choice']).toEqual({
      type: 'allowed_tools',
      mode: 'auto',
      tools: [{ type: 'file_search' }],
    });
    const plain = serve([textTurnEvents(['Hi'])]);
    await run(suggesting({ limits: { maxSteps: 1 } }));
    expect(plain.bodies[0]?.['tool_choice']).toBe('none');
  });

  it("holds the budget for the step after the options, and answers without them when it can't", async () => {
    const held: boolean[] = [];
    const served = serve([textTurnEvents(['Hi'])]);
    await run(suggesting(), {
      reserveCall: async () => {
        held.push(false);
        return false;
      },
    });
    expect(held).toEqual([false]);
    expect(served.bodies[0]?.['tool_choice']).toBe('none');
  });

  it('ends a finished answer normally when the deadline passes while its call is stored', async () => {
    const deadline = new AbortController();
    const served = serve(
      [textTurnEvents(['Answer.'], { extra: [functionCall('c1', SUGGEST_REPLIES, OPTIONS)] })],
      () => {
        deadline.abort(new DOMException('The deadline passed.', 'TimeoutError'));
        return HttpResponse.json({ error: { message: 'aborted' } }, { status: 500 });
      },
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = await run(suggesting(), { signal: deadline.signal });
    consoleError.mockRestore();
    expect(served.stored).toHaveLength(1);
    expect(result).toMatchObject({
      reason: 'completed',
      replies: ['Show prices', 'Talk to a person'],
    });
  });

  it('still ends the turn when storing the answer to the call fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const served = serve(
      [textTurnEvents(['Answer.'], { extra: [functionCall('c1', SUGGEST_REPLIES, OPTIONS)] })],
      () => HttpResponse.json({ error: { message: 'boom' } }, { status: 500 }),
    );
    const { result } = await run(suggesting());
    expect(served.stored).toHaveLength(1);
    expect(result.replies).toEqual(['Show prices', 'Talk to a person']);
    // Nothing the visitor or the model wrote reaches the log.
    expect(consoleError).toHaveBeenCalledWith(expect.not.stringContaining('Show prices'));
    consoleError.mockRestore();
  });
});

describe('readSuggestedReplies', () => {
  it("reads the latest answered call's options and ignores other tools and bad arguments", () => {
    expect(
      readSuggestedReplies([
        { name: SUGGEST_REPLIES, arguments: '{"items":["Old"]}', output: '"shown"' },
        { name: 'echo', arguments: '{"items":["Not mine"]}', output: '"x"' },
        { name: SUGGEST_REPLIES, arguments: '{"items":["Yes",3,"No"]}', output: '"shown"' },
        // Never answered: the turn didn't go on after it, so it sent no options.
        { name: SUGGEST_REPLIES, arguments: '{"items":["Unsent"]}', output: undefined },
      ]),
    ).toEqual(['Yes', 'No']);
    expect(
      readSuggestedReplies([{ name: SUGGEST_REPLIES, arguments: 'nope', output: '"shown"' }]),
    ).toBeUndefined();
    expect(readSuggestedReplies([])).toBeUndefined();
  });
});
