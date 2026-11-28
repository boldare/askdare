/**
 * The dashboard's read handlers (ADR-0032, decisions 5 and 9). Core has checked access and parsed
 * the body; each handler validates its input, asks the store one of its fixed queries and answers
 * with the JSON of `wire.ts`. Store IDs never leave the server: conversations and cursors are sealed
 * with the request's `seal` (decision 8).
 */
import type {
  AdminDashboardHandler,
  AdminDashboardRequest,
  AdminDays,
  AdminHandoffCounts,
  AdminRange,
} from '@boldare/askdare';
import type {
  WireBotDay,
  WireConversation,
  WireDays,
  WireModelDay,
  WirePage,
  WireRating,
  WireTokens,
  WireTranscript,
} from './wire';

/**
 * What one model costs, per million tokens, in the app's own currency. `cachedInput` is the price
 * of input tokens read from the prompt cache; without it they cost as much as other input.
 */
export interface AdminModelPrice {
  readonly input: number;
  readonly cachedInput?: number | undefined;
  readonly output: number;
}

/** Prices by model ID, as the model is reported (the configured model if none answered). */
export type AdminPrices = Readonly<Record<string, AdminModelPrice>>;

type Usage = AdminDays['turns'][number]['usage'];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 200;
const MAX_REF = 4096;
/** Prefix of sealed cursors, so a cursor can't pass for a conversation reference. */
const CURSOR = 'askdare-admin-cursor\u0000';
const DEFAULT_LIMIT = 20;

/** An error core answers by its `code` (ADR-0032 contract with the console). */
class DashboardError extends Error {
  override readonly name: 'DashboardError' = 'DashboardError';
  readonly code: 'invalid_input' | 'not_found';
  constructor(code: 'invalid_input' | 'not_found', message: string) {
    super(message);
    this.code = code;
  }
}

const invalid = (message: string): DashboardError => new DashboardError('invalid_input', message);

type Input = Readonly<Record<string, unknown>>;

function object(input: unknown): Input {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw invalid('The request must be a JSON object.');
  }
  return input as Input;
}

function text(input: Input, name: string, max = MAX_TEXT): string | undefined {
  const value = input[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw invalid(`${name} must be a string of 1 to ${max} characters.`);
  }
  return value;
}

function oneOf<const T extends string>(
  input: Input,
  name: string,
  values: readonly T[],
): T | undefined {
  const value = input[name];
  if (value === undefined) return undefined;
  if (!values.includes(value as T)) throw invalid(`${name} must be one of ${values.join(', ')}.`);
  return value as T;
}

/** The day range: `from` and `to` as `YYYY-MM-DD`; the store checks the span. Playground turns are left out. */
function range(input: Input): AdminRange {
  const from = text(input, 'from');
  const to = text(input, 'to');
  if (from === undefined || to === undefined || !DAY.test(from) || !DAY.test(to)) {
    throw invalid('from and to must be YYYY-MM-DD.');
  }
  const bot = text(input, 'bot');
  return bot === undefined ? { from, to, source: 'chat' } : { from, to, bot, source: 'chat' };
}

function limit(input: Input): number {
  const value = input['limit'] ?? DEFAULT_LIMIT;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100) {
    throw invalid('limit must be an integer from 1 to 100.');
  }
  return value;
}

async function openCursor(
  input: Input,
  request: AdminDashboardRequest,
): Promise<string | undefined> {
  const sealed = text(input, 'cursor', MAX_REF);
  if (sealed === undefined) return undefined;
  const cursor = await request.open(sealed);
  if (cursor === undefined || !cursor.startsWith(CURSOR)) throw invalid('Unknown cursor.');
  return cursor.slice(CURSOR.length);
}

const sealCursor = async (
  cursor: string | undefined,
  request: AdminDashboardRequest,
): Promise<{ cursor?: string }> =>
  cursor === undefined ? {} : { cursor: await request.seal(CURSOR + cursor) };

const tokens = (usage: Usage): WireTokens => ({
  input: usage.inputTokens,
  cachedInput: usage.cachedInputTokens,
  output: usage.outputTokens,
});

const addTokens = (a: WireTokens, b: WireTokens): WireTokens => ({
  input: a.input + b.input,
  cachedInput: a.cachedInput + b.cachedInput,
  output: a.output + b.output,
});

const NO_TOKENS: WireTokens = { input: 0, cachedInput: 0, output: 0 };

/** The cost of the tokens at `price`, or `null` without a price. */
export function cost(usage: WireTokens, price: AdminModelPrice | undefined): number | null {
  if (price === undefined) return null;
  const cached = Math.min(usage.cachedInput, usage.input);
  return (
    ((usage.input - cached) * price.input +
      cached * (price.cachedInput ?? price.input) +
      usage.output * price.output) /
    1_000_000
  );
}

const handedOff = (counts: AdminHandoffCounts): number =>
  counts.sent + counts.saved + counts.unavailable + counts.failed;

/**
 * The resolution rate of decision 5: one minus handoffs (any final state but `limited`) over new
 * conversations, kept within 0 and 1. A daily ratio, since handoffs aren't tied to conversations.
 */
export function resolution(conversations: number, handoffs: number): number | null {
  if (conversations === 0) return null;
  return Math.min(1, Math.max(0, 1 - handoffs / conversations));
}

function priceOf(prices: AdminPrices, model: string): AdminModelPrice | undefined {
  return Object.hasOwn(prices, model) ? prices[model] : undefined;
}

function daysAnswer(days: AdminDays, from: string, to: string, prices: AdminPrices): WireDays {
  const models: WireModelDay[] = days.turns.map((row) => {
    const rowTokens = tokens(row.usage);
    return {
      day: row.day,
      bot: row.bot,
      model: row.model,
      turns: row.turns,
      failed: row.failed,
      unanswered: row.unanswered,
      tokens: rowTokens,
      cost: cost(rowTokens, priceOf(prices, row.model)),
    };
  });
  const botDays: WireBotDay[] = days.bots.map((row) => {
    const handoffs = handedOff(row.handoffs);
    return {
      day: row.day,
      bot: row.bot,
      conversations: row.conversations,
      up: row.up,
      down: row.down,
      leads: row.leads,
      handoffs,
      limited: row.handoffs.limited,
      resolution: resolution(row.conversations, handoffs),
    };
  });
  const bots = [
    ...new Set([...models.map((row) => row.bot), ...botDays.map((row) => row.bot)]),
  ].sort();
  const unpriced = [
    ...new Set(models.filter((row) => row.cost === null).map((row) => row.model)),
  ].sort();
  const sum = <T>(rows: readonly T[], of: (row: T) => number): number =>
    rows.reduce((total, row) => total + of(row), 0);
  const conversations = sum(botDays, (row) => row.conversations);
  const handoffs = sum(botDays, (row) => row.handoffs);
  return {
    from,
    to,
    bots,
    models,
    days: botDays,
    totals: {
      turns: sum(models, (row) => row.turns),
      failed: sum(models, (row) => row.failed),
      unanswered: sum(models, (row) => row.unanswered),
      conversations,
      up: sum(botDays, (row) => row.up),
      down: sum(botDays, (row) => row.down),
      leads: sum(botDays, (row) => row.leads),
      handoffs,
      resolution: resolution(conversations, handoffs),
      tokens: models.reduce((total, row) => addTokens(total, row.tokens), NO_TOKENS),
      cost: sum(models, (row) => row.cost ?? 0),
      unpriced,
    },
  };
}

/**
 * The read handlers by action name. `prices` stays on the server; the browser gets costs, never
 * the price table.
 */
export function createHandlers(
  prices: AdminPrices,
): Readonly<Record<string, AdminDashboardHandler>> {
  return {
    /** Daily rows of the range, priced, with resolution rates. */
    days: async (request) => {
      const query = range(object(request.input));
      const days = await request.store.days(query, request.signal);
      return daysAnswer(days, query.from, query.to, prices);
    },

    /**
     * The conversations started in the range, most expensive (`tokens`) or latest first. The store
     * doesn't say which model a conversation used, so its cost is given only when its bot answered
     * with a single priced model in the range.
     */
    conversations: async (request): Promise<WirePage<WireConversation>> => {
      const input = object(request.input);
      const query = range(input);
      const order = oneOf(input, 'order', ['tokens', 'latest'] as const) ?? 'tokens';
      const rated = oneOf(input, 'rated', ['down'] as const);
      const cursor = await openCursor(input, request);
      const [page, days] = await Promise.all([
        request.store.conversations(
          {
            ...query,
            order,
            limit: limit(input),
            ...(rated === undefined ? {} : { rated }),
            ...(cursor === undefined ? {} : { cursor }),
          },
          request.signal,
        ),
        request.store.days(query, request.signal),
      ]);
      const modelsOf = new Map<string, Set<string>>();
      for (const row of days.turns) {
        const set = modelsOf.get(row.bot) ?? new Set<string>();
        set.add(row.model);
        modelsOf.set(row.bot, set);
      }
      const priceFor = (bot: string): AdminModelPrice | undefined => {
        const models = modelsOf.get(bot);
        if (models?.size !== 1) return undefined;
        const [model] = models;
        return model === undefined ? undefined : priceOf(prices, model);
      };
      const items = await Promise.all(
        page.items.map(async (item): Promise<WireConversation> => {
          const itemTokens = tokens(item.usage);
          return {
            ref: await request.seal(item.conversationId),
            bot: item.bot,
            firstAt: item.firstAt,
            lastAt: item.lastAt,
            turns: item.turns,
            tokens: itemTokens,
            cost: cost(itemTokens, priceFor(item.bot)),
            up: item.up,
            down: item.down,
            transcript: item.transcript,
          };
        }),
      );
      return { items, ...(await sealCursor(page.cursor, request)) };
    },

    /** The ratings given in the range, newest first, with the visitor's comments. */
    ratings: async (request): Promise<WirePage<WireRating>> => {
      const input = object(request.input);
      const query = range(input);
      const rating = oneOf(input, 'rating', ['up', 'down'] as const);
      const cursor = await openCursor(input, request);
      const page = await request.store.ratings(
        {
          ...query,
          limit: limit(input),
          ...(rating === undefined ? {} : { rating }),
          ...(cursor === undefined ? {} : { cursor }),
        },
        request.signal,
      );
      const items = await Promise.all(
        page.items.map(
          async (item): Promise<WireRating> => ({
            ref: await request.seal(item.conversationId),
            bot: item.bot,
            at: item.at,
            rating: item.rating,
            ...(item.comment === undefined ? {} : { comment: item.comment }),
          }),
        ),
      );
      return { items, ...(await sealCursor(page.cursor, request)) };
    },

    /** A conversation's stored transcript, by its sealed reference; empty without one. */
    transcript: async (request): Promise<WireTranscript> => {
      const ref = text(object(request.input), 'ref', MAX_REF);
      if (ref === undefined) throw invalid('ref is required.');
      const conversationId = await request.open(ref);
      if (conversationId === undefined || conversationId.startsWith(CURSOR)) {
        throw new DashboardError('not_found', 'Unknown conversation.');
      }
      const records = await request.store.transcript(conversationId, request.signal);
      return {
        turns: records.map((record) => ({
          at: record.at,
          input: record.input,
          attachments: record.attachments,
          answer: record.answer ?? null,
          citations: record.citations.map((citation) => ({
            index: citation.index,
            title: citation.title,
            ...(citation.url === undefined ? {} : { url: citation.url }),
          })),
          ...(record.check === undefined ? {} : { check: record.check }),
          reason: record.reason,
        })),
      };
    },
  };
}
