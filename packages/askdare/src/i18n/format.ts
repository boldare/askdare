/** Text helpers the widget needs; the dictionaries stay on the server. */

/** Fills `{name}` placeholders. */
export function formatText(
  template: string,
  params: Readonly<Record<string, string | number>> = {},
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** A plural text such as `message.attachments` for a count, by the locale's plural rules. */
export function pluralText(
  texts: Readonly<Record<string, string>>,
  base: string,
  count: number,
  locale: string,
): string {
  let category: Intl.LDMLPluralRule = 'other';
  try {
    category = new Intl.PluralRules(locale).select(count);
  } catch {
    // An unusual tag: fall back to the generic form rather than break the chat.
  }
  const template = texts[`${base}.${category}`] ?? texts[`${base}.other`] ?? '';
  return formatText(template, { count });
}
