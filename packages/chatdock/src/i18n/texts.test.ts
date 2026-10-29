import { describe, expect, it } from 'vitest';
import { formatText, pluralText, TEXT_KEYS, textLocale, textsFor } from './texts';

describe('dictionaries', () => {
  it('translate every key into Polish', () => {
    const english = textsFor('en');
    const polish = textsFor('pl-PL');
    const untranslated = TEXT_KEYS.filter(
      (key) => polish[key] === english[key] && !['welcome.online'].includes(key),
    );
    expect(untranslated).toEqual([]);
  });

  it('fall back to English for other languages and apply overrides', () => {
    expect(textLocale('de-AT')).toBe('en');
    expect(textsFor('de', { 'composer.send': 'Senden' })['composer.send']).toBe('Senden');
  });

  it('pick Polish plural forms and fill placeholders', () => {
    const polish = textsFor('pl');
    const count = (n: number) => pluralText(polish, 'message.attachments', n, 'pl');
    expect([1, 3, 5, 22, 25].map(count)).toEqual([
      '1 załącznik',
      '3 załączniki',
      '5 załączników',
      '22 załączniki',
      '25 załączników',
    ]);
    expect(pluralText(textsFor('en'), 'message.attachments', 2, 'en')).toBe('2 attachments');
    expect(formatText('Remove {name} {missing}', { name: 'a.pdf' })).toBe('Remove a.pdf {missing}');
  });
});
