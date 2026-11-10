/** What a page may set with askdare('configure') or the props of `Root`, checked again here. */
export interface PageOptions {
  readonly greeting?: string;
  readonly starters?: readonly string[];
  readonly context?: string;
}

const MAX_CONTEXT = 1_000;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * A JWT-shaped string, or null to sign out; the server verifies it. Any other string signs out
 * too, so a broken token never leaves the previous user signed in.
 */
export function identityToken(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  if (value.length <= 4096 && JWT.test(value)) return value;
  console.warn("[askdare] askdare('identify') got something that isn't a JWT; signing out.");
  return null;
}

/** Keeps only the allowed fields, trimmed and within their limits. */
export function pageOptions(data: Readonly<Record<string, unknown>>): PageOptions {
  const greeting = typeof data['greeting'] === 'string' ? data['greeting'].trim() : '';
  const starters = Array.isArray(data['starters'])
    ? data['starters']
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0 && item.length <= 80)
        .slice(0, 4)
    : undefined;
  const context = typeof data['context'] === 'string' ? data['context'].trim() : '';
  return {
    ...(greeting && greeting.length <= 500 ? { greeting } : {}),
    ...(starters ? { starters } : {}),
    ...(context ? { context: context.slice(0, MAX_CONTEXT) } : {}),
  };
}
