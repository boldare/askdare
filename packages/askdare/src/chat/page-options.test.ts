import { describe, expect, it } from 'vitest';
import { pageLocale } from './page-options';

describe('pageLocale', () => {
  it('canonicalizes a language tag', () => {
    expect(pageLocale('pl')).toBe('pl');
    expect(pageLocale('en-us')).toBe('en-US');
  });

  it('drops anything that is not a language tag', () => {
    for (const value of ['', 'not a language!', 'x'.repeat(36), 42, null, undefined, ['pl']]) {
      expect(pageLocale(value)).toBeUndefined();
    }
  });
});
