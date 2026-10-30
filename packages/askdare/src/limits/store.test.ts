import { describe, expect, it } from 'vitest';
import { memoryStore } from './store';

describe('memoryStore', () => {
  it('drops expired windows within a minute, even when there is room', async () => {
    let clock = 0;
    const store = memoryStore({ now: () => clock });
    await store.hit('ask:s:support:203.0.113.7', 60_000, 1);
    await store.hit('ask:t:support:2026-10-30', 86_400_000, 500);
    expect(store.size).toBe(2);

    clock = 2 * 60_000;
    await store.hit('ask:t:support:2026-10-30', 86_400_000, 0);
    // The rate counter, with the visitor's IP in its key, is gone; the day's budget stays.
    expect(store.size).toBe(1);
    expect((await store.hit('ask:t:support:2026-10-30', 86_400_000, 0)).count).toBe(500);
  });
});
