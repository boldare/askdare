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
  ])('rejects invalid definitions (%#)', (definition, message) => {
    expect(() => defineBot(definition)).toThrow(message);
  });
});
