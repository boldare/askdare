import { describe, expect, it } from 'vitest';
import type { RateLimitStore } from './store';

/**
 * Behaviour every RateLimitStore must have. Used by the in-memory store and by add-ons
 * (for example @boldare/chatdock-upstash) so they stay interchangeable.
 */
export function rateLimitStoreContract(name: string, create: () => RateLimitStore): void {
  describe(`${name} (RateLimitStore contract)`, () => {
    it('accumulates amounts within a window', async () => {
      const store = create();
      expect((await store.hit('contract:a', 60_000, 1)).count).toBe(1);
      expect((await store.hit('contract:a', 60_000, 5)).count).toBe(6);
    });

    it('reads without changing when the amount is 0', async () => {
      const store = create();
      await store.hit('contract:b', 60_000, 2);
      expect((await store.hit('contract:b', 60_000, 0)).count).toBe(2);
      expect((await store.hit('contract:b', 60_000, 0)).count).toBe(2);
    });

    it('keeps keys independent', async () => {
      const store = create();
      await store.hit('contract:c', 60_000, 3);
      expect((await store.hit('contract:d', 60_000, 1)).count).toBe(1);
    });

    it('reports the time left in the window', async () => {
      const store = create();
      const { resetMs } = await store.hit('contract:e', 60_000, 1);
      expect(resetMs).toBeGreaterThan(0);
      expect(resetMs).toBeLessThanOrEqual(60_000);
    });
  });
}
