/** The canonical form of a BCP 47 tag that Intl accepts (plural rules need it), else undefined. */
export function canonicalLocale(tag: string): string | undefined {
  if (tag.length > 35) return undefined;
  try {
    return Intl.getCanonicalLocales(tag)[0];
  } catch {
    return undefined;
  }
}
