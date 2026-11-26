import type { AdminTurnRecord } from '@boldare/askdare';
import { adminStoreContract } from '@boldare/askdare/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CONVERSATIONS_PART, CONVERSATIONS_TABLE } from '../conversations/schema';
import { postgresConversations } from '../conversations/store';
import { KNOWLEDGE_SCHEMA } from '../knowledge/schema';
import { migrate, migrateParts } from '../schema/migrate';
import { createTestSchema, TEST_DATABASE_URL, type TestSchema } from '../testing/database';
import { ADMIN_PART, SUMMARIES_TABLE } from './schema';
import { postgresAdminStore } from './store';

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 10, 26, 12);

const turn = (fields: Partial<AdminTurnRecord> & { conversationId: string }): AdminTurnRecord => ({
  bot: 'support',
  visitor: 'visitor-1',
  at: NOW,
  source: 'chat',
  model: 'model-a',
  durationMs: 900,
  outcome: 'completed',
  usage: {
    inputTokens: 100,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 10,
    reasoningTokens: 0,
  },
  steps: 1,
  tools: [],
  citations: 0,
  newConversation: false,
  unanswered: false,
  ...fields,
});

describe('postgresAdminStore without a database', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('can be created without DATABASE_URL, so a build that loads the route works', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const store = postgresAdminStore();
    expect(store.name).toBe('postgres');
    const [check] = await store.diagnose();
    expect(check?.status).toBe('fail');
    await expect(store.recordTurn(turn({ conversationId: 'c' }))).rejects.toThrow(
      'Set DATABASE_URL',
    );
  });

  it("reports a database it can't reach by its error code only", async () => {
    const store = postgresAdminStore({ url: 'postgres://127.0.0.1:1/askdare' });
    expect(await store.diagnose()).toEqual([
      {
        status: 'fail',
        title: "Postgres admin store: the database can't be reached (ECONNREFUSED).",
        fix: expect.stringContaining('DATABASE_URL'),
      },
    ]);
  });

  it('refuses bad bounds and cursors before asking the database', async () => {
    const store = postgresAdminStore({ url: 'postgres://127.0.0.1:1/askdare' });
    const range = { from: '2026-11-01', to: '2026-11-02' };
    await expect(store.ratings({ ...range, limit: 10, cursor: 'nope' })).rejects.toThrow(
      'Unknown cursor',
    );
    // A cursor of another list.
    const ratingCursor = Buffer.from(JSON.stringify(['r', 1, 'c', 'i'])).toString('base64url');
    await expect(
      store.conversations({ ...range, order: 'latest', limit: 10, cursor: ratingCursor }),
    ).rejects.toThrow('Unknown cursor');
    await expect(store.recordTurn(turn({ conversationId: 'c', at: 1.5 }))).rejects.toThrow(
      'whole epoch milliseconds',
    );
    await expect(
      store.sweep({ recordsBefore: NOW, daysBefore: '2026-13-01', limit: 10 }),
    ).rejects.toThrow('YYYY-MM-DD');
    expect(() => postgresAdminStore({ retentionDays: 0 })).toThrow('retentionDays');
  });
});

describe.skipIf(!TEST_DATABASE_URL)('postgresAdminStore against Postgres', () => {
  let schema: TestSchema;

  beforeAll(async () => {
    schema = await createTestSchema();
    await migrate({ pool: schema.pool, parts: ['conversations', 'admin'] });
  });

  afterAll(async () => {
    await schema.drop();
  });

  adminStoreContract('postgresAdminStore', () => postgresAdminStore({ pool: schema.pool }), {
    describe,
    it,
    expect,
  });

  const store = () => postgresAdminStore({ pool: schema.pool });
  const id = () => `conversation-${crypto.randomUUID()}`;
  const day = (at: number) => new Date(at).toISOString().slice(0, 10);

  it('counts each turn once when several instances write it at the same time', async () => {
    const conversationId = id();
    const bot = `concurrent-${crypto.randomUUID()}`;
    const record = turn({ conversationId, bot, newConversation: true });
    const others = Array.from({ length: 6 }, (_, n) =>
      turn({ conversationId, bot, at: NOW + n + 1 }),
    );
    await Promise.all([
      ...Array.from({ length: 4 }, () => store().recordTurn(record)),
      ...others.map((each) => store().recordTurn(each)),
    ]);
    const { turns, bots } = await store().days({ from: day(NOW), to: day(NOW), bot });
    expect(turns[0]?.turns).toBe(7);
    expect(bots[0]?.conversations).toBe(1);
    const { items } = await store().conversations({
      from: day(NOW),
      to: day(NOW),
      bot,
      order: 'latest',
      limit: 10,
    });
    expect(items[0]?.turns).toBe(7);
    expect(items[0]?.usage.inputTokens).toBe(700);
    await store().deleteConversation(conversationId);
  });

  it('stores text Postgres refuses as the replacement character', async () => {
    const conversationId = id();
    await store().recordTranscript({
      bot: 'support',
      conversationId,
      visitor: 'v',
      at: NOW,
      source: 'chat',
      input: 'a\0b\uD800c',
      attachments: 0,
      answer: undefined,
      citations: [{ index: 1, title: 'x\0' }],
      reason: 'completed',
    });
    const [record] = await store().transcript(conversationId);
    expect(record?.input).toBe('a�b�c');
    expect(record?.answer).toBe(undefined);
    expect(record?.itemId).toBe(undefined);
    expect(record?.citations).toEqual([{ index: 1, title: 'x�' }]);
    await store().deleteConversation(conversationId);
  });

  it('keeps a summary of the records that remain after a partial sweep', async () => {
    const conversationId = id();
    const bot = `partial-${crypto.randomUUID()}`;
    const start = Date.UTC(2001, 0, 1);
    await store().recordTurn(turn({ conversationId, bot, at: start, newConversation: true }));
    await store().recordTurn(turn({ conversationId, bot, at: start + 2 * DAY_MS }));
    while (
      (await store().sweep({
        recordsBefore: start + DAY_MS,
        daysBefore: '2000-01-01',
        limit: 50,
      })) === 50
    ) {
      // Until the batch is short.
    }
    const range = { from: day(start), to: day(start + 2 * DAY_MS), bot, order: 'latest' as const };
    const { items } = await store().conversations({ ...range, limit: 10 });
    expect(items.map((item) => [item.firstAt, item.turns])).toEqual([[start + 2 * DAY_MS, 1]]);
    await store().deleteConversation(conversationId);
    await store().sweep({ recordsBefore: 0, daysBefore: '2001-02-01', limit: 100 });
  });

  it('warns in diagnose when the oldest record is older than the retention', async () => {
    const conversationId = id();
    const fresh = postgresAdminStore({ pool: schema.pool, retentionDays: 7 });
    // Whatever earlier tests left behind.
    const cutoff = {
      recordsBefore: Date.now() - 20 * DAY_MS,
      daysBefore: '2000-01-01',
      limit: 100,
    };
    while ((await fresh.sweep(cutoff)) === cutoff.limit) {
      // Until the batch is short.
    }
    expect((await fresh.diagnose())[0]).toEqual({
      status: 'ok',
      title: `Postgres admin store: schema version ${ADMIN_PART.migrations.length}.`,
    });
    await fresh.recordTurn(turn({ conversationId, at: Date.now() - 10 * DAY_MS }));
    const checks = await fresh.diagnose();
    expect(checks[1]).toMatchObject({ status: 'warn', title: expect.stringContaining('10 days') });
    await fresh.deleteConversation(conversationId);
  });

  describe('indexes', () => {
    beforeAll(async () => {
      // 20,000 conversations over 40 days, so the planner prefers an index where one serves.
      await schema.pool.query(`
        insert into ${SUMMARIES_TABLE} (conversation_id, bot, visitor, source, first_at, last_at,
          turns, input_tokens, cached_input_tokens, cache_write_tokens, output_tokens,
          reasoning_tokens, up, down, transcripts)
        select 'seed-' || n, 'bot-' || (n % 5), 'v', 'chat',
          ${NOW} - (n % 40) * ${DAY_MS}::bigint, ${NOW} - (n % 40) * ${DAY_MS}::bigint + n,
          1, n, 0, 0, n % 100, 0, 0, n % 7, 0
        from generate_series(1, 20000) n`);
      await schema.pool.query(`analyze ${SUMMARIES_TABLE}`);
    });

    afterAll(async () => {
      await schema.pool.query(`delete from ${SUMMARIES_TABLE} where conversation_id like 'seed-%'`);
    });

    it('lists the conversations of a day range from the first_at index', async () => {
      const result = await schema.pool.query<{ 'QUERY PLAN': string }>(
        `explain select conversation_id from ${SUMMARIES_TABLE}
         where first_at >= $1 and first_at < $2 order by tokens desc limit 11`,
        [NOW - DAY_MS, NOW + DAY_MS],
      );
      const plan = result.rows.map((row) => row['QUERY PLAN']).join('\n');
      expect(plan).toContain(`${SUMMARIES_TABLE}_first_at`);
    });
  });
});

describe.skipIf(!TEST_DATABASE_URL)('the admin part on a 0.6 database', () => {
  let schema: TestSchema;

  beforeAll(async () => {
    schema = await createTestSchema();
  });

  afterAll(async () => {
    await schema.drop();
  });

  it('is added by migrate, leaving the conversations and the knowledge index as they were', async () => {
    // The parts 0.6 shipped, with a conversation in them.
    await migrateParts(schema.pool, [CONVERSATIONS_PART, KNOWLEDGE_SCHEMA]);
    const conversations = postgresConversations({ pool: schema.pool });
    const conversationId = await conversations.create({ botId: 'support', owner: 'visitor:1' });

    const report = await migrate({ pool: schema.pool });
    expect(report.applied).toEqual([{ part: 'admin', version: 1, name: 'create the admin store' }]);
    expect((await conversations.info(conversationId))?.botId).toBe('support');
    const rows = await schema.pool.query(`select 1 from ${CONVERSATIONS_TABLE}`);
    expect(rows.rowCount).toBe(1);

    const admin = postgresAdminStore({ pool: schema.pool });
    await admin.recordTurn(turn({ conversationId, newConversation: true }));
    const { turns } = await admin.days({ from: day(NOW), to: day(NOW) });
    expect(turns.map((row) => row.turns)).toEqual([1]);
    expect((await admin.diagnose()).map((check) => check.status)).toEqual(['ok', 'ok']);
  });

  const day = (at: number) => new Date(at).toISOString().slice(0, 10);
});
