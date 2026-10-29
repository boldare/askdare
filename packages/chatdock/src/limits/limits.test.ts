import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineBot } from '../bot/define-bot';
import { defineTool } from '../tools/define-tool';
import { getClientIp, normalizeIp } from './client-ip';
import { createLimits } from './limits';
import { memoryStore } from './store';
import { rateLimitStoreContract } from './store-contract';

const bot = defineBot({
  id: 'support',
  model: 'm',
  instructions: 'x',
  limits: {
    maxOutputTokens: 100,
    dailyTokens: 1_000,
    dailyTokensPerIp: 600,
    sessionsPerIpPerHour: 2,
    conversationsPerIpPerHour: 3,
    messagesPerVisitorPerMinute: 2,
    messagesPerIpPerMinute: 3,
    maxTurns: 2,
  },
});

const DAY_KEY = 'cd:t:support:2026-10-29';
const usage = (input: number, output: number) => ({
  inputTokens: input,
  cachedInputTokens: 0,
  outputTokens: output,
});

function setup(start = Date.parse('2026-10-29T12:00:00Z'), globalDailyTokens?: number) {
  let clock = start;
  const store = memoryStore({ now: () => clock });
  let disabled = false;
  const limits = createLimits({
    store,
    now: () => clock,
    disabled: () => disabled,
    globalDailyTokens,
  });
  const spent = async (key = DAY_KEY) => (await store.hit(key, 1, 0)).count;
  return {
    limits,
    spent,
    advance: (ms: number) => {
      clock += ms;
    },
    disable: () => {
      disabled = true;
    },
  };
}

/** Each turn reserves ceil(20 / 2) + maxOutputTokens 100 = 110 tokens before history. */
const turn = (clientIp: string, visitorId: string, conversationId?: string) => ({
  clientIp,
  visitorId,
  conversationId,
  inputChars: 20,
});

rateLimitStoreContract('memoryStore', () => memoryStore());

describe('memoryStore', () => {
  it('counts within a window, refunds with negative amounts and resets after the window', async () => {
    let clock = 0;
    const store = memoryStore({ now: () => clock });
    expect(await store.hit('k', 1_000, 3)).toEqual({ count: 3, resetMs: 1_000 });
    expect(await store.hit('k', 1_000, -1)).toEqual({ count: 2, resetMs: 1_000 });
    clock = 1_000;
    expect(await store.hit('k', 1_000, 1)).toEqual({ count: 1, resetMs: 1_000 });
  });

  it('evicts short-lived rate counters before it would ever forget a budget', async () => {
    const store = memoryStore({ maxKeys: 3 });
    await store.hit('budget', 2 * 86_400_000, 900);
    for (const key of ['r1', 'r2', 'r3', 'r4', 'r5']) await store.hit(key, 60_000, 1);
    expect((await store.hit('budget', 2 * 86_400_000, 0)).count).toBe(900);
  });

  it('fails closed instead of evicting live long windows', async () => {
    const store = memoryStore({ maxKeys: 2 });
    await store.hit('budget-a', 2 * 86_400_000, 1);
    await store.hit('budget-b', 2 * 86_400_000, 1);
    await expect(store.hit('budget-c', 2 * 86_400_000, 1)).rejects.toThrow(/full/);
  });
});

describe('sessions', () => {
  it('limits new sessions per IP per hour', async () => {
    const { limits, advance } = setup();
    await limits.checkSession(bot, { clientIp: '1.1.1.1' });
    await limits.checkSession(bot, { clientIp: '1.1.1.1' });
    await expect(limits.checkSession(bot, { clientIp: '1.1.1.1' })).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfterMs: expect.any(Number),
    });
    await expect(limits.checkSession(bot, { clientIp: '2.2.2.2' })).resolves.toBeUndefined();
    advance(60 * 60_000);
    await expect(limits.checkSession(bot, { clientIp: '1.1.1.1' })).resolves.toBeUndefined();
  });

  it('counts renewals by returning visitors per visitor, not per shared IP', async () => {
    const { limits } = setup();
    for (let index = 0; index < 5; index += 1) {
      await limits.checkSession(bot, { clientIp: 'nat', returningVisitorId: `v${index}` });
    }
    await expect(limits.checkSession(bot, { clientIp: 'nat' })).resolves.toBeUndefined();
  });
});

describe('turns', () => {
  it('limits messages per visitor and per IP', async () => {
    const { limits } = setup();
    await limits.beginTurn(bot, turn('ip', 'v1', 'c1'));
    await limits.beginTurn(bot, turn('ip', 'v1', 'c1'));
    await expect(limits.beginTurn(bot, turn('ip', 'v1', 'c1'))).rejects.toMatchObject({
      code: 'rate_limited',
    });
    await limits.beginTurn(bot, turn('ip', 'v2', 'c2'));
    await expect(limits.beginTurn(bot, turn('ip', 'v3', 'c3'))).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });

  it('limits new conversations per IP', async () => {
    const { limits, advance } = setup();
    for (const visitor of ['a', 'b', 'c']) {
      await limits.beginTurn(bot, turn('ip-c', visitor));
      advance(61_000);
    }
    await expect(limits.beginTurn(bot, turn('ip-c', 'd'))).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });

  it('counts the first turn of a new conversation and stops long conversations', async () => {
    const { limits, advance } = setup();
    const first = await limits.beginTurn(bot, turn('ip-t', 'v'));
    await first.settle(usage(10, 10), 'conv_long');
    advance(61_000);
    await limits.beginTurn(bot, turn('ip-t', 'v', 'conv_long'));
    advance(61_000);
    await expect(limits.beginTurn(bot, turn('ip-t', 'v', 'conv_long'))).rejects.toMatchObject({
      code: 'rate_limited',
      message: expect.stringContaining('new one'),
    });
  });
});

describe('budgets', () => {
  it('keeps the estimate charged when a turn never settles (aborted or failed)', async () => {
    const { limits, spent } = setup();
    await limits.beginTurn(bot, turn('ip', 'v'));
    expect(await spent()).toBe(110);
  });

  it('replaces the estimate with real usage and includes history in the next estimate', async () => {
    const { limits, spent, advance } = setup();
    const first = await limits.beginTurn(bot, turn('ip', 'v'));
    await first.settle(usage(40, 25), 'conv_1');
    expect(await spent()).toBe(65);
    advance(61_000);
    await limits.beginTurn(bot, turn('ip', 'v', 'conv_1'));
    expect(await spent()).toBe(65 + 40 + 110);
  });

  it('rejects a turn that would exceed the bot budget and refunds the partial reservation', async () => {
    const { limits, spent } = setup();
    for (let index = 0; index < 9; index += 1) {
      await limits.beginTurn(bot, turn(`ip-${index}`, `v${index}`));
    }
    expect(await spent()).toBe(990);
    await expect(limits.beginTurn(bot, turn('ip-9', 'v9'))).rejects.toMatchObject({
      code: 'budget_exceeded',
      retryAfterMs: 12 * 60 * 60_000,
    });
    expect(await spent()).toBe(990);
    expect(await spent('cd:ti:support:ip-9:2026-10-29')).toBe(0);
  });

  it('caps one IP below the bot budget so it cannot take the bot offline for everyone', async () => {
    const { limits, advance } = setup();
    for (let index = 0; index < 5; index += 1) {
      await limits.beginTurn(bot, turn('greedy', `v${index}`, `conv_${index}`));
      advance(61_000);
    }
    await expect(limits.beginTurn(bot, turn('greedy', 'v9', 'conv_9'))).rejects.toMatchObject({
      code: 'budget_exceeded',
    });
    await expect(limits.beginTurn(bot, turn('someone-else', 'w'))).resolves.toBeDefined();
  });

  it('cannot be overshot by concurrent turns', async () => {
    const { limits } = setup();
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) =>
        limits.beginTurn(bot, turn(`p${index}`, `c${index}`)),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(9);
  });

  it('applies a global budget across bots', async () => {
    const { limits } = setup(Date.parse('2026-10-29T12:00:00Z'), 150);
    await limits.beginTurn(bot, turn('a', 'v'));
    await expect(limits.beginTurn(bot, turn('b', 'w'))).rejects.toMatchObject({
      code: 'budget_exceeded',
    });
  });

  it('honours the kill switch', async () => {
    const { limits, disable } = setup();
    disable();
    await expect(limits.checkSession(bot, { clientIp: 'a' })).rejects.toMatchObject({
      code: 'bot_unavailable',
    });
    await expect(limits.beginTurn(bot, turn('a', 'v'))).rejects.toMatchObject({
      code: 'bot_unavailable',
    });
  });
});

describe('attachments', () => {
  const toolBot = defineBot({
    id: 'support',
    model: 'm',
    instructions: 'x',
    limits: { maxOutputTokens: 100, maxSteps: 4, dailyTokens: 100_000, dailyTokensPerIp: 100_000 },
    tools: [
      defineTool({ name: 'ping', description: 'Ping', input: z.object({}), execute: () => 'pong' }),
    ],
  });

  it('reserves file tokens once per model call the turn may make', async () => {
    const { limits, spent } = setup();
    await limits.beginTurn(bot, { ...turn('ip-a', 'va'), attachmentTokens: 300 });
    expect(await spent()).toBe(110 + 300);
    await limits.beginTurn(toolBot, { ...turn('ip-b', 'vb'), attachmentTokens: 300 });
    expect(await spent()).toBe(110 + 300 + 110 + 4 * 300);
  });

  it('caps uploads per visitor, per IP and per bot per day', async () => {
    const { limits, advance } = setup();
    const uploadBot = defineBot({
      id: 'support',
      model: 'm',
      instructions: 'x',
      limits: { uploadsPerVisitorPerHour: 2, uploadsPerIpPerHour: 3, uploadsPerDay: 4 },
    });
    await limits.checkUpload(uploadBot, { clientIp: 'ip', visitorId: 'v1' });
    await limits.checkUpload(uploadBot, { clientIp: 'ip', visitorId: 'v1' });
    await expect(
      limits.checkUpload(uploadBot, { clientIp: 'ip', visitorId: 'v1' }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    await limits.checkUpload(uploadBot, { clientIp: 'ip', visitorId: 'v2' });
    await expect(
      limits.checkUpload(uploadBot, { clientIp: 'ip', visitorId: 'v3' }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    advance(60 * 60 * 1000);
    await limits.checkUpload(uploadBot, { clientIp: 'ip-2', visitorId: 'v4' });
    await expect(
      limits.checkUpload(uploadBot, { clientIp: 'ip-3', visitorId: 'v5' }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
  });
});

describe('client IP', () => {
  const request = (headers: Record<string, string>) => new Request('https://app.test', { headers });

  it('takes the entry added by the trusted proxy, ignoring spoofed entries to its left', () => {
    const spoofed = request({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7' });
    expect(getClientIp(spoofed, 'heroku')).toBe('203.0.113.7');
    expect(getClientIp(spoofed, 1)).toBe('203.0.113.7');
    const twoProxies = request({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7, 10.0.0.1' });
    expect(getClientIp(twoProxies, 2)).toBe('203.0.113.7');
  });

  it('does not trust x-real-ip outside Vercel and requires enough proxy entries', () => {
    expect(getClientIp(request({ 'x-real-ip': '9.9.9.9' }), 1)).toBe('unknown');
    expect(getClientIp(request({ 'x-forwarded-for': '203.0.113.7' }), 2)).toBe('unknown');
    expect(getClientIp(request({ 'x-real-ip': '198.51.100.1' }), 'vercel')).toBe('198.51.100.1');
  });

  it('rejects garbage and oversized values', () => {
    expect(getClientIp(request({ 'x-forwarded-for': 'x'.repeat(5_000) }), 1)).toBe('unknown');
    expect(getClientIp(request({ 'x-forwarded-for': '<script>' }), 1)).toBe('unknown');
  });

  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['203.0.113.7:51234', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['2001:db8:85a3:12:8a2e:370:7334:1', '2001:db8:85a3:12::/64'],
    ['2001:db8:85a3:12::99', '2001:db8:85a3:12::/64'],
    ['[2001:db8::1]:443', '2001:db8:0:0::/64'],
    ['256.1.1.1', undefined],
    ['2001:db8::1::2', undefined],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeIp(input)).toBe(expected);
  });
});
