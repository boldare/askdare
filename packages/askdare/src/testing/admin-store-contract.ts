import type {
  AdminBotDayRow,
  AdminConversationSummary,
  AdminCountEvent,
  AdminDayRow,
  AdminPage,
  AdminRatingRecord,
  AdminSource,
  AdminStore,
  AdminTranscriptRecord,
  AdminTurnRecord,
} from '../admin/port';
import type { ContractRunner } from './runner';

export interface AdminStoreContractOptions extends ContractRunner {
  /**
   * Epoch milliseconds of the first day the suite writes on. Every daily row and almost every record
   * it writes falls within 200 days from here, and it cleans up by sweeping everything before that,
   * so pick a time before any real data. Default: 3 January 2000 (UTC). A store that expires records
   * on its own (`AdminWriteOptions.retentionDays`) needs an epoch less than 400 days ago. One test
   * writes transcripts of its own conversations near today, and deletes them.
   */
  readonly epoch?: number | undefined;
  /** Per-test timeout in milliseconds, for stores behind a network. Default: the runner's. */
  readonly timeoutMs?: number | undefined;
}

const DAY_MS = 86_400_000;
/** The suite writes only within this many days of its epoch, and sweeps them all afterwards. */
const SPAN_DAYS = 200;

const usage = (input: number, output: number) => ({
  inputTokens: input,
  cachedInputTokens: Math.floor(input / 2),
  cacheWriteTokens: 0,
  outputTokens: output,
  reasoningTokens: Math.floor(output / 4),
});
const failure = async (work: Promise<unknown>): Promise<unknown> => {
  try {
    await work;
  } catch (error) {
    return error;
  }
  return undefined;
};

/** Every page of a list, following its cursors. */
async function all<T>(read: (cursor?: string) => Promise<AdminPage<T>>): Promise<T[]> {
  const seen: T[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 100; pages += 1) {
    const page = await read(cursor);
    seen.push(...page.items);
    cursor = page.cursor;
    if (cursor === undefined) break;
  }
  return seen;
}

/**
 * The behaviour every `AdminStore` must have (ADR-0032). Run it from your store's tests with your
 * runner's `describe`, `it` and `expect`:
 *
 * ```ts
 * import { adminStoreContract } from '@boldare/askdare/testing';
 * import { describe, expect, it } from 'vitest';
 *
 * adminStoreContract('my store', () => myAdminStore(), { describe, it, expect });
 * ```
 *
 * Every test writes under bots of its own, on days near `epoch`, and deletes everything it wrote
 * when it ends, also when it fails: its conversations with `deleteConversation`, its daily rows
 * with `sweep`. Since `sweep` removes everything before a day, don't run the suite in parallel with
 * itself against one database.
 */
export function adminStoreContract(
  name: string,
  createStore: () => AdminStore,
  options: AdminStoreContractOptions,
): void {
  const { describe, it, expect } = options;
  const epoch = options.epoch ?? Date.UTC(2000, 0, 3);
  const start = epoch - (epoch % DAY_MS);
  /** The `n`th day of the suite, as `YYYY-MM-DD`. */
  const day = (n: number): string => new Date(start + n * DAY_MS).toISOString().slice(0, 10);
  /** A time on the `n`th day, `minute` minutes in. */
  const at = (n: number, minute = 0): number => start + n * DAY_MS + minute * 60_000;

  interface Fixture {
    readonly store: AdminStore;
    /** A bot name of this test only. */
    readonly bot: (label?: string) => string;
    /** A conversation ID of this test only, deleted after it. */
    readonly conversation: () => string;
    readonly turn: (
      conversationId: string,
      fields: Partial<AdminTurnRecord> & { readonly at: number; readonly bot: string },
    ) => AdminTurnRecord;
    readonly rating: (
      conversationId: string,
      fields: Partial<AdminRatingRecord> & {
        readonly at: number;
        readonly bot: string;
        readonly itemId: string;
        readonly rating: AdminRatingRecord['rating'];
      },
    ) => AdminRatingRecord;
    readonly transcript: (
      conversationId: string,
      fields: Partial<AdminTranscriptRecord> & { readonly at: number; readonly bot: string },
    ) => AdminTranscriptRecord;
  }

  const sweepAll = async (store: AdminStore): Promise<void> => {
    const options = {
      recordsBefore: at(SPAN_DAYS + 1),
      daysBefore: day(SPAN_DAYS + 1),
      limit: 500,
    };
    for (let calls = 0; calls < 1_000; calls += 1) {
      if ((await store.sweep(options)) < options.limit) return;
    }
  };

  /** A test with a fresh store whose conversations and daily rows are deleted after it. */
  const test = (title: string, body: (fixture: Fixture) => Promise<void>): void => {
    it(
      title,
      async () => {
        const store = createStore();
        const run = crypto.randomUUID();
        const created: string[] = [];
        let n = 0;
        const fixture: Fixture = {
          store,
          bot: (label = 'bot') => `contract-${label}-${run}`,
          conversation: () => {
            n += 1;
            const id = `contract-conversation-${run}-${n}`;
            created.push(id);
            return id;
          },
          turn: (conversationId, fields) => ({
            conversationId,
            visitor: `visitor-${run}`,
            source: 'chat',
            model: 'contract-model',
            durationMs: 1_200,
            outcome: 'completed',
            finishReason: 'completed',
            usage: usage(100, 20),
            steps: 1,
            tools: [],
            citations: 1,
            newConversation: false,
            unanswered: false,
            ...fields,
          }),
          rating: (conversationId, fields) => ({
            conversationId,
            visitor: `visitor-${run}`,
            source: 'chat',
            ...fields,
          }),
          transcript: (conversationId, fields) => ({
            conversationId,
            visitor: `visitor-${run}`,
            source: 'chat',
            input: 'Where is my order?',
            attachments: 0,
            answer: 'It shipped yesterday.',
            citations: [],
            reason: 'completed',
            ...fields,
          }),
        };
        try {
          await body(fixture);
        } finally {
          for (const id of created) await store.deleteConversation(id).catch(() => undefined);
          await sweepAll(store).catch(() => undefined);
        }
      },
      options.timeoutMs,
    );
  };

  const turnRow = (rows: readonly AdminDayRow[], d: string, bot: string, model: string) =>
    rows.find((row) => row.day === d && row.bot === bot && row.model === model);
  const botRow = (rows: readonly AdminBotDayRow[], d: string, bot: string) =>
    rows.find((row) => row.day === d && row.bot === bot);
  const ids = (items: readonly AdminConversationSummary[]): string[] =>
    items.map((item) => item.conversationId);

  describe(`${name} (AdminStore contract)`, () => {
    test('sums turns per day, bot and model', async ({ store, bot, conversation, turn }) => {
      const support = bot();
      const a = conversation();
      const b = conversation();
      await store.recordTurn(turn(a, { bot: support, at: at(1, 1), newConversation: true }));
      await store.recordTurn(
        turn(a, { bot: support, at: at(1, 2), usage: usage(300, 50), unanswered: true }),
      );
      await store.recordTurn(
        turn(b, {
          bot: support,
          at: at(1, 3),
          model: 'contract-other',
          outcome: 'failed',
          errorCode: 'upstream_error',
          unanswered: true,
          newConversation: true,
        }),
      );
      await store.recordTurn(turn(b, { bot: support, at: at(2, 1) }));
      const { turns, bots } = await store.days({ from: day(1), to: day(2), bot: support });
      expect(turnRow(turns, day(1), support, 'contract-model')).toEqual({
        day: day(1),
        bot: support,
        model: 'contract-model',
        turns: 2,
        failed: 0,
        unanswered: 1,
        usage: {
          inputTokens: 400,
          cachedInputTokens: 200,
          cacheWriteTokens: 0,
          outputTokens: 70,
          reasoningTokens: 17,
        },
      });
      expect(turnRow(turns, day(1), support, 'contract-other')?.failed).toBe(1);
      expect(turnRow(turns, day(2), support, 'contract-model')?.turns).toBe(1);
      expect(turns.length).toBe(3);
      expect(turns.map((row) => `${row.day} ${row.model}`)).toEqual([
        `${day(1)} contract-model`,
        `${day(1)} contract-other`,
        `${day(2)} contract-model`,
      ]);
      expect(botRow(bots, day(1), support)?.conversations).toBe(2);
    });

    test('counts a turn written twice once', async ({ store, bot, conversation, turn }) => {
      const support = bot();
      const record = turn(conversation(), { bot: support, at: at(3), newConversation: true });
      await store.recordTurn(record);
      await store.recordTurn(record);
      const { turns, bots } = await store.days({ from: day(3), to: day(3), bot: support });
      expect(turnRow(turns, day(3), support, 'contract-model')?.turns).toBe(1);
      expect(botRow(bots, day(3), support)?.conversations).toBe(1);
    });

    test('counts handoffs by state and leads, per bot and day', async ({ store, bot }) => {
      const support = bot();
      const events: AdminCountEvent[] = [
        { kind: 'handoff', bot: support, at: at(4, 1), source: 'chat', state: 'sent' },
        { kind: 'handoff', bot: support, at: at(4, 2), source: 'chat', state: 'sent' },
        { kind: 'handoff', bot: support, at: at(4, 3), source: 'chat', state: 'saved' },
        { kind: 'handoff', bot: support, at: at(4, 4), source: 'chat', state: 'unavailable' },
        { kind: 'handoff', bot: support, at: at(4, 5), source: 'chat', state: 'failed' },
        { kind: 'handoff', bot: support, at: at(4, 6), source: 'chat', state: 'limited' },
        { kind: 'lead', bot: support, at: at(4, 7), source: 'chat' },
        { kind: 'lead', bot: support, at: at(5, 1), source: 'chat' },
      ];
      for (const event of events) await store.count(event);
      const { bots, turns } = await store.days({ from: day(4), to: day(5), bot: support });
      expect(botRow(bots, day(4), support)).toEqual({
        day: day(4),
        bot: support,
        conversations: 0,
        up: 0,
        down: 0,
        leads: 1,
        handoffs: { sent: 2, saved: 1, unavailable: 1, failed: 1, limited: 1 },
      });
      expect(botRow(bots, day(5), support)?.leads).toBe(1);
      expect(turns.length).toBe(0);
    });

    test('keeps bots and days apart, with both ends of the range included', async ({
      store,
      bot,
      conversation,
      turn,
    }) => {
      const one = bot('one');
      const two = bot('two');
      for (const n of [5, 6, 7, 8]) {
        await store.recordTurn(turn(conversation(), { bot: one, at: at(n, 30) }));
      }
      await store.recordTurn(turn(conversation(), { bot: two, at: at(6, 30) }));
      const { turns } = await store.days({ from: day(6), to: day(7), bot: one });
      expect(turns.map((row) => row.day)).toEqual([day(6), day(7)]);
      const both = await store.days({ from: day(6), to: day(6) });
      expect(both.turns.filter((row) => row.bot === one || row.bot === two).length).toBe(2);
    });

    test('leaves playground records out unless asked', async ({
      store,
      bot,
      conversation,
      turn,
      rating,
    }) => {
      const support = bot();
      const chat = conversation();
      const playground = conversation();
      await store.recordTurn(turn(chat, { bot: support, at: at(9, 1), newConversation: true }));
      await store.recordTurn(
        turn(playground, {
          bot: support,
          at: at(9, 2),
          source: 'console',
          newConversation: true,
        }),
      );
      await store.recordRating(
        rating(playground, {
          bot: support,
          at: at(9, 3),
          source: 'console',
          itemId: 'msg_1',
          rating: 'down',
        }),
      );
      await store.count({ kind: 'lead', bot: support, at: at(9, 4), source: 'console' });
      const range = { from: day(9), to: day(9), bot: support };
      const sums = async (source?: AdminSource | 'all') => {
        const { turns, bots } = await store.days({ ...range, source });
        const row = botRow(bots, day(9), support);
        return [
          turnRow(turns, day(9), support, 'contract-model')?.turns ?? 0,
          row?.down ?? 0,
          row?.leads ?? 0,
        ];
      };
      expect(await sums()).toEqual([1, 0, 0]);
      expect(await sums('chat')).toEqual([1, 0, 0]);
      expect(await sums('console')).toEqual([1, 1, 1]);
      expect(await sums('all')).toEqual([2, 1, 1]);
      const list = async (source?: AdminSource | 'all') =>
        ids((await store.conversations({ ...range, source, order: 'latest', limit: 10 })).items);
      expect(await list()).toEqual([chat]);
      expect(await list('all')).toEqual([playground, chat]);
      expect((await store.ratings({ ...range, limit: 10 })).items.length).toBe(0);
      expect((await store.ratings({ ...range, source: 'console', limit: 10 })).items.length).toBe(
        1,
      );
    });

    test('replaces a repeated rating and removes one rated null', async ({
      store,
      bot,
      conversation,
      rating,
    }) => {
      const support = bot();
      const id = conversation();
      const range = { from: day(10), to: day(10), bot: support };
      const counters = async () => {
        const row = botRow((await store.days(range)).bots, day(10), support);
        return [row?.up ?? 0, row?.down ?? 0];
      };
      await store.recordRating(
        rating(id, { bot: support, at: at(10, 1), itemId: 'msg_1', rating: 'up' }),
      );
      await store.recordRating(
        rating(id, { bot: support, at: at(10, 2), itemId: 'msg_1', rating: 'up' }),
      );
      expect(await counters()).toEqual([1, 0]);
      await store.recordRating(
        rating(id, {
          bot: support,
          at: at(10, 3),
          itemId: 'msg_1',
          rating: 'down',
          comment: 'Wrong order number.',
        }),
      );
      expect(await counters()).toEqual([0, 1]);
      const { items } = await store.ratings({ ...range, limit: 10 });
      expect(items.length).toBe(1);
      expect(items[0]?.rating).toBe('down');
      expect(items[0]?.comment).toBe('Wrong order number.');
      expect(items[0]?.itemId).toBe('msg_1');
      expect(items[0]?.conversationId).toBe(id);
      await store.recordRating(
        rating(id, { bot: support, at: at(10, 4), itemId: 'msg_1', rating: null }),
      );
      expect(await counters()).toEqual([0, 0]);
      expect((await store.ratings({ ...range, limit: 10 })).items.length).toBe(0);
      // Removing a rating that isn't there changes nothing.
      await store.recordRating(
        rating(id, { bot: support, at: at(10, 5), itemId: 'msg_2', rating: null }),
      );
      expect(await counters()).toEqual([0, 0]);
    });

    test('lists ratings newest first, filtered and paged, each once', async ({
      store,
      bot,
      conversation,
      rating,
    }) => {
      const support = bot();
      const written: AdminRatingRecord[] = [];
      for (let n = 0; n < 25; n += 1) {
        const record = rating(conversation(), {
          bot: support,
          at: at(11 + (n % 3), n),
          itemId: `msg_${n}`,
          rating: n % 5 === 0 ? 'up' : 'down',
        });
        written.push(record);
        await store.recordRating(record);
      }
      const range = { from: day(11), to: day(13), bot: support };
      const down = await all((cursor) =>
        store.ratings({ ...range, rating: 'down', limit: 7, ...(cursor ? { cursor } : {}) }),
      );
      expect(down.map((item) => item.itemId)).toEqual(
        written
          .filter((item) => item.rating === 'down')
          .sort((a, b) => b.at - a.at)
          .map((item) => item.itemId),
      );
      const first = await store.ratings({ ...range, limit: 10 });
      expect(first.items.length).toBe(10);
      expect(typeof first.cursor).toBe('string');
      const everything = await all((cursor) =>
        store.ratings({ ...range, limit: 100, ...(cursor ? { cursor } : {}) }),
      );
      expect(everything.length).toBe(25);
      const one = await store.ratings({ from: day(12), to: day(12), bot: support, limit: 100 });
      expect(one.items.every((item) => item.at >= at(12) && item.at < at(13))).toBe(true);
      expect(one.items.length).toBe(
        written.filter((item) => item.at >= at(12) && item.at < at(13)).length,
      );
      expect(one.cursor).toBe(undefined);
    });

    test('summarizes conversations, most expensive or latest first, paged', async ({
      store,
      bot,
      conversation,
      turn,
      rating,
      transcript,
    }) => {
      const support = bot();
      const cheap = conversation();
      const costly = conversation();
      const rated = conversation();
      await store.recordTurn(turn(cheap, { bot: support, at: at(20, 5), usage: usage(10, 5) }));
      await store.recordTurn(turn(costly, { bot: support, at: at(20, 1), usage: usage(900, 100) }));
      await store.recordTurn(turn(costly, { bot: support, at: at(21, 1), usage: usage(100, 10) }));
      await store.recordTranscript(transcript(costly, { bot: support, at: at(21, 1) }));
      await store.recordTurn(turn(rated, { bot: support, at: at(20, 3), usage: usage(50, 5) }));
      await store.recordRating(
        rating(rated, { bot: support, at: at(20, 4), itemId: 'msg_1', rating: 'down' }),
      );
      await store.recordRating(
        rating(rated, { bot: support, at: at(20, 4), itemId: 'msg_2', rating: 'up' }),
      );
      const range = { from: day(20), to: day(21), bot: support };
      const byTokens = await store.conversations({ ...range, order: 'tokens', limit: 10 });
      expect(ids(byTokens.items)).toEqual([costly, rated, cheap]);
      expect(byTokens.cursor).toBe(undefined);
      expect(byTokens.items[0]).toEqual({
        conversationId: costly,
        bot: support,
        visitor: byTokens.items[0]?.visitor,
        firstAt: at(20, 1),
        lastAt: at(21, 1),
        turns: 2,
        usage: {
          inputTokens: 1000,
          cachedInputTokens: 500,
          cacheWriteTokens: 0,
          outputTokens: 110,
          reasoningTokens: 27,
        },
        up: 0,
        down: 0,
        transcript: true,
      });
      const latest = await store.conversations({ ...range, order: 'latest', limit: 10 });
      expect(ids(latest.items)).toEqual([costly, cheap, rated]);
      const down = await store.conversations({
        ...range,
        order: 'latest',
        rated: 'down',
        limit: 10,
      });
      expect(ids(down.items)).toEqual([rated]);
      expect(down.items[0]?.up).toBe(1);
      expect(down.items[0]?.down).toBe(1);
      expect(down.items[0]?.transcript).toBe(false);
      // A conversation belongs to the day it started on.
      const second = await store.conversations({
        ...range,
        from: day(21),
        order: 'latest',
        limit: 10,
      });
      expect(second.items.length).toBe(0);
    });

    test('pages through conversations, each once', async ({ store, bot, conversation, turn }) => {
      const support = bot();
      const written: string[] = [];
      for (let n = 0; n < 25; n += 1) {
        const id = conversation();
        written.push(id);
        await store.recordTurn(
          turn(id, { bot: support, at: at(25, n), usage: usage(1_000 - n * 10, 0) }),
        );
      }
      for (const order of ['tokens', 'latest'] as const) {
        const seen = await all((cursor) =>
          store.conversations({
            from: day(25),
            to: day(25),
            bot: support,
            order,
            limit: 10,
            ...(cursor ? { cursor } : {}),
          }),
        );
        expect(ids(seen)).toEqual(order === 'tokens' ? written : [...written].reverse());
      }
    });

    test('returns transcripts oldest first, replacing a repeated one', async ({
      store,
      bot,
      conversation,
      transcript,
    }) => {
      const support = bot();
      const id = conversation();
      expect(await store.transcript(id)).toEqual([]);
      await store.recordTranscript(
        transcript(id, { bot: support, at: at(30, 2), itemId: 'msg_2', input: 'second' }),
      );
      await store.recordTranscript(
        transcript(id, {
          bot: support,
          at: at(30, 1),
          itemId: 'msg_1',
          input: 'first',
          citations: [{ index: 1, title: 'Shipping', url: 'https://example.com/shipping' }],
          check: 'allowed',
        }),
      );
      await store.recordTranscript(
        transcript(id, {
          bot: support,
          at: at(30, 2),
          itemId: 'msg_2',
          input: 'second',
          answer: 'replaced',
        }),
      );
      const records = await store.transcript(id);
      expect(records.map((record) => record.input)).toEqual(['first', 'second']);
      expect(records[0]?.citations).toEqual([
        { index: 1, title: 'Shipping', url: 'https://example.com/shipping' },
      ]);
      expect(records[1]?.answer).toBe('replaced');
      expect(await store.transcript(conversation())).toEqual([]);
    });

    test('keeps records at least as long as the retention core passes', async ({
      store,
      bot,
      conversation,
      transcript,
    }) => {
      // A store with its own expiry (a backstop for when `sweep()` doesn't run) takes it from the
      // write, never from a shorter setting of its own, and keeps 400 days when none is passed.
      const support = bot();
      const now = Date.now();
      const passed = conversation();
      await store.recordTranscript(
        transcript(passed, { bot: support, at: now - 100 * DAY_MS, itemId: 'msg_1' }),
        { retentionDays: 120 },
      );
      const longest = conversation();
      await store.recordTranscript(
        transcript(longest, { bot: support, at: now - 300 * DAY_MS, itemId: 'msg_1' }),
      );
      expect((await store.transcript(passed)).map((record) => record.itemId)).toEqual(['msg_1']);
      expect((await store.transcript(longest)).map((record) => record.itemId)).toEqual(['msg_1']);
      expect(
        await failure(
          store.recordTranscript(transcript(passed, { bot: support, at: now - DAY_MS }), {
            retentionDays: 120,
            signal: AbortSignal.abort(),
          }),
        ),
      ).toBeInstanceOf(Error);
    });

    test('refuses queries outside their bounds', async ({ store, bot }) => {
      const support = bot();
      const refused = async (work: Promise<unknown>) =>
        expect((await failure(work)) instanceof Error).toBe(true);
      await refused(store.days({ from: day(0), to: day(400), bot: support }));
      await refused(store.days({ from: day(2), to: day(1), bot: support }));
      await refused(store.days({ from: '2000-1-1', to: day(1), bot: support }));
      await refused(store.days({ from: '2000-02-30', to: '2000-03-01', bot: support }));
      const range = { from: day(0), to: day(1), bot: support };
      await refused(store.conversations({ ...range, order: 'latest', limit: 101 }));
      await refused(store.conversations({ ...range, order: 'latest', limit: 0 }));
      await refused(store.ratings({ ...range, limit: 101 }));
      expect((await store.days({ from: day(0), to: day(399), bot: support })).turns).toEqual([]);
      expect((await store.ratings({ ...range, limit: 100 })).items).toEqual([]);
    });

    test('deletes a conversation’s records and keeps the daily rows', async ({
      store,
      bot,
      conversation,
      turn,
      rating,
      transcript,
    }) => {
      const support = bot();
      const gone = conversation();
      const kept = conversation();
      for (const id of [gone, kept]) {
        await store.recordTurn(turn(id, { bot: support, at: at(40, 1), newConversation: true }));
        await store.recordRating(
          rating(id, {
            bot: support,
            at: at(40, 2),
            itemId: 'msg_1',
            rating: 'down',
            comment: 'No.',
          }),
        );
        await store.recordTranscript(transcript(id, { bot: support, at: at(40, 1) }));
      }
      await store.count({ kind: 'lead', bot: support, at: at(40, 3), source: 'chat' });
      const range = { from: day(40), to: day(40), bot: support };
      const before = await store.days(range);
      await store.deleteConversation(gone);
      expect(await store.transcript(gone)).toEqual([]);
      expect((await store.transcript(kept)).length).toBe(1);
      expect(
        ids((await store.conversations({ ...range, order: 'latest', limit: 10 })).items),
      ).toEqual([kept]);
      expect(
        (await store.ratings({ ...range, limit: 10 })).items.map((item) => item.conversationId),
      ).toEqual([kept]);
      expect(await store.days(range)).toEqual(before);
      // Twice, and an unknown conversation, are no error.
      await store.deleteConversation(gone);
      await store.deleteConversation(conversation());
    });

    test('sweeps old records and old daily rows, in batches', async ({
      store,
      bot,
      conversation,
      turn,
      rating,
      transcript,
    }) => {
      const support = bot();
      const old = conversation();
      const recent = conversation();
      for (let n = 0; n < 6; n += 1) {
        await store.recordTurn(
          turn(old, { bot: support, at: at(50, n), newConversation: n === 0 }),
        );
        await store.recordTranscript(transcript(old, { bot: support, at: at(50, n) }));
      }
      await store.recordRating(
        rating(old, { bot: support, at: at(50, 10), itemId: 'msg_1', rating: 'up' }),
      );
      await store.count({ kind: 'lead', bot: support, at: at(50, 11), source: 'chat' });
      await store.recordTurn(turn(recent, { bot: support, at: at(60), newConversation: true }));
      await store.recordTranscript(transcript(recent, { bot: support, at: at(60) }));
      await store.count({
        kind: 'handoff',
        bot: support,
        at: at(60, 1),
        source: 'chat',
        state: 'sent',
      });

      // Records first: everything before day 55; daily rows only before day 45, so none of ours.
      const records = { recordsBefore: at(55), daysBefore: day(45), limit: 3 };
      let total = 0;
      for (let calls = 0; calls < 100; calls += 1) {
        const deleted = await store.sweep(records);
        expect(deleted <= records.limit).toBe(true);
        total += deleted;
        if (deleted < records.limit) break;
      }
      expect(total >= 13).toBe(true);
      expect(await store.transcript(old)).toEqual([]);
      expect((await store.transcript(recent)).length).toBe(1);
      const range = { from: day(50), to: day(60), bot: support };
      expect(
        ids((await store.conversations({ ...range, order: 'latest', limit: 10 })).items),
      ).toEqual([recent]);
      expect((await store.ratings({ ...range, limit: 10 })).items).toEqual([]);
      const kept = await store.days(range);
      expect(turnRow(kept.turns, day(50), support, 'contract-model')?.turns).toBe(6);
      expect(botRow(kept.bots, day(50), support)?.up).toBe(1);
      expect(botRow(kept.bots, day(50), support)?.leads).toBe(1);

      // Then the daily rows before day 55.
      const rows = { recordsBefore: at(0), daysBefore: day(55), limit: 1 };
      for (let calls = 0; calls < 1_000; calls += 1) {
        if ((await store.sweep(rows)) < rows.limit) break;
      }
      const swept = await store.days(range);
      expect(turnRow(swept.turns, day(50), support, 'contract-model')).toBe(undefined);
      expect(botRow(swept.bots, day(50), support)).toBe(undefined);
      expect(turnRow(swept.turns, day(60), support, 'contract-model')?.turns).toBe(1);
      expect(botRow(swept.bots, day(60), support)?.handoffs.sent).toBe(1);
      expect((await store.transcript(recent)).length).toBe(1);
    });
  });
}
