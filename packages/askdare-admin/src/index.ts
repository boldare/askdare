/**
 * `@boldare/askdare-admin`: the stage 2 dashboard (ADR-0032, decision 9). It plugs into the admin
 * console that `createChatHandler` serves: core writes the records, checks access, sets the headers
 * and serves the assets; this package holds the dashboard's browser app and its read handlers.
 */
import type { AdminDashboard } from '@boldare/askdare';
import { DASHBOARD_CSS, DASHBOARD_JS } from './generated/assets';
import { type AdminModelPrice, type AdminPrices, createHandlers } from './handlers';

export type { AdminModelPrice, AdminPrices } from './handlers';

/** Options of `adminDashboard()`. */
export interface AdminDashboardOptions {
  /**
   * The app's prices per million tokens, by model ID. A model without one shows its tokens and
   * "no price". askdare holds no price table: OpenAI changes prices, and they are yours to set.
   */
  readonly prices?: AdminPrices | undefined;
}

function checkPrices(prices: AdminPrices): AdminPrices {
  // No prototype, so a model named `__proto__` is a price like any other.
  const checked: Record<string, AdminModelPrice> = Object.create(null);
  for (const [model, price] of Object.entries(prices)) {
    const values = [
      price.input,
      price.output,
      ...(price.cachedInput === undefined ? [] : [price.cachedInput]),
    ];
    if (
      !values.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    ) {
      throw new TypeError(`adminDashboard: the price of "${model}" must be numbers of 0 or more.`);
    }
    checked[model] = { ...price };
  }
  return Object.freeze(checked);
}

/**
 * The dashboard: pass it as `createChatHandler({ admin: { console: { dashboard } } })`. After
 * signing into the console, its owner sees cost per bot, day and model, ratings, new
 * conversations, unanswered questions (a heuristic), leads and handoffs with the resolution rate,
 * the most expensive conversations, the 👎 answers and their comments, and stored transcripts.
 */
export function adminDashboard(options: AdminDashboardOptions = {}): AdminDashboard {
  return {
    script: DASHBOARD_JS,
    style: DASHBOARD_CSS,
    handlers: createHandlers(checkPrices(options.prices ?? {})),
  };
}
