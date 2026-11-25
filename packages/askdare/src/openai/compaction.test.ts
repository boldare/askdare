import { readFileSync } from 'node:fs';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type BotDefinition, createBot } from '../bot/define-bot';
import { compactionStopNote } from '../conversations/compaction';
import { historyFromItems } from '../conversations/history';
import { memoryConversations } from '../conversations/memory';
import type { ConversationStore, StoredItem } from '../conversations/port';
import { AskdareError } from '../errors';
import type { CompactionRequest, ModelGateway, TurnRequest } from '../gateway';
import { defineTool } from '../tools/define-tool';
import { COMPACTION_MAX_OUTPUT_TOKENS } from './compaction';
import { createOpenAIGateway } from './gateway';
import { OPENAI_TEST_BASE_URL, sseStream, textTurnEvents } from './testing/msw';

/**
 * Compaction for conversations in an item store (ADR-0029): a `compaction_trigger` request after
 * the turn, stored as a native item, and the replay window that starts at it.
 */
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

type Served = Record<string, unknown> | readonly Record<string, unknown>[];

/** Answers each `POST /responses` in order: an array streams, an object is a JSON response. */
function serve(...responses: Served[]): void {
  const queue = [...responses];
  server.use(
    http.post(`${OPENAI_TEST_BASE_URL}/responses`, async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      const next = queue.shift();
      if (next === undefined) throw new Error('No response left to serve.');
      if (Array.isArray(next)) {
        return new HttpResponse(sseStream(next), {
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      return HttpResponse.json(next);
    }),
  );
}

/** A `compaction_trigger` response, shaped like the recorded one. */
function compacted(encrypted = 'gAAAA-summary', usage = { input: 30_000, cached: 29_900 }) {
  return {
    id: 'resp_compact',
    object: 'response',
    status: 'completed',
    model: 'gpt-6.1-terra',
    output: [{ id: 'cmp_1', type: 'compaction', encrypted_content: encrypted }],
    usage: {
      input_tokens: usage.input,
      input_tokens_details: { cached_tokens: usage.cached },
      output_tokens: 900,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: usage.input + 900,
    },
  };
}

const lookup = defineTool({
  name: 'lookup_order',
  description: 'Looks up an order.',
  input: z.object({ orderId: z.string() }),
  execute: ({ orderId }) => ({ orderId, status: 'shipped' }),
});

function makeBot(definition: Partial<BotDefinition> = {}) {
  return createBot({
    id: 'support',
    model: 'gpt-6.1-terra',
    instructions: 'Be brief.',
    limits: { compactAt: 20_000 },
    ...definition,
  });
}

let counter = 0;
const id = (): string => {
  counter += 1;
  return `itm_test${counter}`;
};
const user = (text: string): StoredItem => ({
  id: id(),
  type: 'message',
  role: 'user',
  parts: [{ type: 'text', text }],
});
const assistant = (text: string): StoredItem => ({
  id: id(),
  type: 'message',
  role: 'assistant',
  phase: 'final_answer',
  parts: [{ type: 'text', text }],
});
const compaction = (family: string, encrypted: string): StoredItem => ({
  id: id(),
  type: 'native',
  provider: 'openai',
  family,
  kind: 'compaction',
  data: { type: 'compaction', id: `cmp_${encrypted}`, encrypted_content: encrypted },
});

async function conversation(items: readonly StoredItem[] = []) {
  const store = memoryConversations();
  const conversationId = await store.create({ botId: 'support', owner: 'visitor:test' });
  const version = items.length > 0 ? await store.append(conversationId, items) : 0;
  return { store, conversationId, version };
}

function turn(
  where: { readonly store: ConversationStore; readonly conversationId: string },
  overrides: Partial<TurnRequest> = {},
) {
  return gateway.runTurn({
    bot: makeBot(),
    conversationId: where.conversationId,
    conversations: where.store,
    text: 'Hi',
    context: { locale: 'en' },
    safetyIdentifier: 'a'.repeat(64),
    visitorId: `v_${'0f'.repeat(16)}`,
    messageId: 'msg_r',
    signal: new AbortController().signal,
    emit: () => {},
    ...overrides,
  });
}

function compact(
  where: { readonly store: ConversationStore; readonly conversationId: string },
  version: number,
  overrides: Partial<CompactionRequest> = {},
) {
  if (!gateway.compact) throw new Error('The OpenAI gateway compacts.');
  return gateway.compact({
    bot: makeBot(),
    conversationId: where.conversationId,
    conversations: where.store,
    context: { locale: 'en' },
    safetyIdentifier: 'a'.repeat(64),
    version,
    signal: new AbortController().signal,
    ...overrides,
  });
}

const inputOf = (body: Record<string, unknown> | undefined): unknown[] =>
  (body?.['input'] ?? []) as unknown[];
const stored = async (where: {
  readonly store: ConversationStore;
  readonly conversationId: string;
}) => (await where.store.page(where.conversationId)).items;

describe('compaction (ADR-0029)', () => {
  it('compacts with the turn’s model, instructions, tools and cache key, and stores the item', async () => {
    const where = await conversation([user('Where is order 4711?'), assistant('It shipped.')]);
    serve(compacted());
    const bot = makeBot({ tools: [lookup] });
    const result = await compact(where, where.version, { bot });

    expect(result.outcome).toBe('compacted');
    expect(result.usage).toEqual({
      inputTokens: 30_000,
      cachedInputTokens: 29_900,
      cacheWriteTokens: 0,
      outputTokens: 900,
      reasoningTokens: 0,
    });
    const [body] = bodies;
    expect(body).toMatchObject({
      model: 'gpt-6.1-terra',
      store: false,
      max_output_tokens: COMPACTION_MAX_OUTPUT_TOKENS,
      safety_identifier: 'a'.repeat(64),
      prompt_cache_key: 'askdare:support',
      tool_choice: 'auto',
      parallel_tool_calls: true,
    });
    expect(body?.['instructions']).toContain('Be brief.');
    expect(body?.['tools']).toEqual([expect.objectContaining({ name: 'lookup_order' })]);
    expect(body).not.toHaveProperty('stream');
    expect(body).not.toHaveProperty('conversation');
    expect(inputOf(body).at(-1)).toEqual({ type: 'compaction_trigger' });
    expect(inputOf(body)).toHaveLength(3);
    const items = await stored(where);
    expect(items).toHaveLength(3);
    expect(items[2]).toMatchObject({
      type: 'native',
      provider: 'openai',
      family: 'gpt-6.1',
      kind: 'compaction',
      data: { type: 'compaction', encrypted_content: 'gAAAA-summary' },
    });
  });

  it('stores a recorded compaction_trigger response and replays it in the next turn', async () => {
    // Recorded from gpt-6.1-terra by the live smoke test (SMOKE_RECORD_COMPACTION), redacted.
    const recorded = JSON.parse(
      readFileSync(new URL('./testing/fixtures/compaction-trigger.json', import.meta.url), 'utf8'),
    ) as Record<string, unknown>;
    const where = await conversation([user('Here is the manual…'), assistant('Seven years.')]);
    serve(recorded, textTurnEvents(['Your name is Ada.']));
    const result = await compact(where, where.version);
    expect(result).toEqual({
      outcome: 'compacted',
      usage: {
        inputTokens: 22_270,
        cachedInputTokens: 22_232,
        cacheWriteTokens: 0,
        outputTokens: 66,
        reasoningTokens: 0,
      },
    });
    await turn(where, { text: 'What is my name?' });
    expect(inputOf(bodies[1])).toEqual([
      { type: 'compaction', id: 'cmp_redacted', encrypted_content: 'redacted' },
      { role: 'user', content: 'What is my name?' },
    ]);
    const history = historyFromItems(await stored(where), {});
    expect(history.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
  });

  it('sends the same instructions and tools as the turn, so its prefix matches', async () => {
    const where = await conversation();
    const bot = makeBot({ tools: [lookup] });
    serve(textTurnEvents(['Hello.']), compacted());
    const result = await turn(where, { bot });
    await compact(where, result.version ?? -1, { bot });
    const [step, trigger] = bodies;
    for (const field of [
      'model',
      'instructions',
      'tools',
      'prompt_cache_key',
      'safety_identifier',
    ]) {
      expect(trigger?.[field]).toEqual(step?.[field]);
    }
    // The trigger replays exactly what the turn sent, then the turn's answer.
    expect(inputOf(trigger).slice(0, inputOf(step).length)).toEqual(inputOf(step));
  });

  it('replays from the latest compaction item of the model family, and nothing stored changes', async () => {
    const written = [
      user('first'),
      assistant('one'),
      compaction('gpt-6.1', 'older'),
      user('second'),
      assistant('two'),
      compaction('gpt-6.1', 'latest'),
      user('third'),
      assistant('three'),
    ];
    const where = await conversation(written);
    serve(textTurnEvents(['Four.']));
    await turn(where, { text: 'fourth' });

    expect(inputOf(bodies[0])).toEqual([
      { type: 'compaction', id: 'cmp_latest', encrypted_content: 'latest' },
      { role: 'user', content: 'third' },
      expect.objectContaining({ role: 'assistant', phase: 'final_answer' }),
      { role: 'user', content: 'fourth' },
    ]);
    const items = await stored(where);
    expect(items.slice(0, written.length).map(({ seq: _seq, at: _at, ...item }) => item)).toEqual(
      written,
    );
  });

  it('replays the full history to another model family, without its compaction items', async () => {
    const where = await conversation([
      user('first'),
      assistant('one'),
      compaction('gpt-6.1', 'summary'),
      user('second'),
      assistant('two'),
    ]);
    serve(textTurnEvents(['Three.']));
    await turn(where, { bot: makeBot({ model: 'gpt-7-sol' }), text: 'third' });

    const input = inputOf(bodies[0]);
    expect(input).toHaveLength(5);
    expect(input).not.toContainEqual(expect.objectContaining({ type: 'compaction' }));
    expect(input[0]).toEqual({ role: 'user', content: 'first' });
  });

  it('replays from the compaction item even when the store ignores the model', async () => {
    const base = memoryConversations();
    // A custom store written before compaction: it returns everything.
    const store: ConversationStore = {
      ...base,
      context: (id, options) => base.context(id, { signal: options?.signal }),
    };
    const conversationId = await store.create({ botId: 'support', owner: 'visitor:test' });
    await store.append(conversationId, [
      user('first'),
      assistant('one'),
      compaction('gpt-6.1', 'summary'),
    ]);
    serve(textTurnEvents(['Two.']));
    await turn({ store, conversationId }, { text: 'second' });
    expect(inputOf(bodies[0])[0]).toEqual({
      type: 'compaction',
      id: 'cmp_summary',
      encrypted_content: 'summary',
    });
  });

  it('makes no request when the conversation changed after the turn', async () => {
    const where = await conversation([user('first'), assistant('one')]);
    await where.store.append(where.conversationId, [user('another tab')]);
    const result = await compact(where, where.version);
    expect(result).toEqual({
      outcome: 'conflict',
      usage: expect.objectContaining({ inputTokens: 0 }),
    });
    expect(bodies).toHaveLength(0);
  });

  it('drops the compaction when the visitor wrote while it ran', async () => {
    const where = await conversation([user('first'), assistant('one')]);
    server.use(
      http.post(`${OPENAI_TEST_BASE_URL}/responses`, async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        // The visitor's next turn appends while the compaction runs.
        await where.store.append(where.conversationId, [user('second')]);
        return HttpResponse.json(compacted());
      }),
    );
    const result = await compact(where, where.version);
    expect(result.outcome).toBe('conflict');
    expect(result.usage.inputTokens).toBe(30_000);
    const items = await stored(where);
    expect(items.map((item) => item.type)).toEqual(['message', 'message', 'message']);
  });

  it('fails without storing anything when no compaction item comes back', async () => {
    const where = await conversation([user('first'), assistant('one')]);
    serve({ ...compacted(), status: 'incomplete', output: [] });
    const result = await compact(where, where.version);
    expect(result.outcome).toBe('failed');
    expect(await stored(where)).toHaveLength(2);
  });

  it('rejects with what OpenAI said redacted, as a turn does', async () => {
    const where = await conversation([user('first'), assistant('one')]);
    const quoted = 'my private question about my medical history and nothing else at all';
    server.use(
      http.post(`${OPENAI_TEST_BASE_URL}/responses`, () =>
        HttpResponse.json(
          { error: { message: `Invalid input: '${quoted}'`, type: 'invalid_request_error' } },
          { status: 400 },
        ),
      ),
    );
    const error = await compact(where, where.version).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AskdareError);
    const cause = (error as AskdareError).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).not.toContain('medical history');
    expect(await stored(where)).toHaveLength(2);
  });

  it('skips a conversation the provider keeps', async () => {
    if (!gateway.compact) throw new Error('The OpenAI gateway compacts.');
    const store = memoryConversations();
    const provider: ConversationStore = {
      ...store,
      context: async () => ({ kind: 'provider', provider: 'openai', ref: 'conv_1', version: 0 }),
    };
    const result = await compact({ store: provider, conversationId: 'conv_1' }, 0);
    expect(result.outcome).toBe('skipped');
    expect(bodies).toHaveLength(0);
  });

  describe('the rising floor (decision 7)', () => {
    const firstStep = (input: number) =>
      textTurnEvents(['Yes.'], { usage: { input, cached: 0, output: 5 } });

    it('stops compacting when the first step after a compaction is above half of compactAt', async () => {
      const where = await conversation([
        user('first'),
        assistant('one'),
        compaction('gpt-6.1', 'summary'),
      ]);
      serve(firstStep(10_001));
      const result = await turn(where, { text: 'second' });
      const items = await stored(where);
      expect(items.at(-1)).toMatchObject({
        type: 'native',
        provider: 'askdare',
        data: { compaction: 'stopped', inputTokens: 10_001, compactAt: 20_000 },
      });
      expect(result.version).toBe(items.length);
      expect(result.compactionStopped).toBe(true);

      // The note is never sent to the model, nor shown.
      serve(textTurnEvents(['Three.']));
      await turn(where, { text: 'third' });
      expect(inputOf(bodies[1])).not.toContainEqual(
        expect.objectContaining({ data: expect.anything() }),
      );
      expect(inputOf(bodies[1])).toHaveLength(4);
      expect(historyFromItems(items, {}).map((message) => message.role)).toEqual([
        'user',
        'assistant',
        'user',
        'assistant',
      ]);

      const skipped = await compact(
        where,
        (await where.store.info(where.conversationId))?.version ?? -1,
      );
      expect(skipped.outcome).toBe('skipped');
      expect(bodies).toHaveLength(2);
    });

    it('keeps compacting when the floor is low, and judges only the first turn after it', async () => {
      const where = await conversation([compaction('gpt-6.1', 'summary')]);
      serve(firstStep(10_000), firstStep(19_000));
      await turn(where, { text: 'first' });
      await turn(where, { text: 'second' });
      const items = await stored(where);
      expect(items.some((item) => item.type === 'native' && item.provider === 'askdare')).toBe(
        false,
      );
    });

    it('never judges a bot without compactAt', async () => {
      const where = await conversation([compaction('gpt-6.1', 'summary')]);
      serve(firstStep(19_000));
      await turn(where, { bot: makeBot({ limits: {} }) });
      expect((await stored(where)).some((item) => item.type === 'native')).toBe(true);
      expect(await stored(where)).toHaveLength(3);
    });
  });

  it('writes the stop note as provider-neutral state', () => {
    expect(compactionStopNote(12_000, 20_000)).toMatchObject({
      type: 'native',
      provider: 'askdare',
      data: { compaction: 'stopped', inputTokens: 12_000, compactAt: 20_000 },
    });
  });
});
