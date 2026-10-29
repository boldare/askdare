import { defineTool } from '@boldare/chatdock';
import { z } from 'zod';

/** Example without network access: the current time in a time zone. */
export const currentTime = defineTool({
  name: 'get_current_time',
  description: 'Current date and time in an IANA time zone. Use it for any question about "now".',
  input: z.object({
    timeZone: z.string().describe('IANA time zone, for example Europe/Warsaw or Asia/Tokyo'),
  }),
  execute: ({ timeZone }) => {
    try {
      const now = new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'full',
        timeStyle: 'long',
        timeZone,
      }).format(new Date());
      return { timeZone, now };
    } catch {
      return { error: `Unknown time zone "${timeZone}".` };
    }
  },
});

/** Example calling a public API: ECB reference rates via Frankfurter (no key needed). */
export const exchangeRate = defineTool({
  name: 'get_exchange_rate',
  description: 'Latest ECB reference exchange rate between two currencies (ISO 4217 codes).',
  input: z.object({
    from: z.string().length(3).describe('Base currency, for example EUR'),
    to: z.string().length(3).describe('Quote currency, for example PLN'),
  }),
  execute: async ({ from, to }, { signal }) => {
    const base = from.toUpperCase();
    const quote = to.toUpperCase();
    const url = new URL('https://api.frankfurter.dev/v1/latest');
    url.searchParams.set('base', base);
    url.searchParams.set('symbols', quote);
    const response = await fetch(url, { signal });
    if (!response.ok) return { error: `No rate for ${base}/${quote}.` };
    const data = (await response.json()) as { date: string; rates: Record<string, number> };
    const rate = data.rates[quote];
    return rate === undefined
      ? { error: `No rate for ${base}/${quote}.` }
      : { base, quote, rate, date: data.date };
  },
});
