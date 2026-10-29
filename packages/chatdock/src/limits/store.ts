/** Result of incrementing a fixed-window counter. */
export interface CounterHit {
  /** Counter value after the increment. */
  readonly count: number;
  /** Milliseconds until the window resets. */
  readonly resetMs: number;
}

/**
 * Shared counter storage behind rate limits and budgets. The in-memory default works for a single
 * instance; multi-instance deployments (Vercel, several dynos) need a shared store such as
 * `@boldare/chatdock-upstash`. Implementations must be atomic per key.
 */
export interface RateLimitStore {
  /** Adds `amount` (0 reads without changing) to `key`, starting a `windowMs` window if none is open. */
  hit(key: string, windowMs: number, amount: number): Promise<CounterHit>;
  /** True for stores that are shared across server instances. */
  readonly shared: boolean;
}

export interface MemoryStoreOptions {
  /** Clock in ms, for tests. */
  readonly now?: () => number;
  /** Upper bound on tracked keys; the oldest windows are evicted first. Default 50 000. */
  readonly maxKeys?: number;
}

/** Per-process counters. Limits are per instance, so they are weak on serverless platforms. */
export function memoryStore(options: MemoryStoreOptions = {}): RateLimitStore {
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? 50_000;
  const windows = new Map<string, { count: number; resetAt: number }>();

  return {
    shared: false,
    async hit(key, windowMs, amount) {
      const time = now();
      let window = windows.get(key);
      if (!window || window.resetAt <= time) {
        windows.delete(key);
        if (windows.size >= maxKeys) {
          for (const [staleKey, stale] of windows) {
            if (stale.resetAt <= time || windows.size >= maxKeys) windows.delete(staleKey);
            if (windows.size < maxKeys) break;
          }
        }
        window = { count: 0, resetAt: time + windowMs };
        windows.set(key, window);
      }
      window.count += amount;
      return { count: window.count, resetMs: window.resetAt - time };
    },
  };
}
