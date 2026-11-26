import type { CounterHit, RateLimitStore } from '@boldare/askdare';
import { lazyClient } from './client';

export type { UpstashAdminStoreOptions } from './admin/store';
export { upstashAdminStore } from './admin/store';
export type { UpstashTurnLogOptions } from './turn-log';
export { upstashTurnLog } from './turn-log';

/** The subset of an Upstash Redis client this store uses. */
export interface RedisEval {
  eval<TArgs extends unknown[], TData = unknown>(
    script: string,
    keys: string[],
    args: TArgs,
  ): Promise<TData>;
}

export interface UpstashStoreOptions {
  /** An existing client. Otherwise one is created from `url` and `token`. */
  readonly redis?: RedisEval;
  /** Default `process.env.UPSTASH_REDIS_REST_URL` (Upstash console), else `KV_REST_API_URL` (Vercel Marketplace). */
  readonly url?: string;
  /** Default `process.env.UPSTASH_REDIS_REST_TOKEN`, else `KV_REST_API_TOKEN`. */
  readonly token?: string;
  /** Key prefix, to share one database between apps. Default `askdare:`. */
  readonly prefix?: string;
}

// Increment and start the window atomically, in one round trip.
const HIT_SCRIPT = `
local count = redis.call('INCRBY', KEYS[1], ARGV[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  ttl = tonumber(ARGV[2])
end
return {count, ttl}
`;

/**
 * Rate-limit and budget counters shared by every server instance, stored in Upstash Redis over
 * HTTPS (works on Vercel and Heroku alike).
 *
 * ```ts
 * createChatHandler({ bots, limits: { store: upstashStore() } });
 * ```
 */
export function upstashStore(options: UpstashStoreOptions = {}): RateLimitStore {
  const prefix = options.prefix ?? 'askdare:';
  const client = lazyClient(options);

  return {
    shared: true,
    async hit(key: string, windowMs: number, amount: number): Promise<CounterHit> {
      const [count, ttl] = await client().eval<[number, number], [number, number]>(
        HIT_SCRIPT,
        [`${prefix}${key}`],
        [amount, windowMs],
      );
      return { count: Number(count), resetMs: Math.max(0, Number(ttl)) };
    },
  };
}
