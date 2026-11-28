import { canonicalLocale } from '../i18n/locale';

/**
 * A text the visitor reads: one string for every language, or a map by BCP 47 tag
 * (`{ en: 'Name', pl: 'Imię' }`), as the bot's `texts` are (ADR-0031).
 */
export type FormText = string | Readonly<Record<string, string>>;

/** Languages one text may have. */
const MAX_LANGUAGES = 20;

/** The language part of a BCP 47 tag, lowercase: `pl` for `pl-PL`. */
const primarySubtag = (tag: string): string => (tag.split('-')[0] ?? tag).toLowerCase();

/**
 * What is wrong with a text, or undefined. A map needs at least one language, tags Intl accepts,
 * no language twice, and every string non-empty after trimming and within `max` characters,
 * counted in UTF-16 code units as the protocol and the browser count them.
 */
export function formTextProblem(text: unknown, max: number): string | undefined {
  const tooLong = `must be at most ${max} characters`;
  if (typeof text === 'string') {
    if (text.trim() === '') return 'must not be empty';
    return text.trim().length > max ? tooLong : undefined;
  }
  if (typeof text !== 'object' || text === null || Array.isArray(text)) {
    return 'must be a string or a map of strings by language';
  }
  const entries = Object.entries(text);
  if (entries.length === 0) return 'must have at least one language';
  if (entries.length > MAX_LANGUAGES) return `has more than ${MAX_LANGUAGES} languages`;
  const tags = entries.map(([tag]) => canonicalLocale(tag));
  if (tags.some((tag) => tag === undefined)) {
    return 'must use BCP 47 tags like en or pl-PL as languages';
  }
  if (new Set(tags).size !== tags.length) return 'has the same language twice';
  for (const [, value] of entries) {
    if (typeof value !== 'string' || value.trim() === '') return 'must not be empty';
    if (value.trim().length > max) return tooLong;
  }
  return undefined;
}

/** A checked text, trimmed, with canonical tags. Call only after `formTextProblem` passed. */
export function normalizeFormText(text: FormText): FormText {
  if (typeof text === 'string') return text.trim();
  return Object.freeze(
    Object.fromEntries(
      Object.entries(text).map(([tag, value]) => [canonicalLocale(tag) ?? tag, value.trim()]),
    ),
  );
}

/**
 * The text for a visitor in `locale`: the one for the tag, else its language, else another tag
 * of the same language (`pl-PL` for `pl`), else English, else the first one given.
 */
export function resolveFormText(text: FormText, locale: string): string {
  if (typeof text === 'string') return text;
  const entries = Object.entries(text);
  const tag = canonicalLocale(locale) ?? locale;
  const language = primarySubtag(tag);
  const sameLanguage = (wanted: string): string | undefined =>
    entries.find(([other]) => primarySubtag(other) === wanted)?.[1];
  return (
    text[tag] ??
    text[language] ??
    sameLanguage(language) ??
    text['en'] ??
    sameLanguage('en') ??
    entries[0]?.[1] ??
    ''
  );
}
