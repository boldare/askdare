import type { AdminRange } from '@boldare/askdare';

/**
 * The bounds every `AdminStore` query has (ADR-0032), as core's memory store checks them: a day
 * range of at most 400 days and a page of 1 to 100 items.
 */
export const MAX_RANGE_DAYS = 400;
export const MAX_PAGE = 100;
export const DAY_MS = 86_400_000;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const invalid = (message: string): Error => new Error(`[askdare-postgres] ${message}`);

/** The UTC day of an epoch-milliseconds time, as `YYYY-MM-DD`. */
export const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);

/** Epoch milliseconds of a `YYYY-MM-DD` day's start, or throws for a malformed or unreal day. */
export function parseDay(day: string): number {
  const at = typeof day === 'string' && DAY.test(day) ? Date.parse(`${day}T00:00:00Z`) : Number.NaN;
  if (Number.isNaN(at) || dayOf(at) !== day) throw invalid('A day must be YYYY-MM-DD.');
  return at;
}

/** A checked range: its days, the epoch milliseconds it covers (`end` excluded), and its filters. */
export interface CheckedRange {
  readonly from: string;
  readonly to: string;
  readonly start: number;
  readonly end: number;
  /** `null` for every bot. */
  readonly bot: string | null;
  /** `null` for both sources. */
  readonly source: 'chat' | 'console' | null;
}

/** Checks a range, or throws. */
export function checkRange(range: AdminRange): CheckedRange {
  const start = parseDay(range.from);
  const last = parseDay(range.to);
  const days = (last - start) / DAY_MS + 1;
  if (days < 1) throw invalid('A range must end on or after its start.');
  if (days > MAX_RANGE_DAYS) throw invalid(`A range covers at most ${MAX_RANGE_DAYS} days.`);
  const wanted = range.source ?? 'chat';
  if (wanted !== 'chat' && wanted !== 'console' && wanted !== 'all') {
    throw invalid('A source must be chat, console or all.');
  }
  return {
    from: range.from,
    to: range.to,
    start,
    end: last + DAY_MS,
    bot: range.bot ?? null,
    source: wanted === 'all' ? null : wanted,
  };
}

/** Checks a page limit, or throws. */
export function checkLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
    throw invalid(`A limit must be 1 to ${MAX_PAGE}.`);
  }
  return limit;
}

/** Checks a record's time: whole epoch milliseconds a `Date` can hold. */
export function checkAt(at: number): number {
  if (!Number.isSafeInteger(at) || Math.abs(at) > 8.64e15) {
    throw invalid('A record time must be whole epoch milliseconds.');
  }
  return at;
}

/**
 * A page cursor: the sort key of the last item returned, as base64url JSON with a tag naming the
 * list it belongs to. Anything else, including a cursor of another list, is refused.
 */
export function encodeCursor(tag: string, key: readonly (string | number)[]): string {
  return Buffer.from(JSON.stringify([tag, ...key])).toString('base64url');
}

/** The key of a cursor `encodeCursor` issued with `tag` and values of `shape`'s types, or throws. */
export function decodeCursor<const Shape extends readonly ('string' | 'number')[]>(
  cursor: string,
  tag: string,
  shape: Shape,
): { [K in keyof Shape]: Shape[K] extends 'number' ? number : string } {
  let parsed: unknown;
  try {
    parsed =
      typeof cursor === 'string' && cursor.length <= 2_048
        ? JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
        : undefined;
  } catch {
    parsed = undefined;
  }
  const valid =
    Array.isArray(parsed) &&
    parsed.length === shape.length + 1 &&
    parsed[0] === tag &&
    shape.every((type, index) => {
      const value: unknown = parsed[index + 1];
      return type === 'number' ? Number.isSafeInteger(value) : typeof value === 'string';
    });
  if (!valid) throw invalid('Unknown cursor.');
  // Checked against the shape just above.
  return (parsed as unknown[]).slice(1) as {
    [K in keyof Shape]: Shape[K] extends 'number' ? number : string;
  };
}
