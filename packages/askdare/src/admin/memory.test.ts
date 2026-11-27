import { describe, expect, it, vi } from 'vitest';
import { adminStoreContract } from '../testing/admin-store-contract';
import { memoryAdminStore } from './memory';
import type { AdminTurnRecord } from './port';

adminStoreContract('memoryAdminStore', () => memoryAdminStore(), { describe, it, expect });

const turn: AdminTurnRecord = {
  bot: 'support',
  conversationId: 'c1',
  visitor: 'v1',
  at: Date.UTC(2026, 10, 26, 12),
  source: 'chat',
  model: 'm',
  durationMs: 10,
  outcome: 'completed',
  usage: {
    inputTokens: 1,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 1,
    reasoningTokens: 0,
  },
  steps: 1,
  tools: [{ name: 'lookup_order', outcome: 'ok' }],
  citations: 0,
  newConversation: true,
  unanswered: false,
};
const range = { from: '2026-11-26', to: '2026-11-26' };

describe('memoryAdminStore', () => {
  it('warns in production that records stay in one instance', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      memoryAdminStore();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('kept in memory, per instance'));
    } finally {
      warn.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('returns copies: changing a returned row changes nothing stored', async () => {
    const store = memoryAdminStore();
    await store.recordTurn(turn);
    const [row] = (await store.days(range)).turns;
    if (row) (row.usage as { inputTokens: number }).inputTokens = 99;
    const [summary] = (await store.conversations({ ...range, order: 'latest', limit: 1 })).items;
    if (summary) (summary as { turns: number }).turns = 99;
    expect((await store.days(range)).turns[0]?.usage.inputTokens).toBe(1);
    expect(
      (await store.conversations({ ...range, order: 'latest', limit: 1 })).items[0]?.turns,
    ).toBe(1);
  });

  it('refuses a cursor it did not issue', async () => {
    const store = memoryAdminStore();
    await expect(store.ratings({ ...range, limit: 10, cursor: 'nope' })).rejects.toThrow();
  });

  it('writes and sweeps nothing once the signal is aborted', async () => {
    const store = memoryAdminStore();
    await expect(store.recordTurn(turn, { signal: AbortSignal.abort() })).rejects.toThrow();
    await store.recordTurn(turn);
    const options = { recordsBefore: Date.now() + 1, daysBefore: '2100-01-01', limit: 10 };
    await expect(store.sweep(options, AbortSignal.abort())).rejects.toThrow();
    expect((await store.days(range)).turns[0]?.turns).toBe(1);
  });
});
