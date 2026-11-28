import type {
  AdminBotDayRow,
  AdminConversationSummary,
  AdminDayRow,
  AdminHandoffState,
  AdminRecordKey,
  AdminStore,
  AdminStoredRating,
  AdminTranscriptRecord,
  ConversationStoreCheck,
} from '@boldare/askdare';
import {
  type PostgresConnectionOptions,
  type PostgresPool,
  type PostgresPoolClient,
  queryRows,
} from '../connection';
import { resolvePool } from '../pool';
import { type SchemaStatus, schemaStatus } from '../schema/status';
import {
  checkAt,
  checkLimit,
  checkRange,
  DAY_MS,
  dayOf,
  decodeCursor,
  encodeCursor,
  parseDay,
} from './bounds';
import {
  ADMIN_PART,
  BOT_DAYS_TABLE,
  RATINGS_TABLE,
  SUMMARIES_TABLE,
  TRANSCRIPTS_TABLE,
  TURN_DAYS_TABLE,
  TURNS_TABLE,
} from './schema';

/**
 * Where the admin store's database is. Retention is `admin.retentionDays` in `createChatHandler`,
 * applied by the handlers' `sweep()`; `askdare doctor` warns when records outlive it.
 */
export type PostgresAdminStoreOptions = PostgresConnectionOptions;

/**
 * How long a write waits for a lock: a conversation's, held by another write, a delete or a
 * sweep for milliseconds at a time. Bounds a write stuck behind a transaction that never ends.
 */
const LOCK_TIMEOUT = '10s';

/**
 * The first key of the per-conversation advisory lock ("admn"). Two-key advisory locks never
 * collide with `migrate`'s single-key one.
 */
const LOCK_CLASS = 1_684_302_190;

/** Takes the conversation locks for the IDs in `$1`, in one order, so lockers never deadlock. */
const LOCK_CONVERSATIONS = `
select pg_advisory_xact_lock(${LOCK_CLASS}, hashtext(id))
from (select distinct id from unnest($1::text[]) as id) ids
order by hashtext(id)`;

/** The usage columns, in the order of `ChatTokenUsage`'s fields. */
const USAGE_COLUMNS = [
  'input_tokens',
  'cached_input_tokens',
  'cache_write_tokens',
  'output_tokens',
  'reasoning_tokens',
] as const;

/**
 * Sums the records of the conversations in `$1` into their summaries, and deletes the summaries
 * of those with no records left. Run under the conversations' locks, after the change.
 */
const SUMMARIZE = `
with records as (
  select conversation_id, at, 0 as kind, bot, visitor, source, 1 as turns,
    ${USAGE_COLUMNS.join(', ')}, 0 as up, 0 as down, 0 as transcripts
  from ${TURNS_TABLE} where conversation_id = any($1::text[])
  union all
  select conversation_id, at, 1, bot, visitor, source, 0, 0, 0, 0, 0, 0,
    (rating = 'up')::int, (rating = 'down')::int, 0
  from ${RATINGS_TABLE} where conversation_id = any($1::text[])
  union all
  select conversation_id, at, 2, bot, visitor, source, 0, 0, 0, 0, 0, 0, 0, 0, 1
  from ${TRANSCRIPTS_TABLE} where conversation_id = any($1::text[])
),
sums as (
  select conversation_id,
    (array_agg(bot order by at, kind))[1] as bot,
    (array_agg(visitor order by at, kind))[1] as visitor,
    (array_agg(source order by at, kind))[1] as source,
    min(at) as first_at, max(at) as last_at, sum(turns) as turns,
    ${USAGE_COLUMNS.map((column) => `sum(${column}) as ${column}`).join(', ')},
    sum(up) as up, sum(down) as down, sum(transcripts) as transcripts
  from records group by conversation_id
),
emptied as (
  delete from ${SUMMARIES_TABLE} s
  where s.conversation_id = any($1::text[])
    and not exists (select 1 from sums where sums.conversation_id = s.conversation_id)
)
insert into ${SUMMARIES_TABLE} (conversation_id, bot, visitor, source, first_at, last_at, turns,
  ${USAGE_COLUMNS.join(', ')}, up, down, transcripts)
select conversation_id, bot, visitor, source, first_at, last_at, turns,
  ${USAGE_COLUMNS.join(', ')}, up, down, transcripts
from sums
on conflict (conversation_id) do update set
  bot = excluded.bot, visitor = excluded.visitor, source = excluded.source,
  first_at = excluded.first_at, last_at = excluded.last_at, turns = excluded.turns,
  ${USAGE_COLUMNS.map((column) => `${column} = excluded.${column}`).join(', ')},
  up = excluded.up, down = excluded.down, transcripts = excluded.transcripts`;

/** Handoff states and their daily-counter columns: only these names reach the SQL. */
const HANDOFF_COLUMNS: Readonly<Record<AdminHandoffState, string>> = {
  sent: 'handoffs_sent',
  saved: 'handoffs_saved',
  unavailable: 'handoffs_unavailable',
  failed: 'handoffs_failed',
  limited: 'handoffs_limited',
};

/** Increments one counter of a bot's day; `column` is one of this file's constants. */
const bumpBotDay = (column: string): string => `
insert into ${BOT_DAYS_TABLE} (day, bot, source, ${column}) values ($1::date, $2, $3, 1)
on conflict (day, bot, source) do update set ${column} = ${BOT_DAYS_TABLE}.${column} + 1`;

/** U+FFFD, the replacement character. */
const REPLACEMENT = String.fromCodePoint(0xfffd);
/** Lone surrogates, which `text` and `jsonb` refuse like NUL characters. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/** A string Postgres stores: NUL and lone surrogates become U+FFFD, so one never fails a write. */
const storable = (value: string): string =>
  value.replace(LONE_SURROGATE, REPLACEMENT).replaceAll('\0', REPLACEMENT);
const storableJson = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    typeof inner === 'string' ? storable(inner) : inner,
  );
/** `jsonb` as the pool hands it back: parsed, or text with custom type parsers. */
const parsed = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value);

/** Epoch milliseconds of a `bigint` column, as a plain number whatever the pool's parsers. */
const ms = (column: string): string => `${column}::float8 as ${column}`;
/** A summed `bigint` column, as a plain number. */
const total = (column: string): string => `coalesce(sum(${column}), 0)::float8 as ${column}`;

interface UsageRow {
  readonly input_tokens: number;
  readonly cached_input_tokens: number;
  readonly cache_write_tokens: number;
  readonly output_tokens: number;
  readonly reasoning_tokens: number;
}
const usageOf = (row: UsageRow): AdminDayRow['usage'] => ({
  inputTokens: Number(row.input_tokens),
  cachedInputTokens: Number(row.cached_input_tokens),
  cacheWriteTokens: Number(row.cache_write_tokens),
  outputTokens: Number(row.output_tokens),
  reasoningTokens: Number(row.reasoning_tokens),
});

interface KeyRow {
  readonly conversation_id: string;
  readonly at: number;
  readonly bot: string;
  readonly visitor: string;
  readonly source: 'chat' | 'console';
}
const keyOf = (row: KeyRow): AdminRecordKey => ({
  bot: row.bot,
  conversationId: row.conversation_id,
  visitor: row.visitor,
  at: Number(row.at),
  source: row.source,
});

interface RatingRow extends KeyRow {
  readonly item_id: string;
  readonly rating: 'up' | 'down';
  readonly comment: string | null;
}
const ratingOf = (row: RatingRow): AdminStoredRating => ({
  ...keyOf(row),
  itemId: row.item_id,
  rating: row.rating,
  ...(row.comment === null ? {} : { comment: row.comment }),
});

interface TranscriptRow extends KeyRow {
  readonly item_id: string;
  readonly input: string;
  readonly attachments: number;
  readonly answer: string | null;
  readonly citations: unknown;
  readonly check: AdminTranscriptRecord['check'] | null;
  readonly reason: AdminTranscriptRecord['reason'];
}
const transcriptOf = (row: TranscriptRow): AdminTranscriptRecord => ({
  ...keyOf(row),
  ...(row.item_id === '' ? {} : { itemId: row.item_id }),
  input: row.input,
  attachments: Number(row.attachments),
  answer: row.answer ?? undefined,
  // Our own rows, written by `recordTranscript` from the port's citations.
  citations: parsed(row.citations) as AdminTranscriptRecord['citations'],
  ...(row.check === null ? {} : { check: row.check }),
  reason: row.reason,
});

interface SummaryRow extends UsageRow {
  readonly conversation_id: string;
  readonly bot: string;
  readonly visitor: string;
  readonly first_at: number;
  readonly last_at: number;
  readonly turns: number;
  readonly tokens: number;
  readonly up: number;
  readonly down: number;
  readonly transcript: boolean;
}

/** Runs `work` in a transaction on one connection, and rolls it back when anything throws. */
async function transaction<T>(
  pool: PostgresPool,
  work: (client: PostgresPoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    // `set local` ends with the transaction, so a pool the app passes keeps its own settings.
    await client.query(`begin; set local lock_timeout = '${LOCK_TIMEOUT}'`);
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // A connection that can't roll back is closed rather than handed back to the pool.
      broken = true;
    }
    throw error;
  } finally {
    client.release(broken);
  }
}

/** The error's code only: a message can name the host or the database user. */
const errorCode = (error: unknown): string => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return typeof code === 'string' && /^[A-Z0-9_]{1,32}$/i.test(code) ? ` (${code})` : '';
};

/**
 * Admin records in your own Postgres (ADR-0032): usage, ratings, transcripts and daily counters
 * for the admin console and `@boldare/askdare-admin`'s dashboard. Run `migrate` first (its `admin`
 * part); the store never changes the schema itself. On one `DATABASE_URL` it shares the pool of
 * `postgresConversations()`.
 *
 * ```ts
 * import { postgresAdminStore, postgresConversations } from '@boldare/askdare-postgres';
 *
 * export const { GET, POST, DELETE, sweep } = createChatHandler({
 *   bots: [bot],
 *   conversations: postgresConversations(),
 *   admin: { store: postgresAdminStore() }, // DATABASE_URL, or { url } or { pool }
 * });
 * ```
 *
 * Core writes the records and deletes them with their conversation; `sweep()` on the handlers
 * applies the retention. The store logs nothing.
 */
export function postgresAdminStore(
  options: PostgresAdminStoreOptions = {},
): AdminStore & Required<Pick<AdminStore, 'diagnose'>> {
  // Resolved on first use, so a build that loads the route without DATABASE_URL doesn't fail.
  let pool: PostgresPool | undefined;
  const db = (): PostgresPool => {
    pool ??= resolvePool(options);
    return pool;
  };

  /** `work` under the conversation's lock, followed by summing its records into its summary. */
  const underLock = (
    conversationId: string,
    work: (client: PostgresPoolClient) => Promise<boolean>,
  ): Promise<void> =>
    transaction(db(), async (client) => {
      await client.query(LOCK_CONVERSATIONS, [[conversationId]]);
      if (await work(client)) await client.query(SUMMARIZE, [[conversationId]]);
    });

  /** Deletes up to `limit` rows of `table` matching `where` (`$1`), skipping locked ones. */
  const deleteBatch = async (
    table: string,
    where: string,
    bound: unknown,
    limit: number,
    returning: string,
  ): Promise<readonly Record<string, string>[]> => {
    const result = await db().query(
      `delete from ${table} where ctid = any(array(
         select ctid from ${table} where ${where} limit $2 for update skip locked
       )) returning ${returning}`,
      [bound, limit],
    );
    return result.rows as Record<string, string>[];
  };

  return {
    name: 'postgres',

    async recordTurn(record, options) {
      // Records are kept until `sweep()`: no expiry of their own, so `retentionDays` isn't needed.
      options?.signal?.throwIfAborted();
      const at = checkAt(record.at);
      const day = dayOf(at);
      const { usage } = record;
      const detail = {
        durationMs: record.durationMs,
        outcome: record.outcome,
        finishReason: record.finishReason,
        errorCode: record.errorCode,
        steps: record.steps,
        tools: record.tools.map(({ name, outcome }) => ({ name, outcome })),
        citations: record.citations,
        check: record.check,
        newConversation: record.newConversation,
        unanswered: record.unanswered,
      };
      const tokens = [
        usage.inputTokens,
        usage.cachedInputTokens,
        usage.cacheWriteTokens,
        usage.outputTokens,
        usage.reasoningTokens,
      ];
      await underLock(record.conversationId, async (client) => {
        const inserted = await client.query(
          `insert into ${TURNS_TABLE} (conversation_id, at, bot, visitor, source, model,
             ${USAGE_COLUMNS.join(', ')}, detail)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
           on conflict (conversation_id, at) do nothing`,
          [
            record.conversationId,
            at,
            record.bot,
            record.visitor,
            record.source,
            record.model,
            ...tokens,
            storableJson(detail),
          ],
        );
        // The same turn again: already written and counted.
        if (inserted.rowCount === 0) return false;
        await client.query(
          `insert into ${TURN_DAYS_TABLE} (day, bot, model, source, turns, failed, unanswered,
             ${USAGE_COLUMNS.join(', ')})
           values ($1::date, $2, $3, $4, 1, $5, $6, $7, $8, $9, $10, $11)
           on conflict (day, bot, model, source) do update set
             turns = ${TURN_DAYS_TABLE}.turns + 1,
             failed = ${TURN_DAYS_TABLE}.failed + excluded.failed,
             unanswered = ${TURN_DAYS_TABLE}.unanswered + excluded.unanswered,
             ${USAGE_COLUMNS.map((column) => `${column} = ${TURN_DAYS_TABLE}.${column} + excluded.${column}`).join(', ')}`,
          [
            day,
            record.bot,
            record.model,
            record.source,
            record.outcome === 'failed' ? 1 : 0,
            record.unanswered ? 1 : 0,
            ...tokens,
          ],
        );
        if (record.newConversation) {
          await client.query(bumpBotDay('conversations'), [day, record.bot, record.source]);
        }
        return true;
      });
    },

    async recordRating(record, options) {
      options?.signal?.throwIfAborted();
      const at = checkAt(record.at);
      if (record.rating !== null && record.rating !== 'up' && record.rating !== 'down') {
        throw new Error('[askdare-postgres] A rating must be up, down or null.');
      }
      await underLock(record.conversationId, async (client) => {
        const [stored] = await queryRows<{
          day: string;
          bot: string;
          source: string;
          rating: 'up' | 'down';
        }>(
          client,
          `delete from ${RATINGS_TABLE} where conversation_id = $1 and item_id = $2
           returning to_char(to_timestamp(at / 1000.0) at time zone 'UTC', 'YYYY-MM-DD') as day,
             bot, source, rating`,
          [record.conversationId, record.itemId],
        );
        if (stored) {
          // The rating is no longer counted on its day; a daily row already swept stays gone.
          const column = stored.rating === 'up' ? 'up' : 'down';
          await client.query(
            `update ${BOT_DAYS_TABLE} set ${column} = greatest(${column} - 1, 0)
             where day = $1::date and bot = $2 and source = $3`,
            [stored.day, stored.bot, stored.source],
          );
        }
        if (record.rating !== null) {
          await client.query(
            `insert into ${RATINGS_TABLE} (conversation_id, item_id, at, bot, visitor, source,
               rating, comment)
             values ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              record.conversationId,
              record.itemId,
              at,
              record.bot,
              record.visitor,
              record.source,
              record.rating,
              record.comment === undefined ? null : storable(record.comment),
            ],
          );
          await client.query(bumpBotDay(record.rating === 'up' ? 'up' : 'down'), [
            dayOf(at),
            record.bot,
            record.source,
          ]);
        }
        return stored !== undefined || record.rating !== null;
      });
    },

    async recordTranscript(record, options) {
      options?.signal?.throwIfAborted();
      const at = checkAt(record.at);
      await underLock(record.conversationId, async (client) => {
        await client.query(
          `insert into ${TRANSCRIPTS_TABLE} (conversation_id, at, item_id, bot, visitor, source,
             input, attachments, answer, citations, "check", reason)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
           on conflict (conversation_id, at, item_id) do update set
             bot = excluded.bot, visitor = excluded.visitor, source = excluded.source,
             input = excluded.input, attachments = excluded.attachments,
             answer = excluded.answer, citations = excluded.citations,
             "check" = excluded."check", reason = excluded.reason`,
          [
            record.conversationId,
            at,
            record.itemId ?? '',
            record.bot,
            record.visitor,
            record.source,
            storable(record.input),
            record.attachments,
            record.answer === undefined ? null : storable(record.answer),
            storableJson(record.citations.map(({ index, title, url }) => ({ index, title, url }))),
            record.check ?? null,
            record.reason,
          ],
        );
        return true;
      });
    },

    async count(event, signal) {
      signal?.throwIfAborted();
      const at = checkAt(event.at);
      let column: string | undefined;
      if (event.kind === 'lead') column = 'leads';
      else if (event.kind === 'handoff' && Object.hasOwn(HANDOFF_COLUMNS, event.state)) {
        column = HANDOFF_COLUMNS[event.state];
      }
      if (column === undefined) throw new Error('[askdare-postgres] Unknown count event.');
      await db().query(bumpBotDay(column), [dayOf(at), event.bot, event.source]);
    },

    async days(range, signal) {
      signal?.throwIfAborted();
      const { from, to, bot, source } = checkRange(range);
      const where = `day between $1::date and $2::date
        and ($3::text is null or bot = $3) and ($4::text is null or source = $4)`;
      const values = [from, to, bot, source];
      const turnRows = await queryRows<
        UsageRow & {
          day: string;
          bot: string;
          model: string;
          turns: number;
          failed: number;
          unanswered: number;
        }
      >(
        db(),
        `select to_char(day, 'YYYY-MM-DD') as day, bot, model,
           ${['turns', 'failed', 'unanswered', ...USAGE_COLUMNS].map(total).join(', ')}
         from ${TURN_DAYS_TABLE} where ${where}
         group by day, bot, model order by day, bot, model`,
        values,
      );
      signal?.throwIfAborted();
      const counters = [
        'conversations',
        'up',
        'down',
        'leads',
        ...Object.values(HANDOFF_COLUMNS),
      ] as const;
      const botRows = await queryRows<{ day: string; bot: string } & Record<string, number>>(
        db(),
        `select to_char(day, 'YYYY-MM-DD') as day, bot, ${counters.map(total).join(', ')}
         from ${BOT_DAYS_TABLE} where ${where}
         group by day, bot order by day, bot`,
        values,
      );
      const handoffs = (row: Record<string, number>): AdminBotDayRow['handoffs'] => ({
        sent: Number(row['handoffs_sent']),
        saved: Number(row['handoffs_saved']),
        unavailable: Number(row['handoffs_unavailable']),
        failed: Number(row['handoffs_failed']),
        limited: Number(row['handoffs_limited']),
      });
      return {
        turns: turnRows.map(
          (row): AdminDayRow => ({
            day: row.day,
            bot: row.bot,
            model: row.model,
            turns: Number(row.turns),
            failed: Number(row.failed),
            unanswered: Number(row.unanswered),
            usage: usageOf(row),
          }),
        ),
        bots: botRows.map(
          (row): AdminBotDayRow => ({
            day: row.day,
            bot: row.bot,
            conversations: Number(row['conversations']),
            up: Number(row['up']),
            down: Number(row['down']),
            leads: Number(row['leads']),
            handoffs: handoffs(row),
          }),
        ),
      };
    },

    async conversations(query, signal) {
      signal?.throwIfAborted();
      const { start, end, bot, source } = checkRange(query);
      const limit = checkLimit(query.limit);
      const byTokens = query.order === 'tokens';
      if (!byTokens && query.order !== 'latest') {
        throw new Error('[askdare-postgres] An order must be tokens or latest.');
      }
      // Keyset paging: the sort key of the last item returned. Ties go to the latest activity,
      // then to the conversation ID.
      let after: readonly [number | null, number | null, string | null] = [null, null, null];
      if (query.cursor !== undefined) {
        after = byTokens
          ? decodeCursor(query.cursor, 'ct', ['number', 'number', 'string'] as const)
          : [null, ...decodeCursor(query.cursor, 'cl', ['number', 'string'] as const)];
      }
      const keyset = byTokens
        ? `($6::bigint is null or tokens < $6 or (tokens = $6 and
             (last_at < $7 or (last_at = $7 and conversation_id > $8))))`
        : `$6::bigint is null and ($7::bigint is null or last_at < $7 or (last_at = $7 and conversation_id > $8))`;
      const rows = await queryRows<SummaryRow>(
        db(),
        `select conversation_id, bot, visitor, ${['first_at', 'last_at', 'turns', 'tokens', ...USAGE_COLUMNS, 'up', 'down'].map(ms).join(', ')},
           transcripts > 0 as transcript
         from ${SUMMARIES_TABLE}
         where first_at >= $1 and first_at < $2
           and ($3::text is null or bot = $3) and ($4::text is null or source = $4)
           and (not $5 or down > 0) and ${keyset}
         order by ${byTokens ? 'tokens desc, ' : ''}last_at desc, conversation_id
         limit $9`,
        [start, end, bot, source, query.rated === 'down', ...after, limit + 1],
      );
      const items = rows.slice(0, limit).map(
        (row): AdminConversationSummary => ({
          conversationId: row.conversation_id,
          bot: row.bot,
          visitor: row.visitor,
          firstAt: Number(row.first_at),
          lastAt: Number(row.last_at),
          turns: Number(row.turns),
          usage: usageOf(row),
          up: Number(row.up),
          down: Number(row.down),
          transcript: row.transcript,
        }),
      );
      const last = rows[limit - 1];
      if (rows.length <= limit || !last) return { items };
      const cursor = byTokens
        ? encodeCursor('ct', [Number(last.tokens), Number(last.last_at), last.conversation_id])
        : encodeCursor('cl', [Number(last.last_at), last.conversation_id]);
      return { items, cursor };
    },

    async ratings(query, signal) {
      signal?.throwIfAborted();
      const { start, end, bot, source } = checkRange(query);
      const limit = checkLimit(query.limit);
      const rating = query.rating ?? null;
      if (rating !== null && rating !== 'up' && rating !== 'down') {
        throw new Error('[askdare-postgres] A rating must be up or down.');
      }
      const after =
        query.cursor === undefined
          ? [null, null, null]
          : decodeCursor(query.cursor, 'r', ['number', 'string', 'string'] as const);
      const rows = await queryRows<RatingRow>(
        db(),
        `select conversation_id, item_id, ${ms('at')}, bot, visitor, source, rating, comment
         from ${RATINGS_TABLE}
         where at >= $1 and at < $2
           and ($3::text is null or bot = $3) and ($4::text is null or source = $4)
           and ($5::text is null or rating = $5)
           and ($6::bigint is null or at < $6
             or (at = $6 and (conversation_id, item_id) > ($7::text, $8::text)))
         order by at desc, conversation_id, item_id
         limit $9`,
        [start, end, bot, source, rating, ...after, limit + 1],
      );
      const items = rows.slice(0, limit).map(ratingOf);
      const last = rows[limit - 1];
      if (rows.length <= limit || !last) return { items };
      return {
        items,
        cursor: encodeCursor('r', [Number(last.at), last.conversation_id, last.item_id]),
      };
    },

    async transcript(conversationId, signal) {
      signal?.throwIfAborted();
      const rows = await queryRows<TranscriptRow>(
        db(),
        `select conversation_id, ${ms('at')}, item_id, bot, visitor, source, input, attachments,
           answer, citations, "check", reason
         from ${TRANSCRIPTS_TABLE} where conversation_id = $1
         order by at, item_id`,
        [conversationId],
      );
      return rows.map(transcriptOf);
    },

    async deleteConversation(conversationId, signal) {
      signal?.throwIfAborted();
      await transaction(db(), async (client) => {
        await client.query(LOCK_CONVERSATIONS, [[conversationId]]);
        for (const table of [TURNS_TABLE, RATINGS_TABLE, TRANSCRIPTS_TABLE, SUMMARIES_TABLE]) {
          await client.query(`delete from ${table} where conversation_id = $1`, [conversationId]);
        }
      });
    },

    async sweep({ recordsBefore, daysBefore, limit }, signal) {
      signal?.throwIfAborted();
      parseDay(daysBefore);
      if (!Number.isInteger(limit) || limit < 1) {
        throw new Error('[askdare-postgres] A limit must be a positive integer.');
      }
      if (!Number.isFinite(recordsBefore) || Math.abs(recordsBefore) > 8.64e15) {
        throw new Error('[askdare-postgres] recordsBefore must be epoch milliseconds.');
      }
      // Records have whole-millisecond times: before x is before its ceiling.
      const before = Math.ceil(recordsBefore);
      let left = limit;
      const touched = new Set<string>();
      // Records first, each delete a statement of its own: holding record locks while waiting for
      // a conversation's lock could deadlock with a write replacing the same rating.
      for (const table of [TURNS_TABLE, RATINGS_TABLE, TRANSCRIPTS_TABLE]) {
        if (left === 0) break;
        signal?.throwIfAborted();
        const rows = await deleteBatch(table, 'at < $1', before, left, 'conversation_id');
        left -= rows.length;
        for (const row of rows) touched.add(row['conversation_id'] as string);
      }
      if (touched.size > 0) {
        const ids = [...touched];
        await transaction(db(), async (client) => {
          await client.query(LOCK_CONVERSATIONS, [ids]);
          await client.query(SUMMARIZE, [ids]);
        });
      }
      if (left > 0) {
        // Every record before the cutoff is gone, so is every summary that ended before it (one a
        // sweep left behind when it stopped between the two steps above).
        await db().query(`delete from ${SUMMARIES_TABLE} where last_at < $1`, [before]);
      }
      // Then daily rows, which hold no conversation or visitor and so need no lock.
      for (const table of [TURN_DAYS_TABLE, BOT_DAYS_TABLE]) {
        if (left === 0) break;
        signal?.throwIfAborted();
        const rows = await deleteBatch(table, 'day < $1::date', daysBefore, left, '1 as one');
        left -= rows.length;
      }
      return limit - left;
    },

    async diagnose(signal) {
      signal?.throwIfAborted();
      let status: SchemaStatus;
      try {
        status = await schemaStatus(db(), ADMIN_PART);
      } catch (error) {
        return [
          {
            status: 'fail',
            title: `Postgres admin store: the database can't be reached${errorCode(error)}.`,
            fix: 'Check DATABASE_URL (or the url or pool you pass to postgresAdminStore), and that the database accepts connections from this server.',
          },
        ];
      }
      if (status.state === 'behind') {
        return [
          {
            status: 'fail',
            title: `Postgres admin store: the schema is at version ${status.current}; this version of @boldare/askdare-postgres needs ${status.latest}.`,
            fix: 'Run `npx askdare-postgres migrate` before this code serves requests.',
          },
        ];
      }
      const checks: ConversationStoreCheck[] = [
        status.state === 'current'
          ? { status: 'ok', title: `Postgres admin store: schema version ${status.current}.` }
          : {
              status: 'warn',
              title: `Postgres admin store: the schema is at version ${status.current}, newer than this version of @boldare/askdare-postgres knows (${status.latest}).`,
              fix: 'Upgrade @boldare/askdare-postgres to the version that migrated the database.',
            },
      ];
      try {
        const [row] = await queryRows<{ oldest: number | null }>(
          db(),
          `select least(
             (select min(at) from ${TURNS_TABLE}),
             (select min(at) from ${RATINGS_TABLE}),
             (select min(at) from ${TRANSCRIPTS_TABLE})
           )::float8 as oldest`,
        );
        const oldest = row?.oldest == null ? undefined : Number(row.oldest);
        if (oldest !== undefined) {
          // Core warns when records outlive admin.retentionDays; this only reports the age.
          const days = Math.floor((Date.now() - oldest) / DAY_MS);
          checks.push({
            status: 'ok',
            title: `Postgres admin store: the oldest record is ${days} days old.`,
          });
        }
      } catch (error) {
        checks.push({
          status: 'fail',
          title: `Postgres admin store: the records can't be read${errorCode(error)}.`,
          fix: 'Run `npx askdare-postgres migrate`, and check that the database user can read the askdare_admin_ tables.',
        });
      }
      return checks;
    },
  };
}
