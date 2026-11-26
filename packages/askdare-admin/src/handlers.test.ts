import {
  type AdminDashboardRequest,
  type AdminStore,
  type AdminTurnRecord,
  memoryAdminStore,
} from '@boldare/askdare';
import { beforeEach, describe, expect, it } from 'vitest';
import { cost, createHandlers, resolution } from './handlers';
import type { WireConversation, WireDays, WirePage, WireRating, WireTranscript } from './wire';

const DAY1 = Date.UTC(2026, 10, 24, 12);
const DAY2 = Date.UTC(2026, 10, 25, 12);

const usage = (inputTokens: number, outputTokens: number, cachedInputTokens = 0) => ({
  inputTokens,
  cachedInputTokens,
  cacheWriteTokens: 0,
  outputTokens,
  reasoningTokens: 0,
});

const turn = (overrides: Partial<AdminTurnRecord>): AdminTurnRecord => ({
  bot: 'support',
  conversationId: 'c1',
  visitor: 'v1',
  at: DAY1,
  source: 'chat',
  model: 'model-a',
  durationMs: 10,
  outcome: 'completed',
  usage: usage(1_000_000, 100_000, 500_000),
  steps: 1,
  tools: [],
  citations: 1,
  newConversation: true,
  unanswered: false,
  ...overrides,
});

/** Seals by keeping a table, as core's sealed references would: the browser gets opaque strings. */
function sealer() {
  const sealed = new Map<string, string>();
  return {
    seal: async (value: string) => {
      const reference = `ref-${sealed.size}`;
      sealed.set(reference, value);
      return reference;
    },
    open: async (reference: string) => sealed.get(reference),
  };
}

const prices = { 'model-a': { input: 2, cachedInput: 0.5, output: 8 } };

describe('dashboard handlers', () => {
  let store: AdminStore;
  let keys: ReturnType<typeof sealer>;
  const handlers = createHandlers(prices);
  const call = async <T>(action: string, input: unknown): Promise<T> => {
    const handler = handlers[action];
    if (!handler) throw new Error(`no handler ${action}`);
    const request: AdminDashboardRequest = {
      store,
      input,
      seal: keys.seal,
      open: keys.open,
      signal: new AbortController().signal,
    };
    return (await handler(request)) as T;
  };
  const range = { from: '2026-11-24', to: '2026-11-25' };

  beforeEach(async () => {
    store = memoryAdminStore();
    keys = sealer();
    await store.recordTurn(turn({}));
    await store.recordTurn(
      turn({ at: DAY1 + 1000, newConversation: false, unanswered: true, citations: 0 }),
    );
    await store.recordTurn(turn({ conversationId: 'c2', at: DAY2, usage: usage(10, 10) }));
    await store.recordTurn(
      turn({
        bot: 'sales',
        conversationId: 'c3',
        at: DAY2,
        model: 'model-unpriced',
        outcome: 'failed',
        usage: usage(5, 5),
      }),
    );
    // A playground turn the dashboard leaves out.
    await store.recordTurn(turn({ conversationId: 'c4', at: DAY2, source: 'console' }));
    await store.recordRating({
      bot: 'support',
      conversationId: 'c1',
      visitor: 'v1',
      at: DAY1 + 2000,
      source: 'chat',
      itemId: 'i1',
      rating: 'down',
      comment: '<b>wrong</b> answer',
    });
    await store.recordRating({
      bot: 'support',
      conversationId: 'c2',
      visitor: 'v2',
      at: DAY2 + 2000,
      source: 'chat',
      itemId: 'i2',
      rating: 'up',
    });
    await store.count({ kind: 'handoff', bot: 'support', at: DAY1, source: 'chat', state: 'sent' });
    await store.count({
      kind: 'handoff',
      bot: 'support',
      at: DAY1,
      source: 'chat',
      state: 'limited',
    });
    await store.count({ kind: 'lead', bot: 'support', at: DAY2, source: 'chat' });
  });

  describe('days', () => {
    it('prices rows per model and leaves models without a price at null', async () => {
      const days = await call<WireDays>('days', range);
      const day1 = days.models.find((row) => row.day === '2026-11-24' && row.bot === 'support');
      // Two turns of 1M input (500k cached) and 100k output at 2 / 0.5 / 8 per million.
      expect(day1).toMatchObject({ turns: 2, unanswered: 1 });
      expect(day1?.cost).toBeCloseTo(2 * (0.5 * 2 + 0.5 * 0.5 + 0.1 * 8));
      const unpriced = days.models.find((row) => row.model === 'model-unpriced');
      expect(unpriced).toMatchObject({ cost: null, failed: 1, tokens: { input: 5, output: 5 } });
      expect(days.totals.unpriced).toEqual(['model-unpriced']);
      expect(days.totals.cost).toBeCloseTo(2 * 2.05 + (10 * 2 + 10 * 8) / 1e6);
      expect(days.bots).toEqual(['sales', 'support']);
    });

    it('leaves playground turns out', async () => {
      const days = await call<WireDays>('days', range);
      expect(days.totals.turns).toBe(4);
      expect(days.totals.conversations).toBe(3);
    });

    it('gives the resolution rate per bot and day, without limited handoffs', async () => {
      const days = await call<WireDays>('days', { ...range, bot: 'support' });
      const day1 = days.days.find((row) => row.day === '2026-11-24');
      expect(day1).toMatchObject({
        conversations: 1,
        handoffs: 1,
        limited: 1,
        resolution: 0,
        down: 1,
      });
      const day2 = days.days.find((row) => row.day === '2026-11-25');
      expect(day2).toMatchObject({ conversations: 1, handoffs: 0, leads: 1, up: 1, resolution: 1 });
      expect(days.totals.resolution).toBe(0.5);
      expect(days.bots).toEqual(['support']);
    });

    it('refuses malformed and oversized ranges', async () => {
      await expect(call('days', { from: '2026-11-24' })).rejects.toMatchObject({
        code: 'invalid_input',
      });
      await expect(call('days', { from: '24.11.2026', to: '2026-11-25' })).rejects.toMatchObject({
        code: 'invalid_input',
      });
      await expect(call('days', 'nope')).rejects.toMatchObject({ code: 'invalid_input' });
      await expect(call('days', { from: '2024-01-01', to: '2026-11-25' })).rejects.toMatchObject({
        code: 'invalid_input',
      });
      await expect(call('days', { from: '2026-11-25', to: '2026-11-24' })).rejects.toMatchObject({
        code: 'invalid_input',
      });
    });
  });

  describe('conversations', () => {
    it('lists the most expensive first, with sealed references only', async () => {
      const page = await call<WirePage<WireConversation>>('conversations', range);
      expect(page.items.map((item) => item.bot)).toEqual(['support', 'support', 'sales']);
      expect(JSON.stringify(page)).not.toMatch(/"c[1-4]"/);
      expect(await keys.open(page.items[0]?.ref ?? '')).toBe('c1');
      expect(page.items[0]).toMatchObject({ turns: 2, down: 1, transcript: false });
      expect(page.items[0]?.cost).toBeCloseTo(4.1);
      // The sales bot answered with a model that has no price.
      expect(page.items[2]?.cost).toBeNull();
    });

    it('pages with sealed cursors', async () => {
      const first = await call<WirePage<WireConversation>>('conversations', { ...range, limit: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.cursor).toBeDefined();
      expect(first.cursor).not.toMatch(/^m:/);
      const second = await call<WirePage<WireConversation>>('conversations', {
        ...range,
        limit: 2,
        cursor: first.cursor,
      });
      expect(second.items.map((item) => item.bot)).toEqual(['sales']);
      expect(second.cursor).toBeUndefined();
    });

    it('refuses a reference as a cursor, a raw store cursor and bad limits', async () => {
      const page = await call<WirePage<WireConversation>>('conversations', range);
      await expect(
        call('conversations', { ...range, cursor: page.items[0]?.ref }),
      ).rejects.toMatchObject({ code: 'invalid_input' });
      await expect(call('conversations', { ...range, cursor: 'm:1' })).rejects.toMatchObject({
        code: 'invalid_input',
      });
      for (const limit of [0, 101, 1.5, '10']) {
        await expect(call('conversations', { ...range, limit })).rejects.toMatchObject({
          code: 'invalid_input',
        });
      }
      await expect(call('conversations', { ...range, order: 'cost' })).rejects.toMatchObject({
        code: 'invalid_input',
      });
    });

    it('orders by latest and filters to conversations with a 👎', async () => {
      const latest = await call<WirePage<WireConversation>>('conversations', {
        ...range,
        order: 'latest',
        bot: 'support',
      });
      expect(await Promise.all(latest.items.map((item) => keys.open(item.ref)))).toEqual([
        'c2',
        'c1',
      ]);
      const down = await call<WirePage<WireConversation>>('conversations', {
        ...range,
        rated: 'down',
      });
      expect(down.items).toHaveLength(1);
    });
  });

  describe('ratings', () => {
    it('lists 👎 answers with their comments as given', async () => {
      const page = await call<WirePage<WireRating>>('ratings', { ...range, rating: 'down' });
      expect(page.items).toEqual([
        expect.objectContaining({ bot: 'support', rating: 'down', comment: '<b>wrong</b> answer' }),
      ]);
      expect(await keys.open(page.items[0]?.ref ?? '')).toBe('c1');
      expect(page.items[0]).not.toHaveProperty('conversationId');
      expect(page.items[0]).not.toHaveProperty('visitor');
    });

    it('pages newest first', async () => {
      const first = await call<WirePage<WireRating>>('ratings', { ...range, limit: 1 });
      expect(first.items[0]?.rating).toBe('up');
      const second = await call<WirePage<WireRating>>('ratings', {
        ...range,
        limit: 1,
        cursor: first.cursor,
      });
      expect(second.items[0]?.rating).toBe('down');
      expect(second.cursor).toBeUndefined();
    });
  });

  describe('transcript', () => {
    it('returns the stored transcript of a sealed reference', async () => {
      await store.recordTranscript({
        bot: 'support',
        conversationId: 'c1',
        visitor: 'v1',
        at: DAY1,
        source: 'chat',
        itemId: 'i1',
        input: 'Where is my order?',
        attachments: 0,
        answer: 'It shipped [1].',
        citations: [{ index: 1, title: 'Shipping', url: 'https://example.com/shipping' }],
        reason: 'completed',
      });
      const page = await call<WirePage<WireConversation>>('conversations', range);
      const transcript = await call<WireTranscript>('transcript', { ref: page.items[0]?.ref });
      expect(transcript.turns).toEqual([
        {
          at: DAY1,
          input: 'Where is my order?',
          attachments: 0,
          answer: 'It shipped [1].',
          citations: [{ index: 1, title: 'Shipping', url: 'https://example.com/shipping' }],
          reason: 'completed',
        },
      ]);
    });

    it('answers empty without a transcript, and not_found for unknown references or cursors', async () => {
      const page = await call<WirePage<WireConversation>>('conversations', { ...range, limit: 1 });
      expect(await call('transcript', { ref: page.items[0]?.ref })).toEqual({ turns: [] });
      await expect(call('transcript', { ref: 'forged' })).rejects.toMatchObject({
        code: 'not_found',
      });
      await expect(call('transcript', { ref: page.cursor })).rejects.toMatchObject({
        code: 'not_found',
      });
      await expect(call('transcript', {})).rejects.toMatchObject({ code: 'invalid_input' });
    });
  });
});

describe('cost', () => {
  it('prices cached input at its own price, or as input without one', () => {
    expect(cost({ input: 1e6, cachedInput: 1e6, output: 0 }, { input: 2, output: 8 })).toBe(2);
    expect(
      cost({ input: 1e6, cachedInput: 1e6, output: 0 }, { input: 2, cachedInput: 0.5, output: 8 }),
    ).toBe(0.5);
    expect(cost({ input: 0, cachedInput: 0, output: 1e6 }, undefined)).toBeNull();
  });
});

describe('resolution', () => {
  it('is a ratio within 0 and 1, and null without new conversations', () => {
    expect(resolution(4, 1)).toBe(0.75);
    expect(resolution(1, 3)).toBe(0);
    expect(resolution(0, 2)).toBeNull();
  });
});
