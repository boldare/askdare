import { AskdareError } from '../errors';
import type { ChatTokenUsage } from '../server/usage-report';
import { checkLimit, checkRange, dayOf, parseDay } from './bounds';
import type {
  AdminBotDayRow,
  AdminConversationSummary,
  AdminDayRow,
  AdminHandoffState,
  AdminPage,
  AdminRecordKey,
  AdminSource,
  AdminStore,
  AdminStoredRating,
  AdminTranscriptRecord,
  AdminTurnRecord,
} from './port';

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };

interface TurnRow extends Mutable<AdminDayRow> {
  readonly source: AdminSource;
}
interface BotRow extends Mutable<AdminBotDayRow> {
  readonly source: AdminSource;
}

const zeroUsage = (): Mutable<ChatTokenUsage> => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
});
const addUsage = (into: Mutable<ChatTokenUsage>, usage: ChatTokenUsage): void => {
  into.inputTokens += usage.inputTokens;
  into.cachedInputTokens += usage.cachedInputTokens;
  into.cacheWriteTokens += usage.cacheWriteTokens;
  into.outputTokens += usage.outputTokens;
  into.reasoningTokens += usage.reasoningTokens;
};
const tokens = (usage: ChatTokenUsage): number => usage.inputTokens + usage.outputTokens;
const key = (...parts: readonly (string | number)[]): string => parts.join('\u0000');
// Copies in and out, so nobody changes a stored record behind the store's back.
const copy = <T>(value: T): T => structuredClone(value);
const by = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const CURSOR = /^m:(\d+)$/;
/** A page of `items` from the offset in `cursor`. */
function page<T>(items: readonly T[], limit: number, cursor: string | undefined): AdminPage<T> {
  let offset = 0;
  if (cursor !== undefined) {
    const match = CURSOR.exec(cursor);
    if (!match) throw new AskdareError('invalid_input', { message: 'Unknown cursor.' });
    offset = Number(match[1]);
  }
  const end = offset + checkLimit(limit);
  const slice = copy(items.slice(offset, end));
  return end < items.length ? { items: slice, cursor: `m:${end}` } : { items: slice };
}

/**
 * Admin records in this process's memory, for tests and local development. Every instance has its
 * own, and a restart forgets them, so production warns.
 */
export function memoryAdminStore(): AdminStore {
  if (process.env['NODE_ENV'] === 'production') {
    console.warn(
      '[askdare] Admin records are kept in memory, per instance, and lost on restart. Use a shared store such as @boldare/askdare-postgres.',
    );
  }
  const turns = new Map<string, AdminTurnRecord>();
  const ratings = new Map<string, AdminStoredRating>();
  const transcripts = new Map<string, AdminTranscriptRecord>();
  const turnRows = new Map<string, TurnRow>();
  const botRows = new Map<string, BotRow>();

  const turnRow = (record: AdminTurnRecord): TurnRow => {
    const day = dayOf(record.at);
    const id = key(day, record.bot, record.model, record.source);
    let row = turnRows.get(id);
    if (!row) {
      row = {
        day,
        bot: record.bot,
        model: record.model,
        source: record.source,
        turns: 0,
        failed: 0,
        unanswered: 0,
        usage: zeroUsage(),
      };
      turnRows.set(id, row);
    }
    return row;
  };
  const botRow = (bot: string, at: number, source: AdminSource): BotRow => {
    const day = dayOf(at);
    const id = key(day, bot, source);
    let row = botRows.get(id);
    if (!row) {
      row = {
        day,
        bot,
        source,
        conversations: 0,
        up: 0,
        down: 0,
        leads: 0,
        handoffs: { sent: 0, saved: 0, unavailable: 0, failed: 0, limited: 0 },
      };
      botRows.set(id, row);
    }
    return row;
  };
  const rate = (rating: AdminStoredRating, delta: 1 | -1): void => {
    botRow(rating.bot, rating.at, rating.source)[rating.rating] += delta;
  };
  /** Every record of every conversation, for the lists. Memory may scan; other stores may not. */
  const records = (): (AdminTurnRecord | AdminStoredRating | AdminTranscriptRecord)[] => [
    ...turns.values(),
    ...ratings.values(),
    ...transcripts.values(),
  ];

  const store: AdminStore = {
    name: 'memory',

    async recordTurn(record, options) {
      options?.signal?.throwIfAborted();
      const id = key(record.conversationId, record.at);
      if (turns.has(id)) return;
      turns.set(id, copy(record));
      const row = turnRow(record);
      row.turns += 1;
      if (record.outcome === 'failed') row.failed += 1;
      if (record.unanswered) row.unanswered += 1;
      addUsage(row.usage, record.usage);
      if (record.newConversation) botRow(record.bot, record.at, record.source).conversations += 1;
    },

    async recordRating(record, options) {
      options?.signal?.throwIfAborted();
      const id = key(record.conversationId, record.itemId);
      const stored = ratings.get(id);
      if (stored) {
        rate(stored, -1);
        ratings.delete(id);
      }
      if (record.rating === null) return;
      const rating = copy(record) as AdminStoredRating;
      ratings.set(id, rating);
      rate(rating, 1);
    },

    async recordTranscript(record, options) {
      options?.signal?.throwIfAborted();
      transcripts.set(key(record.conversationId, record.at, record.itemId ?? ''), copy(record));
    },

    async count(event, signal) {
      signal?.throwIfAborted();
      const row = botRow(event.bot, event.at, event.source);
      if (event.kind === 'lead') row.leads += 1;
      else row.handoffs[event.state satisfies AdminHandoffState] += 1;
    },

    async days(range, signal) {
      signal?.throwIfAborted();
      const { from, to, source } = checkRange(range);
      const wanted = (row: { day: string; bot: string; source: AdminSource }): boolean =>
        row.day >= from &&
        row.day <= to &&
        source(row.source) &&
        (range.bot === undefined || row.bot === range.bot);

      const turnTotals = new Map<string, Mutable<AdminDayRow>>();
      for (const row of turnRows.values()) {
        if (!wanted(row)) continue;
        const id = key(row.day, row.bot, row.model);
        let total = turnTotals.get(id);
        if (!total) {
          total = {
            day: row.day,
            bot: row.bot,
            model: row.model,
            turns: 0,
            failed: 0,
            unanswered: 0,
            usage: zeroUsage(),
          };
          turnTotals.set(id, total);
        }
        total.turns += row.turns;
        total.failed += row.failed;
        total.unanswered += row.unanswered;
        addUsage(total.usage, row.usage);
      }
      const botTotals = new Map<string, Mutable<AdminBotDayRow>>();
      for (const row of botRows.values()) {
        if (!wanted(row)) continue;
        const id = key(row.day, row.bot);
        let total = botTotals.get(id);
        if (!total) {
          total = {
            day: row.day,
            bot: row.bot,
            conversations: 0,
            up: 0,
            down: 0,
            leads: 0,
            handoffs: { sent: 0, saved: 0, unavailable: 0, failed: 0, limited: 0 },
          };
          botTotals.set(id, total);
        }
        total.conversations += row.conversations;
        total.up += row.up;
        total.down += row.down;
        total.leads += row.leads;
        for (const state of Object.keys(total.handoffs) as AdminHandoffState[]) {
          total.handoffs[state] += row.handoffs[state];
        }
      }
      return {
        turns: [...turnTotals.values()].sort(
          (a, b) => by(a.day, b.day) || by(a.bot, b.bot) || by(a.model, b.model),
        ),
        bots: [...botTotals.values()].sort((a, b) => by(a.day, b.day) || by(a.bot, b.bot)),
      };
    },

    async conversations(query, signal) {
      signal?.throwIfAborted();
      const { from, to, source } = checkRange(query);
      checkLimit(query.limit);
      const summaries = new Map<
        string,
        Mutable<AdminConversationSummary> & { source: AdminSource }
      >();
      const sorted = records().sort((a, b) => a.at - b.at);
      for (const record of sorted) {
        let summary = summaries.get(record.conversationId);
        if (!summary) {
          summary = {
            conversationId: record.conversationId,
            bot: record.bot,
            visitor: record.visitor,
            source: record.source,
            firstAt: record.at,
            lastAt: record.at,
            turns: 0,
            usage: zeroUsage(),
            up: 0,
            down: 0,
            transcript: false,
          };
          summaries.set(record.conversationId, summary);
        }
        summary.lastAt = record.at;
        if ('usage' in record) {
          summary.turns += 1;
          addUsage(summary.usage, record.usage);
        } else if ('input' in record) {
          summary.transcript = true;
        } else {
          summary[record.rating] += 1;
        }
      }
      const items = [...summaries.values()]
        .filter((summary) => {
          const day = dayOf(summary.firstAt);
          return (
            day >= from &&
            day <= to &&
            source(summary.source) &&
            (query.bot === undefined || summary.bot === query.bot) &&
            (query.rated !== 'down' || summary.down > 0)
          );
        })
        .sort(
          (a, b) =>
            (query.order === 'tokens' ? tokens(b.usage) - tokens(a.usage) : 0) ||
            b.lastAt - a.lastAt ||
            by(a.conversationId, b.conversationId),
        )
        .map(({ source: _source, ...summary }) => summary);
      return page(items, query.limit, query.cursor);
    },

    async ratings(query, signal) {
      signal?.throwIfAborted();
      const { from, to, source } = checkRange(query);
      checkLimit(query.limit);
      const items = [...ratings.values()]
        .filter((rating) => {
          const day = dayOf(rating.at);
          return (
            day >= from &&
            day <= to &&
            source(rating.source) &&
            (query.bot === undefined || rating.bot === query.bot) &&
            (query.rating === undefined || rating.rating === query.rating)
          );
        })
        .sort(
          (a, b) => b.at - a.at || by(a.conversationId, b.conversationId) || by(a.itemId, b.itemId),
        );
      return page(items, query.limit, query.cursor);
    },

    async transcript(conversationId, signal) {
      signal?.throwIfAborted();
      return copy(
        [...transcripts.values()]
          .filter((record) => record.conversationId === conversationId)
          .sort((a, b) => a.at - b.at),
      );
    },

    async deleteConversation(conversationId, signal) {
      signal?.throwIfAborted();
      const maps = [turns, ratings, transcripts] as Map<string, AdminRecordKey>[];
      for (const map of maps) {
        for (const [id, record] of map) {
          if (record.conversationId === conversationId) map.delete(id);
        }
      }
    },

    async sweep({ recordsBefore, daysBefore, limit }, signal) {
      signal?.throwIfAborted();
      parseDay(daysBefore);
      if (!Number.isInteger(limit) || limit < 1) {
        throw new AskdareError('invalid_input', { message: 'A limit must be a positive integer.' });
      }
      let deleted = 0;
      const maps = [turns, ratings, transcripts] as Map<string, { readonly at: number }>[];
      for (const map of maps) {
        for (const [id, record] of map) {
          if (deleted >= limit) return deleted;
          signal?.throwIfAborted();
          if (record.at >= recordsBefore) continue;
          map.delete(id);
          deleted += 1;
        }
      }
      for (const map of [turnRows, botRows] as Map<string, { readonly day: string }>[]) {
        for (const [id, row] of map) {
          if (deleted >= limit) return deleted;
          signal?.throwIfAborted();
          if (row.day >= daysBefore) continue;
          map.delete(id);
          deleted += 1;
        }
      }
      return deleted;
    },
  };
  return store;
}
