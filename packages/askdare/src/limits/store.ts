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
 * `@boldare/askdare-upstash`. Implementations must be atomic per key.
 */
export interface RateLimitStore {
  /**
   * Adds `amount` to `key`, starting a `windowMs` window if none is open. `0` reads without
   * changing; negative amounts refund.
   */
  hit(key: string, windowMs: number, amount: number): Promise<CounterHit>;
  /** True for stores that are shared across server instances. */
  readonly shared: boolean;
}

export interface MemoryStoreOptions {
  /** Clock in ms, for tests. */
  readonly now?: () => number;
  /** Upper bound on tracked keys. Default 50 000. */
  readonly maxKeys?: number;
}

/** Windows up to this length are short-lived rate counters and may be evicted under pressure. */
const EVICTABLE_WINDOW_MS = 60 * 60_000;
/** Expired windows are dropped at least this often: their keys hold IP addresses. */
const SWEEP_INTERVAL_MS = 60_000;

/** The in-process store, with the number of windows it holds (for tests and diagnostics). */
export interface MemoryStore extends RateLimitStore {
  readonly size: number;
}

interface Window {
  count: number;
  resetAt: number;
  readonly windowMs: number;
}

/**
 * Per-process counters, kept in least-recently-used order. Expired windows are dropped every
 * minute. When full, it also drops the least recently used short-lived rate counters. It never
 * evicts long windows (budgets, conversation lengths): when only those remain, it fails closed
 * instead of forgetting spend.
 */
export function memoryStore(options: MemoryStoreOptions = {}): MemoryStore {
  const now = options.now ?? Date.now;
  const maxKeys = options.maxKeys ?? 50_000;
  const windows = new Map<string, Window>();
  let sweptAt = now();

  const sweep = (time: number): void => {
    for (const [key, window] of windows) {
      if (window.resetAt <= time) windows.delete(key);
    }
    sweptAt = time;
  };

  const makeRoom = (time: number): void => {
    sweep(time);
    for (const [key, window] of windows) {
      if (windows.size < maxKeys) return;
      if (window.windowMs <= EVICTABLE_WINDOW_MS) windows.delete(key);
    }
    if (windows.size >= maxKeys) {
      throw new Error('[askdare] In-memory rate-limit store is full; use a shared store.');
    }
  };

  return {
    shared: false,
    get size() {
      return windows.size;
    },
    async hit(key, windowMs, amount) {
      const time = now();
      if (time - sweptAt >= SWEEP_INTERVAL_MS) sweep(time);
      let window = windows.get(key);
      if (window && window.resetAt > time) {
        windows.delete(key); // re-inserted below: most recently used goes last
      } else {
        if (window) windows.delete(key);
        if (windows.size >= maxKeys) makeRoom(time);
        window = { count: 0, resetAt: time + windowMs, windowMs };
      }
      windows.set(key, window);
      window.count += amount;
      return { count: window.count, resetMs: window.resetAt - time };
    },
  };
}
