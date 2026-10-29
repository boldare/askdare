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
  const category = new Intl.PluralRules(locale).select(count);
  const template = texts[`${base}.${category}`] ?? texts[`${base}.other`] ?? '';
  return formatText(template, { count });
}
