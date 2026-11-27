import { adminStoreContract } from '@boldare/askdare/testing';
import { Redis } from '@upstash/redis';
import { describe, expect, it } from 'vitest';
import type { RedisEval } from '../index';
import { upstashAdminStore } from './store';

/** A client that fails the test if the store reaches Redis. */
const unreachable: RedisEval = {
  eval: () => {
    throw new Error('Redis was called.');
  },
};
const calls = (): RedisEval & { args: unknown[][] } => {
  const args: unknown[][] = [];
  return {
    args,
    async eval<TArgs extends unknown[], TData>(_script: string, _keys: string[], a: TArgs) {
      args.push(a);
      return 1 as TData;
    },
  };
};
const DAY_MS = 86_400_000;
const transcript = (conversationId: string, at: number) =>
  ({
    bot: 'support',
    conversationId,
    visitor: 'visitor',
    at,
    source: 'chat',
    input: 'hi',
    attachments: 0,
    answer: 'hello',
    citations: [],
    reason: 'completed',
  }) as const;
const failure = async (work: Promise<unknown>): Promise<unknown> => {
  try {
    await work;
  } catch (error) {
    return error;
  }
  return undefined;
};

describe('upstashAdminStore', () => {
  it('refuses queries outside their bounds before reaching Redis', async () => {
    const store = upstashAdminStore({ redis: unreachable });
    const range = { from: '2026-01-01', to: '2026-01-02' };
    for (const work of [
      store.days({ from: '2026-01-01', to: '2027-02-05' }),
      store.days({ from: '2026-01-02', to: '2026-01-01' }),
      store.days({ from: '2026-1-1', to: '2026-01-02' }),
      store.days({ from: '2026-02-30', to: '2026-03-01' }),
      store.conversations({ ...range, order: 'latest', limit: 101 }),
      store.conversations({ ...range, order: 'tokens', limit: 0 }),
      store.conversations({ ...range, order: 'tokens', limit: 10, cursor: 'm:10' }),
      store.ratings({ ...range, limit: 1.5 }),
      store.ratings({ ...range, limit: 10, cursor: 'u1.bm90LWpzb24' }),
      store.sweep({ recordsBefore: 0, daysBefore: '2026-13-01', limit: 10 }),
      store.sweep({ recordsBefore: 0, daysBefore: '2026-01-01', limit: 0 }),
    ]) {
      expect(await failure(work)).toBeInstanceOf(RangeError);
    }
  });

  it('refuses a retention that is not positive', async () => {
    const store = upstashAdminStore({ redis: unreachable });
    expect(
      await failure(store.recordTranscript(transcript('conv_1', Date.now()), { retentionDays: 0 })),
    ).toBeInstanceOf(RangeError);
  });

  it('expires records after the retention core passes, or 400 days without one', async () => {
    const redis = calls();
    const store = upstashAdminStore({ redis });
    await store.recordTranscript(transcript('conv_1', Date.now()), { retentionDays: 90 });
    await store.recordTranscript(transcript('conv_1', Date.now()));
    await store.deleteConversation('conv_1');
    // ARGV[3]: the write's time to live; 0 for a script that keeps the stored one.
    expect(redis.args.map((args) => args[2])).toEqual([90 * DAY_MS, 400 * DAY_MS, 0]);
  });

  it('stops before writing when the signal is aborted', async () => {
    const store = upstashAdminStore({ redis: unreachable });
    const error = await failure(
      store.count(
        { kind: 'lead', bot: 'support', at: Date.now(), source: 'chat' },
        AbortSignal.abort(),
      ),
    );
    expect((error as Error).name).toBe('AbortError');
  });

  it('passes the conversation ID only as a hashed key part and a value', async () => {
    const redis = calls();
    const store = upstashAdminStore({ redis, prefix: 'app1:' });
    await store.deleteConversation('conv_secret');
    const [args] = redis.args;
    expect(args?.[0]).toBe('app1:admin:');
    expect(args?.[3]).toMatch(/^[0-9a-f]{40}$/);
    expect(JSON.stringify(args)).not.toContain('conv_secret');
  });

  it('reports a database it cannot reach as a failed check', async () => {
    const store = upstashAdminStore({ redis: unreachable });
    const checks = await store.diagnose?.();
    expect(checks?.[0]?.status).toBe('fail');
  });
});

// Against a real database: ASKDARE_TEST_UPSTASH=1 with UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN set (docker-compose.yml runs Redis behind Upstash's REST proxy). Keys use
// the prefix `askdare-test:`. The suite's epoch is recent, so the records' expiry (counted from
// their time) is in the future; its cleanup sweeps every admin record under that prefix.
if (process.env['ASKDARE_TEST_UPSTASH'] === '1') {
  const epoch = Math.floor(Date.now() / DAY_MS) * DAY_MS - 100 * DAY_MS;
  const prefix = 'askdare-test:';
  adminStoreContract('upstashAdminStore on Upstash', () => upstashAdminStore({ prefix }), {
    describe,
    it,
    expect,
    epoch,
    timeoutMs: 60_000,
  });

  describe('upstashAdminStore on Upstash', () => {
    const redis = Redis.fromEnv();

    it('keeps conversation IDs, visitors and content out of key names', async () => {
      const store = upstashAdminStore({ prefix });
      const run = crypto.randomUUID();
      const conversationId = `keys-conversation-${run}`;
      const visitor = `keys-visitor-${run}`;
      const base = {
        bot: 'keys',
        conversationId,
        visitor,
        at: Date.now(),
        source: 'chat',
      } as const;
      await store.recordTurn({
        ...base,
        model: 'keys-model',
        durationMs: 1,
        outcome: 'completed',
        usage: {
          inputTokens: 1,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 1,
          reasoningTokens: 0,
        },
        steps: 1,
        tools: [],
        citations: 0,
        newConversation: true,
        unanswered: false,
      });
      await store.recordRating({ ...base, itemId: `item-${run}`, rating: 'down', comment: run });
      await store.recordTranscript({
        ...base,
        itemId: `item-${run}`,
        input: `question ${run}`,
        attachments: 0,
        answer: `answer ${run}`,
        citations: [],
        reason: 'completed',
      });
      try {
        const keys: string[] = [];
        let cursor = '0';
        do {
          const [next, page] = await redis.scan(cursor, { match: `${prefix}admin:*`, count: 1000 });
          cursor = String(next);
          keys.push(...page);
        } while (cursor !== '0');
        expect(keys.length > 0).toBe(true);
        expect(keys.filter((key) => key.includes(run))).toEqual([]);
        // Expiring: no conversation key outlives its retention.
        const ttl = await redis.pttl(`${prefix}admin:rec`);
        expect(ttl).toBe(-1);
      } finally {
        await store.deleteConversation(conversationId);
      }
    });

    it('expires a conversation’s keys after the retention core passes, also after a sweep', async () => {
      const store = upstashAdminStore({ prefix });
      const conversationId = `ttl-conversation-${crypto.randomUUID()}`;
      const now = Date.now();
      const write = { retentionDays: 2 };
      await store.recordTranscript(
        { ...transcript(conversationId, now - 1.5 * DAY_MS), itemId: 'old' },
        write,
      );
      await store.recordTranscript(
        { ...transcript(conversationId, now - DAY_MS), itemId: 'new' },
        write,
      );
      const hash = (await import('node:crypto'))
        .createHash('sha1')
        .update(conversationId)
        .digest('hex');
      const key = `${prefix}admin:c:${hash}:x`;
      const expiresInADay = async () => {
        const ttl = await redis.pttl(key);
        return ttl > 0.9 * DAY_MS && ttl <= DAY_MS;
      };
      try {
        expect(await expiresInADay()).toBe(true);
        // A sweep that removes the older record keeps the retention the writes passed.
        await store.sweep({
          recordsBefore: now - 1.25 * DAY_MS,
          daysBefore: '1970-01-01',
          limit: 100,
        });
        expect((await store.transcript(conversationId)).map((record) => record.itemId)).toEqual([
          'new',
        ]);
        expect(await expiresInADay()).toBe(true);
      } finally {
        await store.deleteConversation(conversationId);
      }
    });
  });
}
