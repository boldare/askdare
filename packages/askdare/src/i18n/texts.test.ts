import { describe, expect, it } from 'vitest';
import { formatText, pluralText, textLocale, textsFor } from './texts';

describe('dictionaries', () => {
  it('translate every key into Polish', () => {
    const english = textsFor('en');
    const polish = textsFor('pl-PL');
    const untranslated = Object.keys(english).filter(
      (key) => polish[key] === english[key] && !['welcome.online'].includes(key),
    );
    expect(untranslated).toEqual([]);
  });

  it('fall back to English for other languages and apply overrides', () => {
    expect(textLocale('de-AT')).toBe('de');
    expect(textLocale('nl-BE')).toBe('en');
    expect(textsFor('nl', { 'composer.send': 'Verzenden' })['composer.send']).toBe('Verzenden');
    expect(textsFor('de', { 'composer.send': 'Abschicken' })['composer.send']).toBe('Abschicken');
  });

  it.each(['cs', 'de', 'es', 'fr', 'it', 'pl'])('translate every key into %s', (locale) => {
    const english = textsFor('en');
    const own = textsFor(locale);
    // Words that read the same in the language, such as "Online" or "Sources", may match English.
    const same = new Set(['welcome.online', 'message.sources', 'header.title']);
    const untranslated = Object.keys(english).filter(
      (key) => own[key] === english[key] && !same.has(key),
    );
    expect(untranslated).toEqual([]);
  });

  it.each(['cs', 'de', 'es', 'fr', 'it', 'pl'])(
    'keep every placeholder of the English text in %s',
    (locale) => {
      const english = textsFor('en');
      const own = textsFor(locale);
      const names = (text = '') => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      for (const key of Object.keys(own)) {
        const base = key.replace(/\.(zero|one|two|few|many|other)$/, '.other');
        expect(names(own[key]), `${locale} ${key}`).toEqual(names(english[base] ?? english[key]));
      }
    },
  );

  it('pick Czech plural forms', () => {
    const czech = textsFor('cs');
    const count = (n: number) => pluralText(czech, 'message.attachments', n, 'cs');
    expect([1, 3, 5, 1.5].map(count)).toEqual([
      '1 příloha',
      '3 přílohy',
      '5 příloh',
      '1.5 přílohy',
    ]);
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
