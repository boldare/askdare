import { createHash, randomUUID } from 'node:crypto';
import type {
  AdminBotDayRow,
  AdminConversationSummary,
  AdminDayRow,
  AdminDays,
  AdminHandoffState,
  AdminPage,
  AdminRange,
  AdminRecordKey,
  AdminSource,
  AdminStore,
  AdminStoredRating,
  AdminTranscriptRecord,
  AdminTurnRecord,
  ConversationStoreCheck,
} from '@boldare/askdare';
import { lazyClient } from '../client';
import type { RedisEval } from '../index';
import {
  COUNT_SCRIPT,
  DAYS_SCRIPT,
  DELETE_SCRIPT,
  LIST_SCRIPT,
  OLDEST_SCRIPT,
  RATING_SCRIPT,
  SWEEP_SCRIPT,
  TRANSCRIPT_READ_SCRIPT,
  TRANSCRIPT_SCRIPT,
  TURN_SCRIPT,
} from './scripts';

export interface UpstashAdminStoreOptions {
  /** An existing client. Otherwise one is created from `url` and `token`. */
  readonly redis?: RedisEval;
  /** Default `process.env.UPSTASH_REDIS_REST_URL` (Upstash console), else `KV_REST_API_URL` (Vercel Marketplace). */
  readonly url?: string;
  /** Default `process.env.UPSTASH_REDIS_REST_TOKEN`, else `KV_REST_API_TOKEN`. */
  readonly token?: string;
  /** Key prefix, to share one database between apps. Default `askdare:`; keys go under `<prefix>admin:`. */
  readonly prefix?: string;
  /**
   * A conversation's records expire this many days after its latest record, as a backstop for when
   * `sweep()` doesn't run. Use the same value as `admin.retentionDays`. Default 30.
   */
  readonly retentionDays?: number;
}

const DAY_MS = 86_400_000;
/** Daily rows hold no personal data and are kept this long (ADR-0032). */
const DAY_ROW_DAYS = 400;
const MAX_RANGE_DAYS = 400;
const MAX_PAGE = 100;
const SOURCES: readonly AdminSource[] = ['chat', 'console'];
const HANDOFF_STATES: readonly AdminHandoffState[] = [
  'sent',
  'saved',
  'unavailable',
  'failed',
  'limited',
];
/** Separates the parts of stored values and daily-row fields; JSON never contains it raw. */
const SEP = '\u001f';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CURSOR = /^u1\.([A-Za-z0-9_-]+)$/;

type ChatTokenUsage = AdminTurnRecord['usage'];
type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };

const invalid = (message: string): RangeError => new RangeError(`[askdare-upstash] ${message}`);

/** The day number (days since 1970-01-01, UTC) of a `YYYY-MM-DD` day; throws for a malformed one. */
function parseDay(day: string): number {
  const at = DAY.test(day) ? Date.parse(`${day}T00:00:00Z`) : Number.NaN;
  if (Number.isNaN(at) || new Date(at).toISOString().slice(0, 10) !== day) {
    throw invalid('A day must be YYYY-MM-DD.');
  }
  return at / DAY_MS;
}
const dayString = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10);
const dayNumber = (at: number): number => Math.floor(at / DAY_MS);

/** The range's day numbers and sources, or throws for one outside the bounds. */
function checkRange(range: AdminRange): { days: number[]; sources: readonly AdminSource[] } {
  const from = parseDay(range.from);
  const to = parseDay(range.to);
  if (to < from) throw invalid('A range must end on or after its start.');
  if (to - from + 1 > MAX_RANGE_DAYS)
    throw invalid(`A range covers at most ${MAX_RANGE_DAYS} days.`);
  const days: number[] = [];
  for (let n = from; n <= to; n += 1) days.push(n);
  const source = range.source ?? 'chat';
  return { days, sources: source === 'all' ? SOURCES : [source] };
}

function checkLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
    throw invalid(`A limit must be 1 to ${MAX_PAGE}.`);
  }
  return limit;
}

function checkAt(at: number): string {
  if (!Number.isSafeInteger(at) || at < 0)
    throw invalid('A record time must be epoch milliseconds.');
  return String(at);
}

/** Key names hold this hash, never the conversation ID. */
const hashOf = (conversationId: string): string =>
  createHash('sha1').update(conversationId).digest('hex');
const botKey = (bot: string): string => encodeURIComponent(bot);
const turnRow = (source: AdminSource, bot: string, model: string): string =>
  JSON.stringify(['t', source, bot, model]);
const botRow = (source: AdminSource, bot: string): string => JSON.stringify(['b', source, bot]);
/** When a day's rows expire. */
const dayExpiry = (day: number): string => String((day + 1 + DAY_ROW_DAYS) * DAY_MS);

/** A string from a script's reply: scripts prefix strings with `~` (see scripts.ts). */
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('~')) {
    throw new Error('[askdare-upstash] Unexpected reply from Redis.');
  }
  return value.slice(1);
}
const num = (value: unknown): number => Number(value ?? 0);

const encodeCursor = (score: string, member: string): string =>
  `u1.${Buffer.from(JSON.stringify([score, member])).toString('base64url')}`;
function decodeCursor(cursor: string | undefined): [string, string] {
  if (cursor === undefined) return ['', ''];
  const match = CURSOR.exec(cursor);
  try {
    const value: unknown = match
      ? JSON.parse(Buffer.from(match[1] ?? '', 'base64url').toString())
      : 0;
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      /^-?\d+$/.test(value[0]) &&
      typeof value[1] === 'string' &&
      value[1] !== ''
    ) {
      return [value[0], value[1]];
    }
  } catch {
    // Refused below.
  }
  throw invalid('Unknown cursor.');
}

const zeroUsage = (): Mutable<ChatTokenUsage> => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
});
const usageOf = (values: Record<string, number>): ChatTokenUsage => ({
  inputTokens: values['i'] ?? 0,
  cachedInputTokens: values['ci'] ?? 0,
  cacheWriteTokens: values['cw'] ?? 0,
  outputTokens: values['o'] ?? 0,
  reasoningTokens: values['r'] ?? 0,
});
const by = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Admin records in Upstash Redis (ADR-0032), for sites with no SQL database. Every query is answered
 * from aggregates, sorted sets and summaries kept at write time, each write and read is one atomic
 * script, and no key name holds a conversation ID, a visitor or content.
 *
 * ```ts
 * createChatHandler({ bots, admin: { store: upstashAdminStore(), retentionDays: 30 } });
 * ```
 *
 * Retention: `sweep()` (core's, on a schedule) deletes records older than `admin.retentionDays` and
 * daily rows older than 400 days. As a backstop, a conversation's keys also expire `retentionDays`
 * after its latest record, and daily rows 400 days after their day.
 */
export function upstashAdminStore(options: UpstashAdminStoreOptions = {}): AdminStore {
  const prefix = `${options.prefix ?? 'askdare:'}admin:`;
  const retentionDays = options.retentionDays ?? 30;
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    throw new RangeError('[askdare-upstash] upstashAdminStore: retentionDays must be positive.');
  }
  const ttlMs = Math.ceil(retentionDays * DAY_MS);
  const client = lazyClient(options);

  const run = async <T>(
    script: string,
    args: readonly (string | number)[],
    signal: AbortSignal | undefined,
  ): Promise<T> => {
    signal?.throwIfAborted();
    return client().eval<(string | number)[], T>(script, [], [prefix, Date.now(), ttlMs, ...args]);
  };
  const owner = (record: AdminRecordKey): string[] => [
    hashOf(record.conversationId),
    record.conversationId,
    record.bot,
    botKey(record.bot),
    record.visitor,
    record.source,
  ];

  /** A page from the union of index keys; `[items, cursor]`. */
  const list = async (
    mode: 'c' | 'r',
    keys: readonly string[],
    downs: readonly string[],
    limit: number,
    cursor: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<{ items: unknown[]; cursor?: string }> => {
    const [score, member] = decodeCursor(cursor);
    const reply = await run<unknown[]>(
      LIST_SCRIPT,
      [
        mode,
        `${prefix}tmp:${randomUUID()}`,
        keys.length,
        downs.length,
        limit,
        score,
        member,
        ...keys,
        ...downs,
      ],
      signal,
    );
    const [more, lastScore, lastMember, ...items] = reply;
    return num(more) === 1
      ? { items, cursor: encodeCursor(text(lastScore), text(lastMember)) }
      : { items };
  };

  return {
    name: 'upstash',

    async recordTurn(record, signal) {
      const at = checkAt(record.at);
      const day = dayNumber(record.at);
      const row = turnRow(record.source, record.bot, record.model);
      const u = record.usage;
      const counters: [string, number][] = [
        ['turns', 1],
        ['failed', record.outcome === 'failed' ? 1 : 0],
        ['unanswered', record.unanswered ? 1 : 0],
        ['i', u.inputTokens],
        ['ci', u.cachedInputTokens],
        ['cw', u.cacheWriteTokens],
        ['o', u.outputTokens],
        ['r', u.reasoningTokens],
      ];
      const increments: (string | number)[] = [];
      for (const [metric, value] of counters) {
        if (value !== 0) increments.push(`${row}${SEP}${metric}`, Math.round(value));
      }
      if (record.newConversation) {
        increments.push(`${botRow(record.source, record.bot)}${SEP}conversations`, 1);
      }
      await run(
        TURN_SCRIPT,
        [
          ...owner(record),
          at,
          [
            u.inputTokens,
            u.cachedInputTokens,
            u.cacheWriteTokens,
            u.outputTokens,
            u.reasoningTokens,
          ]
            .map((value) => Math.round(value))
            .join(' '),
          day,
          dayExpiry(day),
          ...increments,
        ],
        signal,
      );
    },

    async recordRating(record, signal) {
      const at = checkAt(record.at);
      const day = dayNumber(record.at);
      const row = botRow(record.source, record.bot);
      const value =
        record.rating === null
          ? ''
          : [
              at,
              record.rating,
              botKey(record.bot),
              record.source,
              row,
              JSON.stringify(record),
            ].join(SEP);
      await run(
        RATING_SCRIPT,
        [...owner(record), record.itemId, at, record.rating ?? '', value, day, dayExpiry(day), row],
        signal,
      );
    },

    async recordTranscript(record, signal) {
      const at = checkAt(record.at);
      await run(
        TRANSCRIPT_SCRIPT,
        [...owner(record), `${at}${SEP}${record.itemId ?? ''}`, JSON.stringify(record)],
        signal,
      );
    },

    async count(event, signal) {
      checkAt(event.at);
      const day = dayNumber(event.at);
      const metric = event.kind === 'lead' ? 'leads' : `h.${event.state}`;
      await run(
        COUNT_SCRIPT,
        [day, dayExpiry(day), `${botRow(event.source, event.bot)}${SEP}${metric}`, 1],
        signal,
      );
    },

    async days(range, signal) {
      const { days, sources } = checkRange(range);
      const reply = await run<unknown[][]>(DAYS_SCRIPT, days, signal);
      const turns = new Map<string, Mutable<AdminDayRow>>();
      const bots = new Map<string, Mutable<AdminBotDayRow>>();
      for (const [n, ...fields] of reply) {
        const day = dayString(num(n));
        for (let i = 0; i < fields.length; i += 2) {
          const field = text(fields[i]);
          const value = num(fields[i + 1]);
          const cut = field.lastIndexOf(SEP);
          const metric = field.slice(cut + 1);
          const [kind, source, bot, model] = JSON.parse(field.slice(0, cut)) as [
            't' | 'b',
            AdminSource,
            string,
            string?,
          ];
          if (!sources.includes(source) || (range.bot !== undefined && bot !== range.bot)) continue;
          if (kind === 't') {
            const id = JSON.stringify([day, bot, model]);
            let row = turns.get(id);
            if (!row) {
              row = {
                day,
                bot,
                model: model ?? '',
                turns: 0,
                failed: 0,
                unanswered: 0,
                usage: zeroUsage(),
              };
              turns.set(id, row);
            }
            if (metric === 'turns' || metric === 'failed' || metric === 'unanswered') {
              row[metric] += value;
            } else {
              const usage = usageOf({ [metric]: value });
              row.usage.inputTokens += usage.inputTokens;
              row.usage.cachedInputTokens += usage.cachedInputTokens;
              row.usage.cacheWriteTokens += usage.cacheWriteTokens;
              row.usage.outputTokens += usage.outputTokens;
              row.usage.reasoningTokens += usage.reasoningTokens;
            }
          } else {
            const id = JSON.stringify([day, bot]);
            let row = bots.get(id);
            if (!row) {
              row = {
                day,
                bot,
                conversations: 0,
                up: 0,
                down: 0,
                leads: 0,
                handoffs: { sent: 0, saved: 0, unavailable: 0, failed: 0, limited: 0 },
              };
              bots.set(id, row);
            }
            if (metric.startsWith('h.')) {
              const state = metric.slice(2) as AdminHandoffState;
              if (HANDOFF_STATES.includes(state)) row.handoffs[state] += value;
            } else if (
              metric === 'conversations' ||
              metric === 'up' ||
              metric === 'down' ||
              metric === 'leads'
            ) {
              row[metric] += value;
            }
          }
        }
      }
      const result: AdminDays = {
        turns: [...turns.values()].sort(
          (a, b) => by(a.day, b.day) || by(a.bot, b.bot) || by(a.model, b.model),
        ),
        bots: [...bots.values()].sort((a, b) => by(a.day, b.day) || by(a.bot, b.bot)),
      };
      return result;
    },

    async conversations(query, signal) {
      const { days, sources } = checkRange(query);
      const limit = checkLimit(query.limit);
      const index = (order: 't' | 'l' | 'd'): string[] =>
        sources.flatMap((source) =>
          days.map(
            (n) =>
              `${prefix}i:${source}:${n}:${order}${query.bot === undefined ? '' : `:${botKey(query.bot)}`}`,
          ),
        );
      const page = await list(
        'c',
        index(query.order === 'tokens' ? 't' : 'l'),
        query.rated === 'down' ? index('d') : [],
        limit,
        query.cursor,
        signal,
      );
      const items = page.items.map((item): AdminConversationSummary => {
        const [id, bot, visitor, ...n] = item as unknown[];
        const v = n.map(num);
        return {
          conversationId: text(id),
          bot: text(bot),
          visitor: text(visitor),
          firstAt: v[0] ?? 0,
          lastAt: v[1] ?? 0,
          turns: v[2] ?? 0,
          usage: usageOf({
            i: v[3] ?? 0,
            ci: v[4] ?? 0,
            cw: v[5] ?? 0,
            o: v[6] ?? 0,
            r: v[7] ?? 0,
          }),
          up: v[8] ?? 0,
          down: v[9] ?? 0,
          transcript: (v[10] ?? 0) > 0,
        };
      });
      const result: AdminPage<AdminConversationSummary> =
        page.cursor === undefined ? { items } : { items, cursor: page.cursor };
      return result;
    },

    async ratings(query, signal) {
      const { days, sources } = checkRange(query);
      const limit = checkLimit(query.limit);
      const which = query.rating ?? 'all';
      const keys = sources.flatMap((source) =>
        days.map(
          (n) =>
            `${prefix}q:${source}:${n}:${which}${query.bot === undefined ? '' : `:${botKey(query.bot)}`}`,
        ),
      );
      const page = await list('r', keys, [], limit, query.cursor, signal);
      // Written by this store from the core's own records.
      const items = page.items.map((item) => JSON.parse(text(item)) as AdminStoredRating);
      const result: AdminPage<AdminStoredRating> =
        page.cursor === undefined ? { items } : { items, cursor: page.cursor };
      return result;
    },

    async transcript(conversationId, signal) {
      const reply = await run<unknown[]>(TRANSCRIPT_READ_SCRIPT, [hashOf(conversationId)], signal);
      const records = reply.map((value) => JSON.parse(text(value)) as AdminTranscriptRecord);
      return records.sort((a, b) => a.at - b.at);
    },

    async deleteConversation(conversationId, signal) {
      await run(DELETE_SCRIPT, [hashOf(conversationId)], signal);
    },

    async sweep({ recordsBefore, daysBefore, limit }, signal) {
      const day = parseDay(daysBefore);
      if (!Number.isFinite(recordsBefore))
        throw invalid('recordsBefore must be epoch milliseconds.');
      if (!Number.isInteger(limit) || limit < 1)
        throw invalid('A limit must be a positive integer.');
      return num(await run(SWEEP_SCRIPT, [Math.ceil(recordsBefore), day, limit], signal));
    },

    async diagnose(signal): Promise<readonly ConversationStoreCheck[]> {
      try {
        const oldest = num(await run(OLDEST_SCRIPT, [], signal));
        if (oldest < 0) return [{ status: 'ok', title: 'Admin store (Upstash): no records yet' }];
        const age = Math.floor((Date.now() - oldest) / DAY_MS);
        return age > retentionDays
          ? [
              {
                status: 'warn',
                title: `Admin store (Upstash): the oldest record is ${age} days old`,
                fix: `Call sweep() from your handlers on a schedule; records are kept ${retentionDays} days.`,
              },
            ]
          : [{ status: 'ok', title: `Admin store (Upstash): oldest record ${age} days old` }];
      } catch (error) {
        return [
          {
            status: 'fail',
            title: `Admin store (Upstash) unreachable (${error instanceof Error ? error.name : 'error'})`,
            fix: 'Check UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.',
          },
        ];
      }
    },
  };
}
