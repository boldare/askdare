import { AskdareError } from '../errors';
import type { AdminRange, AdminSource } from './port';

/** The longest range a query may cover, in days (ADR-0032). */
export const MAX_RANGE_DAYS = 400;
/** The most items a page may hold. */
export const MAX_PAGE = 100;

const DAY_MS = 86_400_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const invalid = (message: string): AskdareError => new AskdareError('invalid_input', { message });

/** The UTC day of an epoch-milliseconds time, as `YYYY-MM-DD`. */
export const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);

/** Epoch milliseconds of a `YYYY-MM-DD` day's start, or throws for a malformed or unreal day. */
export function parseDay(day: string): number {
  const at = DAY.test(day) ? Date.parse(`${day}T00:00:00Z`) : Number.NaN;
  if (Number.isNaN(at) || dayOf(at) !== day) throw invalid('A day must be YYYY-MM-DD.');
  return at;
}

/** Checks a range and returns its bounds, plus a test for the source it asks for. */
export function checkRange(range: AdminRange): {
  readonly from: string;
  readonly to: string;
  readonly source: (source: AdminSource) => boolean;
} {
  const days = (parseDay(range.to) - parseDay(range.from)) / DAY_MS + 1;
  if (days < 1) throw invalid('A range must end on or after its start.');
  if (days > MAX_RANGE_DAYS) throw invalid(`A range covers at most ${MAX_RANGE_DAYS} days.`);
  const wanted = range.source ?? 'chat';
  return {
    from: range.from,
    to: range.to,
    source: (source) => wanted === 'all' || source === wanted,
  };
}

/** Checks a page limit. */
export function checkLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
    throw invalid(`A limit must be 1 to ${MAX_PAGE}.`);
  }
  return limit;
}
