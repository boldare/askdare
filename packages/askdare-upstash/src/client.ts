import { Redis } from '@upstash/redis';
import type { RedisEval } from './index';

export interface ClientOptions {
  readonly redis?: RedisEval | undefined;
  readonly url?: string | undefined;
  readonly token?: string | undefined;
}

/**
 * The given client, or one created on first use from `url` and `token` or the environment. A
 * database from the Upstash console has the UPSTASH_ names; one from the Vercel Marketplace, KV_.
 */
export function lazyClient(options: ClientOptions): () => RedisEval {
  let redis = options.redis;
  return () => {
    if (!redis) {
      const env = process.env;
      const url = options.url ?? env['UPSTASH_REDIS_REST_URL'] ?? env['KV_REST_API_URL'];
      const token = options.token ?? env['UPSTASH_REDIS_REST_TOKEN'] ?? env['KV_REST_API_TOKEN'];
      if (!url || !token) {
        throw new Error(
          '[askdare-upstash] Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or pass a client.',
        );
      }
      redis = new Redis({ url, token });
    }
    return redis;
  };
}
