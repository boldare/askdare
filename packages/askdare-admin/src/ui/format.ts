const integer = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const money = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 });

export const formatInteger = (value: number): string => integer.format(value);
/** A cost in the app's own currency, which the dashboard doesn't know. */
export const formatCost = (value: number | null): string =>
  value === null ? 'no price' : money.format(value);
export const formatRate = (value: number | null): string =>
  value === null ? '–' : percent.format(value);
export const formatTime = (at: number): string =>
  new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const DAY_MS = 86_400_000;
export const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10);

/** The last `count` UTC days up to today, both ends included. */
export function lastDays(count: number, now = Date.now()): { from: string; to: string } {
  return { from: dayOf(now - (count - 1) * DAY_MS), to: dayOf(now) };
}

/** Every day from `from` to `to`. */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let at = Date.parse(`${from}T00:00:00Z`); at <= end; at += DAY_MS) days.push(dayOf(at));
  return days;
}
