import { createHash } from 'node:crypto';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type BotDefinition, createBot } from '../bot/define-bot';
import { itemHistory } from '../conversations/history';
import { memoryConversations } from '../conversations/memory';
import type { ConversationStore, StoredItem } from '../conversations/port';
import { historyReader } from '../conversations/provider-history';
import type { ModelGateway, TurnRequest } from '../gateway';
import { knowledgeDocument } from '../knowledge/document';
import { fakeEmbedder } from '../knowledge/fake-embedder';
import { memoryKnowledgeIndex, memoryKnowledgeStore } from '../knowledge/memory-index';
import type { KnowledgeDocument, KnowledgeIndex } from '../knowledge/port';
import { RETRIEVAL_RULE, SEARCH_KNOWLEDGE } from '../knowledge/tool';
import type { ProtocolEvent } from '../protocol/events';
import { UNTRUSTED } from '../tools/outputs';
import { createOpenAIGateway } from './gateway';
import { testConversations } from './testing/conversations';
import { type FixtureEvent, OPENAI_TEST_BASE_URL, sseStream, textTurnEvents } from './testing/msw';

/**
 * Knowledge from the bot's own index (ADR-0025): the model searches with `search_knowledge`, cites
 * `[id]`, and the visitor sees `[n]` markers and `citation` events as with `file_search`, live and
 * after a reload, with either kind of conversation store.
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
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const doc = (path: string, title: string, text: string, url?: string): KnowledgeDocument =>
  knowledgeDocument({ path, sha256: sha256(text), title, url, text });

const PRICING = doc(
  'pricing.md',
  'Pricing',
  '# Plans\n\nThe Team plan costs 12 euros per seat.\n\n## Refunds\n\nRefunds are possible within 14 days.',
  'https://example.test/pricing',
);
const SUPPORT = doc('support.txt', 'Support', 'Support answers within one business day.');

const idOf = (document: KnowledgeDocument, words: string): string => {
  const chunk = document.chunks.find((candidate) => candidate.text.includes(words));
  if (!chunk) throw new Error(`No chunk contains "${words}".`);
  return chunk.sourceId;
};
const TEAM = idOf(PRICING, 'Team plan');
const REFUNDS = idOf(PRICING, 'Refunds are');
const SUPPORT_ID = idOf(SUPPORT, 'business day');

async function syncedIndex(documents: readonly KnowledgeDocument[] = [PRICING, SUPPORT]) {
  const index = memoryKnowledgeIndex({
    embedder: fakeEmbedder(),
    indexId: 'support',
    store: memoryKnowledgeStore(),
  });
  await index.sync(documents);
  return index;
}

type Served = readonly FixtureEvent[];

/** Answers each `POST /responses` with the next stream, in order, and records the bodies. */
function serve(...responses: Served[]): void {
  const queue = [...responses];
  server.use(
    http.post(`${OPENAI_TEST_BASE_URL}/responses`, async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      const next = queue.shift();
      if (next === undefined) throw new Error('No response left to serve.');
      return new HttpResponse(sseStream(next), {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }),
  );
}

/** A step in which the model only searches. */
function searchStep(query: unknown, callId = 'call_search'): FixtureEvent[] {
  return [
    { type: 'response.created', response: { id: 'resp_search', status: 'in_progress' } },
    {
      type: 'response.output_item.done',
      output_index: 0,
      item: {
        id: 'fc_search',
        type: 'function_call',
        status: 'completed',
        call_id: callId,
        name: SEARCH_KNOWLEDGE,
        arguments: JSON.stringify(query),
      },
    },
    {
      type: 'response.completed',
      response: {
        id: 'resp_search',
        object: 'response',
        status: 'completed',
        output: [],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    },
  ];
}

function makeBot(index: KnowledgeIndex, definition: Partial<BotDefinition> = {}) {
  return createBot({
    id: 'support',
    model: 'gpt-6.1-terra',
    instructions: 'Be brief.',
    knowledge: { index },
    ...definition,
  } as BotDefinition);
}

async function itemConversation(): Promise<Where> {
  const store = memoryConversations();
  const conversationId = await store.create({ botId: 'support', owner: 'visitor:test' });
  return { store, conversationId };
}

interface Where {
  readonly store: ConversationStore;
  readonly conversationId: string;
}

async function turn(where: Where, overrides: Partial<TurnRequest> & Pick<TurnRequest, 'bot'>) {
  const events: ProtocolEvent[] = [];
  const result = await gateway.runTurn({
    conversationId: where.conversationId,
    conversations: where.store,
    text: 'How much is Team?',
    context: { locale: 'en' },
    safetyIdentifier: 'a'.repeat(64),
    visitorId: `v_${'0f'.repeat(16)}`,
    messageId: 'msg_r',
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
    ...overrides,
  });
  const text = events
    .flatMap((event) => (event.type === 'text.delta' ? [event.delta] : []))
    .join('');
  const citations = events.flatMap((event) =>
    event.type === 'citation' ? [{ index: event.index, title: event.title, url: event.url }] : [],
  );
  return { result, events, text, citations };
}

const inputOf = (body: Record<string, unknown> | undefined): Record<string, unknown>[] =>
  (body?.['input'] ?? []) as Record<string, unknown>[];

describe('search_knowledge with an own index', () => {
  it('searches, wraps the results as untrusted, and streams [n] markers with citations', async () => {
    const index = await syncedIndex();
    const where = await itemConversation();
    serve(
      searchStep({ query: 'Team plan price' }),
      textTurnEvents([`It costs 12 euros [${TEAM}].`]),
    );
    const { text, citations, events } = await turn(where, { bot: makeBot(index) });

    expect(text).toBe('It costs 12 euros [1].');
    expect(citations).toEqual([
      { index: 1, title: 'Pricing', url: 'https://example.test/pricing' },
    ]);
    expect(
      events.flatMap((event) => (event.type === 'tool.status' ? [[event.name, event.state]] : [])),
    ).toEqual([
      [SEARCH_KNOWLEDGE, 'running'],
      [SEARCH_KNOWLEDGE, 'done'],
    ]);
    // The tool is strict with one argument, and the retrieval rule joins the instructions.
    expect(bodies[0]?.['tools']).toEqual([
      expect.objectContaining({
        type: 'function',
        name: SEARCH_KNOWLEDGE,
        strict: true,
        parameters: expect.objectContaining({
          required: ['query'],
          additionalProperties: false,
        }),
      }),
    ]);
    expect(String(bodies[0]?.['instructions'])).toContain(RETRIEVAL_RULE);
    expect(bodies[0]).not.toHaveProperty('include');
    const output = inputOf(bodies[1]).find((item) => item['type'] === 'function_call_output');
    const parsed = JSON.parse(String(output?.['output'])) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([UNTRUSTED]);
    const results = (parsed[UNTRUSTED] as { results: { id: string; title: string }[] }).results;
    expect(results[0]).toMatchObject({ id: TEAM, title: 'Pricing', section: 'Plans' });
  });

  it('keeps search off the last step, where a call could no longer be answered', async () => {
    const index = await syncedIndex();
    const where = await itemConversation();
    serve(searchStep({ query: 'Team' }), textTurnEvents([`12 euros [${TEAM}].`]));
    await turn(where, { bot: makeBot(index, { limits: { maxSteps: 2 } }) });
    expect(bodies[0]?.['tool_choice']).toBe('auto');
    expect(bodies[1]?.['tool_choice']).toBe('none');
  });

  it('wraps search results as untrusted even when the bot trusts its tools', async () => {
    const index = await syncedIndex();
    const where = await itemConversation();
    serve(searchStep({ query: 'refunds' }), textTurnEvents(['Within 14 days.']));
    await turn(where, { bot: makeBot(index, { toolResults: 'trusted' }) });
    const output = inputOf(bodies[1]).find((item) => item['type'] === 'function_call_output');
    expect(String(output?.['output']).startsWith(`{"${UNTRUSTED}":`)).toBe(true);
  });

  it('rewrites a marker split across deltas', async () => {
    const index = await syncedIndex();
    const where = await itemConversation();
    serve(
      searchStep({ query: 'Team' }),
      textTurnEvents(['12 euros [', TEAM.slice(0, 5), `${TEAM.slice(5)}`, '] per seat.']),
    );
    const { text, citations } = await turn(where, { bot: makeBot(index) });
    expect(text).toBe('12 euros [1] per seat.');
    expect(citations).toHaveLength(1);
  });

  it('drops an ID no search returned and the index lacks, and counts it without its text', async () => {
    const index = await syncedIndex();
    const passage = vi.spyOn(index, 'passage');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const where = await itemConversation();
    serve(
      searchStep({ query: 'Team' }),
      textTurnEvents([`12 euros [${TEAM}] or 9 [kffffffffffff], see [the docs](https://x.test).`]),
    );
    const { text, citations } = await turn(where, { bot: makeBot(index) });
    expect(text).toBe('12 euros [1] or 9 , see [the docs](https://x.test).');
    expect(citations).toHaveLength(1);
    expect(passage).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
      "[askdare] dropped 1 citation(s) of passages the index doesn't have.",
    ]);
  });

  it('merges adjacent identical markers, and two chunks of one page into one source', async () => {
    const index = await syncedIndex();
    const where = await itemConversation();
    serve(
      searchStep({ query: 'Team refunds' }),
      textTurnEvents([`12 euros [${TEAM}] [${TEAM}], refunds [${TEAM}][${REFUNDS}]`, '.']),
    );
    const { text, citations } = await turn(where, { bot: makeBot(index) });
    expect(text).toBe('12 euros [1], refunds [1].');
    expect(citations).toEqual([
      { index: 1, title: 'Pricing', url: 'https://example.test/pricing' },
    ]);
  });

  it("resolves a citation of an earlier turn's passage through the index", async () => {
    const index = await syncedIndex();
    const where = await itemConversation();
    const bot = makeBot(index);
    serve(
      searchStep({ query: 'support hours' }),
      textTurnEvents([`One business day [${SUPPORT_ID}].`]),
      // No search in this turn: the model cites what the earlier one returned.
      textTurnEvents([`As said, one business day [${SUPPORT_ID}].`]),
    );
    await turn(where, { bot });
    const passage = vi.spyOn(index, 'passage');
    const second = await turn(where, { bot, text: 'Repeat that?' });
    expect(second.text).toBe('As said, one business day [1].');
    expect(second.citations).toEqual([{ index: 1, title: 'Support', url: undefined }]);
    expect(passage).toHaveBeenCalledWith(SUPPORT_ID, expect.anything());
    // The model reads its earlier answer with the IDs it wrote, not the visitor's [n].
    expect(JSON.stringify(inputOf(bodies[2]))).toContain(`[${SUPPORT_ID}]`);
  });

  it('never searches with an empty query', async () => {
    const index = await syncedIndex();
    const search = vi.spyOn(index, 'search');
    const where = await itemConversation();
    serve(searchStep({ query: '   ' }), textTurnEvents(['I need more detail.']));
    const { events } = await turn(where, { bot: makeBot(index) });
    expect(search).not.toHaveBeenCalled();
    const output = inputOf(bodies[1]).find((item) => item['type'] === 'function_call_output');
    expect(JSON.parse(String(output?.['output']))).toHaveProperty('error');
    expect(
      events.find((event) => event.type === 'tool.status' && event.state !== 'running'),
    ).toMatchObject({
      state: 'error',
    });
  });

  it('answers a failed search with an error, never its message', async () => {
    const index = await syncedIndex();
    vi.spyOn(index, 'search').mockRejectedValue(new Error('relation does not exist: secret query'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const where = await itemConversation();
    serve(searchStep({ query: 'Team' }), textTurnEvents(["I can't look that up right now."]));
    await turn(where, { bot: makeBot(index) });
    const output = inputOf(bodies[1]).find((item) => item['type'] === 'function_call_output');
    expect(JSON.parse(String(output?.['output']))).toEqual({ error: 'The tool failed.' });
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret query');
  });

  it('leaves [id] text alone for a bot without an own index', async () => {
    const where = await itemConversation();
    serve(textTurnEvents([`Literal [${TEAM}].`]));
    const { text, citations } = await turn(where, {
      bot: createBot({ id: 'support', model: 'gpt-6.1-terra', instructions: 'Be brief.' }),
    });
    expect(text).toBe(`Literal [${TEAM}].`);
    expect(citations).toEqual([]);
  });
});

describe('knowledge citations after a reload', () => {
  it('item store: stores the IDs with their citations, and history shows the same [n]', async () => {
    const index = await syncedIndex();
    const where = await itemConversation();
    serve(
      searchStep({ query: 'Team support' }),
      textTurnEvents([`12 euros [${TEAM}], answers in a day [${SUPPORT_ID}] [${SUPPORT_ID}].`]),
    );
    const live = await turn(where, { bot: makeBot(index) });
    const items = (await where.store.page(where.conversationId)).items;
    const answer = items.at(-1) as Extract<StoredItem, { type: 'message' }>;
    expect(answer.parts).toEqual([
      {
        type: 'text',
        text: `12 euros [${TEAM}], answers in a day [${SUPPORT_ID}] [${SUPPORT_ID}].`,
        citations: [
          { title: 'Pricing', url: 'https://example.test/pricing', sourceId: TEAM },
          { title: 'Support', sourceId: SUPPORT_ID },
        ],
      },
    ]);

    // Stored citations resolve the markers without the index; a later sync can't change them.
    await index.clear();
    const history = await itemHistory(where.store)(where.conversationId, { knowledge: index });
    const reloaded = history.at(-1);
    expect(reloaded?.text).toBe(live.text);
    expect(reloaded?.text).toBe('12 euros [1], answers in a day [2].');
    expect(reloaded?.citations).toEqual([
      { index: 1, title: 'Pricing', url: 'https://example.test/pricing' },
      { index: 2, title: 'Support', url: undefined },
    ]);
  });

  it('OpenAI conversations: rewrites stored markers through passage() and drops removed ones', async () => {
    const index = await syncedIndex();
    const conversations = testConversations();
    const read = historyReader(conversations.store);
    server.use(
      http.get(`${OPENAI_TEST_BASE_URL}/conversations/conv_k/items`, () =>
        HttpResponse.json({
          object: 'list',
          has_more: false,
          first_id: 'msg_2',
          last_id: 'msg_1',
          // Newest first, as the API returns them.
          data: [
            {
              id: 'msg_2',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [
                {
                  type: 'output_text',
                  text: `12 euros [${TEAM}, kffffffffffff], refunds [${REFUNDS}][${REFUNDS}].`,
                  annotations: [],
                  logprobs: [],
                },
              ],
            },
            {
              id: 'msg_1',
              type: 'message',
              role: 'user',
              status: 'completed',
              content: [{ type: 'input_text', text: 'Price?' }],
            },
          ],
        }),
      ),
    );
    const history = await read?.('conv_k', { knowledge: index });
    expect(history?.at(-1)).toMatchObject({
      text: '12 euros [1], refunds [1].',
      citations: [{ index: 1, title: 'Pricing', url: 'https://example.test/pricing' }],
    });
  });

  it('OpenAI conversations: the live turn shows the same markers as the reload', async () => {
    const index = await syncedIndex();
    const conversations = testConversations();
    serve(searchStep({ query: 'Team' }), textTurnEvents([`12 euros [${TEAM}].`]));
    const live = await turn(
      { store: conversations.store, conversationId: 'conv_live' },
      { bot: makeBot(index) },
    );
    expect(live.text).toBe('12 euros [1].');
    // A provider conversation sends only what is new: the search output goes in the second step.
    expect(bodies[1]?.['conversation']).toBe('conv_live');
  });
});
