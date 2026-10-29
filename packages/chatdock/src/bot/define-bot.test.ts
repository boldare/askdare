import { describe, expect, it } from 'vitest';
import { defineBot } from './define-bot';

describe('defineBot', () => {
  it('applies default limits and normalizes instructions to a function', () => {
    const bot = defineBot({ id: 'support', model: 'test-model', instructions: 'Be helpful.' });
    expect(bot.limits).toEqual({
      maxOutputTokens: 1024,
      maxInputChars: 4000,
      maxSteps: 5,
      turnTimeoutMs: 120_000,
      dailyTokens: 2_000_000,
      sessionsPerIpPerHour: 20,
      messagesPerVisitorPerMinute: 10,
      messagesPerIpPerMinute: 30,
      maxTurns: 50,
    });
    expect(bot.instructions({ locale: 'en' })).toBe('Be helpful.');
  });

  it('keeps instruction functions and overrides selected limits', () => {
    const bot = defineBot({
      id: 'sales-pl',
      model: 'test-model',
      instructions: ({ locale }) => `Answer in ${locale}.`,
      limits: { maxSteps: 2 },
    });
    expect(bot.instructions({ locale: 'pl' })).toBe('Answer in pl.');
    expect(bot.limits.maxSteps).toBe(2);
    expect(bot.limits.maxOutputTokens).toBe(1024);
  });

  it('defaults the widget config and keeps allowed origins unique', () => {
    const bot = defineBot({
      id: 'a',
      model: 'm',
      instructions: 'x',
      security: { allowedOrigins: ['https://example.com', 'https://example.com'] },
      widget: { title: 'Helper', locale: 'pl' },
    });
    expect(bot.security.allowedOrigins).toEqual(['https://example.com']);
    expect(bot.widget).toMatchObject({
      title: 'Helper',
      locale: 'pl',
      greeting: expect.any(String),
    });
  });

  it('is frozen', () => {
    const bot = defineBot({ id: 'a', model: 'm', instructions: 'x' });
    expect(Object.isFrozen(bot)).toBe(true);
    expect(Object.isFrozen(bot.limits)).toBe(true);
  });

  it.each([
    [{ id: 'Bad Id', model: 'm', instructions: 'x' }, /id use 1-48 lowercase/],
    [{ id: 'ok', model: '  ', instructions: 'x' }, /model is required/],
    [{ id: 'ok', model: 'm', instructions: '' }, /instructions/],
    [{ id: 'ok', model: 'm', instructions: 'x', limits: { maxSteps: 50 } }, /limits\.maxSteps/],
    [
      {
        id: 'ok',
        model: 'm',
        instructions: 'x',
        security: { allowedOrigins: ['https://*.example.com'] },
      },
      /security\.allowedOrigins\.0 must be an origin/,
    ],
    [
      {
        id: 'ok',
        model: 'm',
        instructions: 'x',
        security: { allowedOrigins: ['https://example.com/path'] },
      },
      /must be an origin/,
    ],
    [{ id: 'ok', model: 'm', instructions: 'x', widget: { locale: 'english please' } }, /BCP 47/],
  ])('rejects invalid definitions (%#)', (definition, message) => {
    expect(() => defineBot(definition)).toThrow(message);
  });
});
