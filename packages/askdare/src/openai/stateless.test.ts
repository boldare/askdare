import { readFileSync } from 'node:fs';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { type BotDefinition, createBot } from '../bot/define-bot';
import { itemHistory } from '../conversations/history';
import { memoryConversations } from '../conversations/memory';
import type { ConversationStore, PositionedItem, StoredItem } from '../conversations/port';
import type { ModelGateway, TurnRequest } from '../gateway';
import type { FeedbackHandle, ProtocolEvent } from '../protocol/events';
import { decodeEvent, SseParser } from '../protocol/sse';
import { streamTurn } from '../server/stream-turn';
import { defineTool, readToolUi } from '../tools/define-tool';
import { readSuggestedReplies, SUGGEST_REPLIES } from '../tools/suggest-replies';
import { createOpenAIGateway } from './gateway';
import { modelFamily } from './replay';
import { type FixtureEvent, OPENAI_TEST_BASE_URL, sseStream, textTurnEvents } from './testing/msw';

/**
 * Stateless turns from an item store (ADR-0024, decision 3): every request replays the stored
 * conversation with `store: false`, and the turn appends what it produces in an order that never
 * stores a call without its output.
 */
const fixture = (name: string): string =>
  readFileSync(new URL(`./testing/fixtures/${name}.sse`, import.meta.url), 'utf8');

const server = setupServer();
let gateway: ModelGateway;
let bodies: Record<string, unknown>[];
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
  gateway = createOpenAIGateway({
    apiKey: 'sk-test',
    baseURL: OPENAI_TEST_BASE_URL,
    maxRetries: 0,
  });
});
beforeEach(() => {
  bodies = [];
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

type Served = readonly FixtureEvent[] | string | (() => Response);

/** Answers each `POST /responses` with the next stream, in order, and records the bodies. */
function serve(...responses: Served[]): void {
  const queue = [...responses];
  server.use(
    http.post(`${OPENAI_TEST_BASE_URL}/responses`, async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      const next = queue.shift();
      if (next === undefined) throw new Error('No response left to serve.');
      if (typeof next === 'function') return next();
      return new HttpResponse(typeof next === 'string' ? next : sseStream(next), {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }),
  );
}

/** A step that only calls functions, in order. */
function callEvents(
  calls: readonly { readonly callId: string; readonly name: string; readonly args: unknown }[],
): FixtureEvent[] {
  return [
    { type: 'response.created', response: { id: 'resp_calls', status: 'in_progress' } },
    ...calls.map(
      ({ callId, name, args }, index): FixtureEvent => ({
        type: 'response.output_item.done',
        output_index: index,
        item: {
          id: `fc_${index}`,
          type: 'function_call',
          status: 'completed',
          call_id: callId,
          name,
          arguments: JSON.stringify(args),
        },
      }),
    ),
    {
      type: 'response.completed',
      response: {
        id: 'resp_calls',
        object: 'response',
        status: 'completed',
        output: [],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    },
  ];
}

/** A text answer whose response also carries these output items before the message. */
function answerWith(text: string, before: readonly Record<string, unknown>[]): FixtureEvent[] {
  const events = textTurnEvents([text]);
  const message = events.find((event) => event.type === 'response.output_item.done')?.['item'];
  return events.map((event) => {
    if (event.type !== 'response.completed') return event;
    const response = event['response'] as Record<string, unknown>;
    return { ...event, response: { ...response, output: [...before, message] } };
  });
}

const ENCRYPTED = {
  id: 'rs_1',
  type: 'reasoning',
  summary: [],
  encrypted_content: 'gAAAA-opaque',
};

const weather = defineTool({
  name: 'get_weather',
  description: 'Current weather for a city.',
  input: z.object({ city: z.string() }),
  execute: ({ city }) => ({ city, tempC: 12 }),
  ui: (result) => ({ tempC: result.tempC }),
});

function makeBot(definition: Partial<BotDefinition> = {}) {
  return createBot({
    id: 'support',
    model: 'gpt-6.1-terra',
    instructions: 'Be brief.',
    ...definition,
  });
}

async function newConversation(store: ConversationStore = memoryConversations()) {
  const conversationId = await store.create({ botId: 'support', owner: 'visitor:test' });
  return { store, conversationId };
}

function turn(
  where: { readonly store: ConversationStore; readonly conversationId: string },
  overrides: Partial<TurnRequest> = {},
) {
  const events: ProtocolEvent[] = [];
  const result = gateway.runTurn({
    bot: makeBot(),
    conversationId: where.conversationId,
    conversations: where.store,
    text: 'Hi',
    context: { locale: 'en' },
    safetyIdentifier: 'a'.repeat(64),
    visitorId: `v_${'0f'.repeat(16)}`,
    messageId: 'msg_r',
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
    ...overrides,
  });
  return { result, events };
}

const stored = async (where: {
  readonly store: ConversationStore;
  readonly conversationId: string;
}): Promise<readonly PositionedItem[]> => (await where.store.page(where.conversationId)).items;

const inputOf = (body: Record<string, unknown> | undefined): unknown[] =>
  (body?.['input'] ?? []) as unknown[];

/** Every call has its output, right after the step's calls. */
function expectNoDanglingCall(items: readonly StoredItem[]): void {
  const calls = items.flatMap((item) => (item.type === 'call' ? [item.callId] : []));
  const outputs = items.flatMap((item) => (item.type === 'call_output' ? [item.callId] : []));
  expect(outputs.toSorted()).toEqual(calls.toSorted());
}

describe('stateless turns from an item store', () => {
  it('sends store:false with the whole conversation, and no conversation or truncation', async () => {
    const where = await newConversation();
    serve(fixture('text-turn'), textTurnEvents(['Again.']));
    const first = await turn(where).result;
    await turn(where, { text: 'Once more' }).result;

    expect(bodies[0]).toMatchObject({ store: false, input: [{ role: 'user', content: 'Hi' }] });
    expect(bodies[0]).not.toHaveProperty('conversation');
    expect(bodies[0]).not.toHaveProperty('truncation');
    expect(inputOf(bodies[1])).toEqual([
      { role: 'user', content: 'Hi' },
      {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        phase: 'final_answer',
        content: [
          {
            type: 'output_text',
            text: 'The sea shimmered beneath the morning sun.',
            annotations: [],
          },
        ],
      },
      { role: 'user', content: 'Once more' },
    ]);
    const items = await stored(where);
    expect(items.map((item) => item.type)).toEqual(['message', 'message', 'message', 'message']);
    // Visitors rate the answer by its stored ID, not OpenAI's.
    expect(first.answerItemId).toBe(items[1]?.id);
    expect(first.answerItemId).toMatch(/^itm_/);
  });

  it('replays every stored item as the same JSON, across steps and turns', async () => {
    const where = await newConversation();
    serve(
      fixture('function-call'),
      textTurnEvents(['It is 12°C.']),
      textTurnEvents(['Still 12°C.']),
    );
    const bot = makeBot({ tools: [weather] });
    await turn(where, { bot }).result;
    await turn(where, { bot, text: 'And now?' }).result;

    // The prompt cache needs an unchanged prefix (reasoning guide, "Keep the prefix unchanged").
    const step2 = inputOf(bodies[1]);
    const nextTurn = inputOf(bodies[2]);
    expect(step2).toHaveLength(3);
    expect(nextTurn.slice(0, step2.length)).toEqual(step2);
    expect(nextTurn).toHaveLength(5);
  });

  it("stores each step's items with the outputs of its calls in one append, parallel calls included", async () => {
    const where = await newConversation();
    const append = vi.spyOn(where.store, 'append');
    serve(
      callEvents([
        { callId: 'call_a', name: 'get_weather', args: { city: 'Warsaw' } },
        { callId: 'call_b', name: 'get_weather', args: { city: 'Oslo' } },
      ]),
      textTurnEvents(['Warm in both.']),
    );
    const { result, events } = turn(where, { bot: makeBot({ tools: [weather] }) });
    await result;

    expect(append.mock.calls.map(([, items]) => items.map((item) => item.type))).toEqual([
      ['message'],
      ['call', 'call', 'call_output', 'call_output'],
      ['message'],
    ]);
    // Each append expects the version the turn last wrote.
    expect(append.mock.calls.map(([, , options]) => options?.expect)).toEqual([0, 1, 5]);
    const items = await stored(where);
    expectNoDanglingCall(items);
    expect(items.flatMap((item) => (item.type === 'call_output' ? [item.callId] : []))).toEqual([
      'call_a',
      'call_b',
    ]);
    expect(events.filter((event) => event.type === 'tool.ui')).toHaveLength(2);
    // The second request sees both calls with their outputs.
    expect(inputOf(bodies[1]).map((item) => (item as { type?: string }).type)).toEqual([
      undefined,
      'function_call',
      'function_call',
      'function_call_output',
      'function_call_output',
    ]);
  });

  it("stores the visitor's attachments and the page's description with their message", async () => {
    const where = await newConversation();
    serve(textTurnEvents(['A red square.']));
    await turn(where, {
      bot: makeBot({ attachments: {} }),
      text: 'What is this?',
      pageContext: 'Pricing page',
      attachments: [
        { fileId: 'file-img', kind: 'image' },
        { fileId: 'file-pdf', kind: 'pdf' },
      ],
    }).result;

    expect(inputOf(bodies[0])).toEqual([
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: expect.stringContaining('Pricing page') },
          { type: 'input_text', text: 'What is this?' },
          { type: 'input_image', file_id: 'file-img', detail: 'auto' },
          { type: 'input_file', file_id: 'file-pdf' },
        ],
      },
    ]);
    const history = await itemHistory(where.store)(where.conversationId, {});
    expect(history[0]).toMatchObject({ role: 'user', text: 'What is this?', attachments: 2 });
    expect(await where.store.delete(where.conversationId)).toEqual({
      fileIds: ['file-img', 'file-pdf'],
    });
  });

  it('stores reply options with the answer, and history offers them again', async () => {
    const where = await newConversation();
    serve(
      textTurnEvents(['Basic or Pro?'], {
        extra: [
          {
            type: 'response.output_item.done',
            output_index: 1,
            item: {
              id: 'fc_s',
              type: 'function_call',
              status: 'completed',
              call_id: 'call_s',
              name: SUGGEST_REPLIES,
              arguments: JSON.stringify({ items: ['Basic', 'Pro'] }),
            },
          },
        ],
      }),
    );
    const append = vi.spyOn(where.store, 'append');
    const bot = makeBot({ widget: { replies: 'suggest' } });
    const result = await turn(where, { bot }).result;

    expect(result.replies).toEqual(['Basic', 'Pro']);
    // One model call: the options' call is answered and stored with the answer.
    expect(bodies).toHaveLength(1);
    expect(append.mock.calls.map(([, items]) => items.map((item) => item.type))).toEqual([
      ['message'],
      ['message', 'call', 'call_output'],
    ]);
    const history = await itemHistory(where.store)(where.conversationId, {
      replies: readSuggestedReplies,
    });
    expect(history.at(-1)).toMatchObject({ role: 'assistant', replies: ['Basic', 'Pro'] });
    expect(history.at(-1)?.id).toBe(result.answerItemId);
  });

  it("shows each answer's tool cards again in history, from the stored calls", async () => {
    const where = await newConversation();
    serve(fixture('function-call'), textTurnEvents(['It is 12°C.']));
    const bot = makeBot({ tools: [weather] });
    await turn(where, { bot }).result;

    const history = await itemHistory(where.store)(where.conversationId, {
      ui: (calls) => readToolUi(bot.tools, calls),
    });
    expect(history.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(history[1]?.ui).toEqual([
      { callId: expect.stringMatching(/^call_/), name: 'get_weather', data: { tempC: 12 } },
    ]);
  });

  it('stores citations on the text, so history needs no search results', async () => {
    const where = await newConversation();
    serve(fixture('file-search'));
    await turn(where).result;

    const items = await stored(where);
    expect(items.map((item) => item.type)).toEqual(['message', 'native', 'message']);
    const answer = items[2];
    expect(answer?.type === 'message' && answer.parts[0]).toMatchObject({
      type: 'text',
      citations: [{ title: 'askdare-handbook.md' }],
    });
    const history = await itemHistory(where.store)(where.conversationId, {});
    expect(history[1]?.citations).toEqual([
      { index: 1, title: 'askdare-handbook.md', url: undefined },
    ]);
  });

  it('keeps reasoning for the model family that wrote it and drops it for another', async () => {
    const where = await newConversation();
    serve(
      answerWith('Thought about it.', [ENCRYPTED]),
      textTurnEvents(['Same family.']),
      textTurnEvents(['Other family.']),
    );
    await turn(where).result;
    const reasoning = (await stored(where))[1];
    expect(reasoning).toMatchObject({
      type: 'native',
      provider: 'openai',
      family: 'gpt-6.1',
      data: ENCRYPTED,
    });

    await turn(where, { bot: makeBot({ model: 'gpt-6.1-sol' }), text: 'Next' }).result;
    expect(inputOf(bodies[1])).toContainEqual(ENCRYPTED);
    await turn(where, { bot: makeBot({ model: 'gpt-5.5-sol' }), text: 'Then' }).result;
    expect(inputOf(bodies[2])).not.toContainEqual(ENCRYPTED);
    expect(inputOf(bodies[2])).toHaveLength(inputOf(bodies[1]).length + 1);
  });

  describe('crashes and concurrent turns', () => {
    it('stores nothing of a step cut off while its calls ran', async () => {
      const where = await newConversation();
      const controller = new AbortController();
      serve(fixture('function-call'));
      const cut = defineTool({
        name: 'get_weather',
        description: 'Current weather for a city.',
        input: z.object({ city: z.string() }),
        // The server goes away while the tool runs.
        execute: (_input, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            controller.abort();
          }),
      });
      await expect(
        turn(where, { bot: makeBot({ tools: [cut] }), signal: controller.signal }).result,
      ).rejects.toBeDefined();

      const items = await stored(where);
      expect(items.map((item) => item.type)).toEqual(['message']);
    });

    it('leaves no call without its output when a later step fails, and the next turn runs', async () => {
      const where = await newConversation();
      serve(
        fixture('function-call'),
        () => HttpResponse.json({ error: { message: 'Server error.' } }, { status: 500 }),
        textTurnEvents(['It is 12°C.']),
      );
      const bot = makeBot({ tools: [weather] });
      await expect(turn(where, { bot }).result).rejects.toMatchObject({ code: 'upstream_error' });
      const items = await stored(where);
      expect(items.map((item) => item.type)).toEqual(['message', 'call', 'call_output']);
      expectNoDanglingCall(items);

      await turn(where, { bot, text: 'Hello?' }).result;
      // Replayed with its output: no repair, nothing left dangling.
      expect(inputOf(bodies[2]).map((item) => (item as { type?: string }).type)).toEqual([
        undefined,
        'function_call',
        'function_call_output',
        undefined,
      ]);
    });

    it('lets exactly one of two concurrent turns run', async () => {
      const memory = memoryConversations();
      // Both turns read the conversation before either writes.
      let reads = 0;
      let release: () => void = () => {};
      const bothRead = new Promise<void>((resolve) => {
        release = resolve;
      });
      const store: ConversationStore = {
        ...memory,
        async context(id, options) {
          const context = await memory.context(id, options);
          reads += 1;
          if (reads === 2) release();
          await bothRead;
          return context;
        },
      };
      const where = await newConversation(store);
      serve(textTurnEvents(['First.']), textTurnEvents(['Second.']));

      const results = await Promise.allSettled([
        turn(where, { text: 'One' }).result,
        turn(where, { text: 'Two' }).result,
      ]);
      expect(results.map((result) => result.status).toSorted()).toEqual(['fulfilled', 'rejected']);
      const lost = results.find((result) => result.status === 'rejected');
      expect(lost?.reason).toMatchObject({ code: 'rate_limited', key: 'error.rate_limited' });
      // The loser wrote nothing and never reached the model.
      expect(bodies).toHaveLength(1);
      const items = await stored(where);
      expect(items.filter((item) => item.type === 'message')).toHaveLength(2);
    });

    it('ends a turn whose conversation another turn changed, and stores nothing of its step', async () => {
      const where = await newConversation();
      serve(fixture('function-call'));
      const interloper = defineTool({
        name: 'get_weather',
        description: 'Current weather for a city.',
        input: z.object({ city: z.string() }),
        execute: async () => {
          // Another tab's message lands while this turn's tool runs.
          await where.store.append(where.conversationId, [
            {
              id: 'itm_other',
              type: 'message',
              role: 'user',
              parts: [{ type: 'text', text: 'Hey' }],
            },
          ]);
          return { tempC: 12 };
        },
      });
      await expect(
        turn(where, { bot: makeBot({ tools: [interloper] }) }).result,
      ).rejects.toMatchObject({ code: 'rate_limited' });
      const items = await stored(where);
      expect(items.map((item) => item.id)).toEqual([items[0]?.id, 'itm_other']);
      expect(bodies).toHaveLength(1);
    });
  });

  describe('output checks (ADR-0022)', () => {
    const run = async (
      onOutput: NonNullable<BotDefinition['onOutput']>,
      where: { readonly store: ConversationStore; readonly conversationId: string },
    ) => {
      const issued: string[] = [];
      const stream = streamTurn({
        gateway,
        conversations: where.store,
        owner: 'visitor:test',
        owns: () => true,
        bot: makeBot({ onOutput }),
        text: 'Hi',
        context: { locale: 'en' },
        visitorId: `v_${'0f'.repeat(16)}`,
        conversationId: where.conversationId,
        signal: new AbortController().signal,
        pseudonym: async (value) => `hmac(${value})`,
        issueResumeToken: async (id) => `resume:${id}`,
        issueFeedback: async (_id, itemId): Promise<FeedbackHandle> => {
          issued.push(itemId);
          return { handle: `feedback:${itemId}`, key: 'k' };
        },
        onError: () => {},
      });
      const parser = new SseParser();
      const decoder = new TextDecoder();
      const events: ProtocolEvent[] = [];
      for await (const chunk of stream) {
        for (const frame of parser.push(decoder.decode(chunk, { stream: true }))) {
          const decoded = decodeEvent(frame);
          if (decoded.ok) events.push(decoded.event);
        }
      }
      return { events, issued };
    };

    it("appends the note after the turn's items and rates the stored answer", async () => {
      const where = await newConversation();
      serve(textTurnEvents(['Fine answer.']));
      const { issued } = await run(() => ({ action: 'allow' }), where);

      const items = await stored(where);
      expect(items.map((item) => (item.type === 'message' ? item.role : item.type))).toEqual([
        'user',
        'assistant',
        'developer',
      ]);
      expect(issued).toEqual([items[1]?.id]);
      const history = await itemHistory(where.store)(where.conversationId, { checked: true });
      expect(history.map((message) => message.text)).toEqual(['Hi', 'Fine answer.']);
    });

    it('stores a replacement after its note, and history shows only the replacement', async () => {
      const where = await newConversation();
      serve(textTurnEvents(['Secret answer.']));
      const { events, issued } = await run(() => ({ action: 'redact', text: 'Replaced.' }), where);

      expect(JSON.stringify(events)).not.toContain('Secret');
      expect(issued).toEqual([]);
      const items = await stored(where);
      expect(items.map((item) => (item.type === 'message' ? item.role : item.type))).toEqual([
        'user',
        'assistant',
        'developer',
        'assistant',
      ]);
      const history = await itemHistory(where.store)(where.conversationId, { checked: true });
      expect(history.map((message) => message.text)).toEqual(['Hi', 'Replaced.']);
    });

    it('hides an answer no note settled', async () => {
      const where = await newConversation();
      serve(textTurnEvents(['Unchecked.']));
      await turn(where).result;
      const history = await itemHistory(where.store)(where.conversationId, { checked: true });
      expect(history.map((message) => message.text)).toEqual(['Hi']);
    });
  });
});

describe('itemHistory', () => {
  it('answers an unknown conversation as one that belongs to someone else', async () => {
    await expect(itemHistory(memoryConversations())('nope', {})).rejects.toMatchObject({
      code: 'not_found',
      key: 'error.conversationGone',
    });
  });
});

describe('modelFamily', () => {
  it('groups variants and snapshots of one model', () => {
    expect(modelFamily('gpt-6.1-terra')).toBe('gpt-6.1');
    expect(modelFamily('gpt-5.6-sol')).toBe('gpt-5.6');
    expect(modelFamily('gpt-5.6-luna-2026-09-01')).toBe('gpt-5.6');
    expect(modelFamily('gpt-5.5')).toBe('gpt-5.5');
  });
});

describe('a conversation deleted during a turn', () => {
  /** A store that, like a database, throws a plain error for a conversation it no longer has. */
  function plainErrors(): ConversationStore {
    const memory = memoryConversations();
    const known = async (id: string): Promise<void> => {
      if (!(await memory.info(id))) throw new Error('relation row missing');
    };
    return {
      ...memory,
      async context(id, options) {
        await known(id);
        return memory.context(id, options);
      },
      async append(id, items, options) {
        await known(id);
        return memory.append(id, items, options);
      },
    };
  }

  const gone = { code: 'not_found', key: 'error.conversationGone' };

  it.each([
    ['the memory store', memoryConversations],
    ['a store that throws plain errors', plainErrors],
  ])('answers as gone when %s loses it before the turn reads it', async (_, make) => {
    const where = await newConversation(make());
    await where.store.delete(where.conversationId);
    await expect(turn(where).result).rejects.toMatchObject(gone);
    expect(bodies).toHaveLength(0);
  });

  it.each([
    ['the memory store', memoryConversations],
    ['a store that throws plain errors', plainErrors],
  ])('answers as gone when %s loses it between steps', async (_, make) => {
    const where = await newConversation(make());
    serve(fixture('function-call'));
    const deleting = defineTool({
      name: 'get_weather',
      description: 'Current weather for a city.',
      input: z.object({ city: z.string() }),
      execute: async () => {
        // The visitor starts a new conversation in another tab, or a sweep removes this one.
        await where.store.delete(where.conversationId);
        return { tempC: 12 };
      },
    });
    await expect(turn(where, { bot: makeBot({ tools: [deleting] }) }).result).rejects.toMatchObject(
      gone,
    );
  });

  it('keeps any other failure of the store as it was', async () => {
    const memory = memoryConversations();
    const where = await newConversation({
      ...memory,
      append: async () => {
        throw new Error('connection reset');
      },
    });
    await expect(turn(where).result).rejects.toMatchObject({ code: 'internal_error' });
  });

  it('answers the history of a conversation the store lost as gone', async () => {
    const memory = memoryConversations();
    const store: ConversationStore = {
      ...memory,
      page: async () => {
        throw new Error('relation row missing');
      },
    };
    await expect(itemHistory(store)('nope', {})).rejects.toMatchObject(gone);
  });
});

describe('stores of other providers', () => {
  it("refuses another provider's conversation instead of sending its reference to OpenAI", async () => {
    const memory = memoryConversations();
    const where = await newConversation({
      ...memory,
      context: async () => ({ kind: 'provider', provider: 'acme', ref: 'acme_1', version: 0 }),
    });
    await expect(turn(where).result).rejects.toMatchObject({ code: 'bot_unavailable' });
    expect(bodies).toHaveLength(0);
  });
});

describe('servers that leave details out', () => {
  it('stores the answer from output items without positions or a final output list', async () => {
    const where = await newConversation();
    serve(
      textTurnEvents(['Stored.']).map((event) => {
        if (event.type !== 'response.output_item.done') return event;
        const { output_index: _index, ...rest } = event;
        return rest as FixtureEvent;
      }),
    );
    const result = await turn(where).result;
    const items = await stored(where);
    expect(items.map((item) => item.type)).toEqual(['message', 'message']);
    expect(result.answerItemId).toBe(items[1]?.id);
  });
});
