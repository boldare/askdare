import { describe, expect, it } from 'vitest';
import { rateLimitStoreContract } from '../../askdare/src/limits/store-contract';
import { type RedisEval, upstashStore } from './index';

/** Executes the store's script semantics against an in-memory map instead of Redis. */
function fakeRedis(): RedisEval & { calls: { keys: string[]; args: unknown[] }[] } {
  const values = new Map<string, { count: number; expiresAt: number | undefined }>();
  const calls: { keys: string[]; args: unknown[] }[] = [];
  return {
    calls,
    async eval<TArgs extends unknown[], TData>(_script: string, keys: string[], args: TArgs) {
      calls.push({ keys, args });
      const [key] = keys as [string];
      const [amount, windowMs] = args as unknown as [number, number];
      const now = Date.now();
      let entry = values.get(key);
      if (!entry || (entry.expiresAt !== undefined && entry.expiresAt <= now)) {
        entry = { count: 0, expiresAt: undefined };
        values.set(key, entry);
      }
      entry.count += amount;
      entry.expiresAt ??= now + windowMs;
      return [entry.count, entry.expiresAt - now] as TData;
    },
  };
}

rateLimitStoreContract('upstashStore', () => upstashStore({ redis: fakeRedis() }));

describe('upstashStore', () => {
  it('is shared across instances', () => {
    expect(upstashStore({ redis: fakeRedis() }).shared).toBe(true);
  });

  it('prefixes keys and passes amount and window to the script', async () => {
    const redis = fakeRedis();
    await upstashStore({ redis, prefix: 'app1:' }).hit('cd:s:bot:ip', 3_600_000, 1);
    expect(redis.calls).toEqual([{ keys: ['app1:cd:s:bot:ip'], args: [1, 3_600_000] }]);
  });

  it('explains missing configuration on first use', async () => {
    const store = upstashStore({ url: '', token: '' });
    await expect(store.hit('k', 1_000, 1)).rejects.toThrow(/UPSTASH_REDIS_REST_URL/);
  });
});
