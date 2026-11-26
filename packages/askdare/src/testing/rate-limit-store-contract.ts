import type { RateLimitStore } from '../limits/store';
import type { ContractRunner } from './runner';

/**
 * The behaviour every `RateLimitStore` must have, so the in-memory store and add-ons such as
 * `@boldare/askdare-upstash` stay interchangeable. Run it with your runner's `describe`, `it` and
 * `expect`:
 *
 * ```ts
 * import { rateLimitStoreContract } from '@boldare/askdare/testing';
 * import { describe, expect, it } from 'vitest';
 *
 * rateLimitStoreContract('my store', () => myStore(), { describe, it, expect });
 * ```
 */
export function rateLimitStoreContract(
  name: string,
  create: () => RateLimitStore,
  runner: ContractRunner,
): void {
  const { describe, it, expect } = runner;
  // A fresh prefix per run, so counters a store kept from an earlier run don't interfere.
  const run = crypto.randomUUID();
  const key = (id: string): string => `contract:${run}:${id}`;
  describe(`${name} (RateLimitStore contract)`, () => {
    it('accumulates amounts within a window', async () => {
      const store = create();
      expect((await store.hit(key('a'), 60_000, 1)).count).toBe(1);
      expect((await store.hit(key('a'), 60_000, 5)).count).toBe(6);
    });

    it('reads without changing when the amount is 0', async () => {
      const store = create();
      await store.hit(key('b'), 60_000, 2);
      expect((await store.hit(key('b'), 60_000, 0)).count).toBe(2);
      expect((await store.hit(key('b'), 60_000, 0)).count).toBe(2);
    });

    it('keeps keys independent', async () => {
      const store = create();
      await store.hit(key('c'), 60_000, 3);
      expect((await store.hit(key('d'), 60_000, 1)).count).toBe(1);
    });

    it('reports the time left in the window', async () => {
      const store = create();
      const { resetMs } = await store.hit(key('e'), 60_000, 1);
      expect(resetMs > 0).toBe(true);
      expect(resetMs <= 60_000).toBe(true);
    });
  });
}
