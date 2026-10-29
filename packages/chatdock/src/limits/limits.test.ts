import { describe, expect, it } from 'vitest';
import { defineBot } from '../bot/define-bot';
import { getClientIp } from './client-ip';
import { createLimits } from './limits';
import { memoryStore } from './store';
import { rateLimitStoreContract } from './store-contract';

const bot = defineBot({
  id: 'support',
  model: 'm',
  instructions: 'x',
  limits: {
    dailyTokens: 1_000,
    sessionsPerIpPerHour: 2,
    messagesPerVisitorPerMinute: 2,
    messagesPerIpPerMinute: 3,
    maxTurns: 2,
  },
});

function setup(start = Date.parse('2026-10-29T12:00:00Z')) {
  let clock = start;
  const store = memoryStore({ now: () => clock });
  let disabled = false;
  const limits = createLimits({ store, now: () => clock, disabled: () => disabled });
  return {
    limits,
    advance: (ms: number) => {
      clock += ms;
    },
    disable: () => {
      disabled = true;
    },
  };
}

describe('memoryStore', () => {
  it('counts within a window and resets after it', async () => {
    let clock = 0;
    const store = memoryStore({ now: () => clock });
    expect(await store.hit('k', 1_000, 1)).toEqual({ count: 1, resetMs: 1_000 });
    expect(await store.hit('k', 1_000, 2)).toEqual({ count: 3, resetMs: 1_000 });
    expect(await store.hit('k', 1_000, 0)).toMatchObject({ count: 3 });
    clock = 1_000;
    expect(await store.hit('k', 1_000, 1)).toEqual({ count: 1, resetMs: 1_000 });
  });

  it('caps the number of tracked keys', async () => {
    const store = memoryStore({ maxKeys: 3 });
    for (const key of ['a', 'b', 'c', 'd', 'e']) await store.hit(key, 60_000, 1);
    expect((await store.hit('a', 60_000, 0)).count).toBe(0);
    expect((await store.hit('e', 60_000, 0)).count).toBe(1);
  });
});

describe('limits', () => {
  it('limits sessions per IP per hour', async () => {
    const { limits, advance } = setup();
    await limits.checkSession(bot, '1.1.1.1');
    await limits.checkSession(bot, '1.1.1.1');
    await expect(limits.checkSession(bot, '1.1.1.1')).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfterMs: expect.any(Number),
    });
    await expect(limits.checkSession(bot, '2.2.2.2')).resolves.toBeUndefined();
    advance(60 * 60_000);
    await expect(limits.checkSession(bot, '1.1.1.1')).resolves.toBeUndefined();
  });

  it('limits messages per visitor and per IP', async () => {
    const { limits } = setup();
    await limits.checkMessage(bot, { clientIp: 'ip', visitorId: 'v1' });
    await limits.checkMessage(bot, { clientIp: 'ip', visitorId: 'v1' });
    await expect(
      limits.checkMessage(bot, { clientIp: 'ip', visitorId: 'v1' }),
    ).rejects.toMatchObject({
      code: 'rate_limited',
    });
    // Other visitors from the same IP share the per-IP cap (3 per minute).
    await limits.checkMessage(bot, { clientIp: 'ip', visitorId: 'v2' });
    await expect(
      limits.checkMessage(bot, { clientIp: 'ip', visitorId: 'v3' }),
    ).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });

  it('stops long conversations', async () => {
    const { limits, advance } = setup();
    await limits.checkMessage(bot, { clientIp: 'a', visitorId: 'v', conversationId: 'c' });
    advance(61_000);
    await limits.checkMessage(bot, { clientIp: 'a', visitorId: 'v', conversationId: 'c' });
    advance(61_000);
    await expect(
      limits.checkMessage(bot, { clientIp: 'a', visitorId: 'v', conversationId: 'c' }),
    ).rejects.toMatchObject({ code: 'rate_limited', message: expect.stringContaining('new one') });
  });

  it('enforces the daily token budget until UTC midnight', async () => {
    const { limits, advance } = setup(Date.parse('2026-10-29T23:00:00Z'));
    await limits.recordUsage(bot, { inputTokens: 900, cachedInputTokens: 0, outputTokens: 100 });
    await expect(limits.checkMessage(bot, { clientIp: 'a', visitorId: 'v' })).rejects.toMatchObject(
      {
        code: 'budget_exceeded',
        retryAfterMs: 60 * 60_000,
      },
    );
    advance(60 * 60_000);
    await expect(
      limits.checkMessage(bot, { clientIp: 'a', visitorId: 'v' }),
    ).resolves.toBeUndefined();
  });

  it('honours the kill switch', async () => {
    const { limits, disable } = setup();
    disable();
    await expect(limits.checkSession(bot, 'a')).rejects.toMatchObject({ code: 'bot_unavailable' });
    await expect(limits.checkMessage(bot, { clientIp: 'a', visitorId: 'v' })).rejects.toMatchObject(
      {
        code: 'bot_unavailable',
      },
    );
  });
});

describe('getClientIp', () => {
  const request = (headers: Record<string, string>) => new Request('https://app.test', { headers });

  it('takes the entry added by a single trusted proxy (Heroku appends the client IP)', () => {
    const spoofed = request({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7' });
    expect(getClientIp(spoofed, 'heroku')).toBe('203.0.113.7');
    expect(getClientIp(spoofed, 1)).toBe('203.0.113.7');
  });

  it('supports several trusted proxies', () => {
    expect(getClientIp(request({ 'x-forwarded-for': 'a, 203.0.113.7, 10.0.0.1' }), 2)).toBe(
      '203.0.113.7',
    );
  });

  it('uses the Vercel headers on Vercel', () => {
    expect(
      getClientIp(
        request({ 'x-real-ip': '198.51.100.1', 'x-forwarded-for': '198.51.100.1' }),
        'vercel',
      ),
    ).toBe('198.51.100.1');
  });

  it('falls back to a shared key when no proxy headers exist', () => {
    expect(getClientIp(request({}), 1)).toBe('unknown');
  });
});

rateLimitStoreContract('memoryStore', () => memoryStore());
