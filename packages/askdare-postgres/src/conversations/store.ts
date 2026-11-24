import { randomUUID } from 'node:crypto';
import {
  type ConversationStore,
  type ConversationStoreCheck,
  type PositionedItem,
  type StoredItem,
  VersionConflictError,
} from '@boldare/askdare';
import {
  type PostgresConnectionOptions,
  type PostgresPool,
  type PostgresPoolClient,
  queryRows,
} from '../connection';
import { resolvePool } from '../pool';
import { schemaStatus } from '../schema/status';
import { CONVERSATIONS_PART, CONVERSATIONS_TABLE, ITEMS_TABLE } from './schema';

/** Items a page returns when the caller sets no limit, and the most it ever returns. */
const DEFAULT_PAGE = 100;
const MAX_PAGE = 1_000;

/** The IDs this store issues: lowercase UUIDs, which fit the resume token's check. */
const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A `page` cursor: the `seq` of the oldest item already returned. */
const CURSOR = /^[1-9][0-9]{0,15}$/;

/** Epoch milliseconds of a `timestamptz` column, as a plain number whatever the pool's type parsers. */
const epochMs = (column: string): string => `floor(extract(epoch from ${column}) * 1000)::float8`;

/**
 * The files attached in visitor messages of some conversations, found inside the database with a
 * JSON path rather than by reading every item.
 */
const SELECT_FILES = `
select distinct conversation_id::text as conversation_id, file #>> '{}' as file_id
from ${ITEMS_TABLE},
  jsonb_path_query(item, '$.parts[*] ? (@.type == "file").fileId') as file
where conversation_id = any($1::uuid[]) and type = 'message' and item->>'role' = 'user'`;

/** Items with their positions, newest last, plus the conversation's version, in one snapshot. */
const selectItems = (where: string): string => `
select c.version::float8 as version, i.seq::float8 as seq, i.item, ${epochMs('i.created_at')} as at
from ${CONVERSATIONS_TABLE} c
left join lateral (
  select seq, item, created_at from ${ITEMS_TABLE}
  where conversation_id = c.id ${where}
  order by seq desc
  limit $2
) i on true
where c.id = $1
order by i.seq`;

interface ItemRow {
  readonly version: number;
  /** Null for a conversation with no items (the left join found none). */
  readonly seq: number | null;
  readonly item: unknown;
  readonly at: number | null;
}

/** U+FFFD, the replacement character. */
const REPLACEMENT = String.fromCodePoint(0xfffd);

/** Lone surrogates, which `jsonb` refuses like NUL characters. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * `JSON.stringify` replacer for strings Postgres can't store: NUL and lone surrogates become
 * U+FFFD. The replacement is deterministic, so a replayed item still always maps to the same
 * request. Without it, one such character in a visitor message or a tool output would fail the
 * append, and with it the turn, every time.
 */
const storable = (_key: string, value: unknown): unknown =>
  typeof value === 'string'
    ? value.replace(LONE_SURROGATE, REPLACEMENT).replaceAll('\0', REPLACEMENT)
    : value;

const unknownConversation = (): Error =>
  new Error('[askdare-postgres] The conversation does not exist.');

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';

/** Runs `work` in a transaction on one connection, and rolls it back when anything throws. */
async function transaction<T>(
  pool: PostgresPool,
  work: (client: PostgresPoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('begin');
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

/** The rows of `selectItems`, as positioned items; `undefined` when the conversation is unknown. */
function positioned(
  rows: readonly ItemRow[],
): { readonly version: number; readonly items: PositionedItem[] } | undefined {
  const [first] = rows;
  if (!first) return undefined;
  const items: PositionedItem[] = [];
  for (const row of rows) {
    if (row.seq === null) continue;
    // Our own rows, written by `append` from StoredItems. A pool with custom type parsers may
    // hand `jsonb` back as text.
    const item = (typeof row.item === 'string' ? JSON.parse(row.item) : row.item) as StoredItem;
    items.push({ ...item, seq: Number(row.seq), at: Number(row.at) });
  }
  return { version: Number(first.version), items };
}

/** File IDs per conversation, each once. */
async function attachedFiles(
  db: Pick<PostgresPool, 'query'>,
  ids: readonly string[],
): Promise<Map<string, string[]>> {
  const rows = await queryRows<{ conversation_id: string; file_id: string }>(db, SELECT_FILES, [
    ids,
  ]);
  const files = new Map<string, string[]>();
  for (const row of rows) {
    const list = files.get(row.conversation_id) ?? [];
    list.push(row.file_id);
    files.set(row.conversation_id, list);
  }
  return files;
}

/**
 * Conversations kept in your own Postgres (ADR-0024): an item store, so turns replay the stored
 * items with `store: false` and nothing of the conversation stays at OpenAI. Run `migrate` first;
 * the store never changes the schema itself.
 *
 * ```ts
 * import { postgresConversations } from '@boldare/askdare-postgres';
 *
 * export const { GET, POST, DELETE } = createChatHandler({
 *   bots: [bot],
 *   conversations: postgresConversations(), // DATABASE_URL, or { url } or { pool }
 * });
 * ```
 *
 * `sweep` deletes idle conversations for a retention period you choose; call it from a cron route
 * or a scheduled job (see the README). The store logs nothing.
 */
export function postgresConversations(
  options: PostgresConnectionOptions = {},
): ConversationStore & Required<Pick<ConversationStore, 'sweep' | 'diagnose'>> {
  // Resolved on first use, so a build that loads the route without DATABASE_URL doesn't fail.
  let pool: PostgresPool | undefined;
  const db = (): PostgresPool => {
    pool ??= resolvePool(options);
    return pool;
  };

  return {
    name: 'postgres',

    async create({ botId, owner }, signal) {
      signal?.throwIfAborted();
      const id = randomUUID();
      await db().query(
        `insert into ${CONVERSATIONS_TABLE} (id, bot_id, owner) values ($1, $2, $3)`,
        [id, botId, owner],
      );
      return id;
    },

    async info(id, signal) {
      signal?.throwIfAborted();
      if (!CONVERSATION_ID.test(id)) return undefined;
      const [row] = await queryRows<{
        bot_id: string;
        owner: string;
        created_at: number;
        updated_at: number;
        version: number;
      }>(
        db(),
        `select bot_id, owner, ${epochMs('created_at')} as created_at, ${epochMs('updated_at')} as updated_at, version::float8 as version
         from ${CONVERSATIONS_TABLE} where id = $1`,
        [id],
      );
      if (!row) return undefined;
      return {
        id,
        botId: row.bot_id,
        owner: row.owner,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
        version: Number(row.version),
      };
    },

    async context(id, options) {
      options?.signal?.throwIfAborted();
      if (!CONVERSATION_ID.test(id)) throw unknownConversation();
      const maxItems =
        options?.maxItems === undefined ? null : Math.max(0, Math.floor(options.maxItems));
      // One statement, so the items and the version come from the same snapshot.
      const rows = await queryRows<ItemRow>(db(), selectItems(''), [id, maxItems]);
      const found = positioned(rows);
      if (!found) throw unknownConversation();
      const { version, items } = found;
      // A window that doesn't reach the first item starts at the next visitor message, so a call
      // is never replayed without the turn around it.
      const first = items[0];
      if (first && first.seq > 1) {
        const start = items.findIndex((item) => item.type === 'message' && item.role === 'user');
        return { kind: 'items', items: start < 0 ? [] : items.slice(start), version };
      }
      return { kind: 'items', items, version };
    },

    async append(id, items, options) {
      options?.signal?.throwIfAborted();
      if (!CONVERSATION_ID.test(id)) throw unknownConversation();
      const json = JSON.stringify(items, storable);
      return transaction(db(), async (client) => {
        // The row lock serialises appends to one conversation, and a sweep or delete with them.
        const [row] = await queryRows<{ version: number }>(
          client,
          `select version::float8 as version from ${CONVERSATIONS_TABLE} where id = $1 for update`,
          [id],
        );
        if (!row) throw unknownConversation();
        const version = Number(row.version);
        const expected = options?.expect;
        if (expected !== undefined && expected !== version) {
          throw new VersionConflictError(expected, version);
        }
        if (items.length === 0) return version;
        try {
          await client.query(
            `insert into ${ITEMS_TABLE} (conversation_id, seq, item_id, type, item)
             select $1, $2::bigint + t.ord, t.x->>'id', t.x->>'type', t.x
             from jsonb_array_elements($3::jsonb) with ordinality as t(x, ord)`,
            [id, version, json],
          );
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new Error(
              '[askdare-postgres] An item ID is already stored in this conversation.',
              {
                cause: error,
              },
            );
          }
          throw error;
        }
        const next = version + items.length;
        await client.query(
          `update ${CONVERSATIONS_TABLE} set version = $2, updated_at = now() where id = $1`,
          [id, next],
        );
        return next;
      });
    },

    async page(id, options) {
      options?.signal?.throwIfAborted();
      if (!CONVERSATION_ID.test(id)) throw unknownConversation();
      const before = options?.before;
      if (before !== undefined && !CURSOR.test(before)) {
        throw new Error('[askdare-postgres] Invalid page cursor.');
      }
      const requested = options?.limit ?? DEFAULT_PAGE;
      const limit = Number.isFinite(requested)
        ? Math.min(MAX_PAGE, Math.max(1, Math.floor(requested)))
        : DEFAULT_PAGE;
      // Keyset paging on the primary key: every page costs the same, however far back it is.
      const rows = await queryRows<ItemRow>(
        db(),
        selectItems('and seq < coalesce($3::bigint, 9223372036854775807)'),
        [id, limit, before ?? null],
      );
      const found = positioned(rows);
      if (!found) throw unknownConversation();
      const first = found.items[0];
      return first && first.seq > 1
        ? { items: found.items, before: String(first.seq) }
        : { items: found.items };
    },

    async delete(id, signal) {
      signal?.throwIfAborted();
      if (!CONVERSATION_ID.test(id)) return { fileIds: [] };
      return transaction(db(), async (client) => {
        // Locked first, so an append in flight either finishes before the files are read or
        // finds the conversation gone: no attached file escapes the list.
        const locked = await client.query(
          `select 1 from ${CONVERSATIONS_TABLE} where id = $1 for update`,
          [id],
        );
        if (locked.rowCount === 0) return { fileIds: [] };
        const files = await attachedFiles(client, [id]);
        await client.query(`delete from ${CONVERSATIONS_TABLE} where id = $1`, [id]);
        return { fileIds: files.get(id) ?? [] };
      });
    },

    async sweep(idleSince, limit) {
      if (!Number.isFinite(idleSince)) {
        throw new Error('[askdare-postgres] sweep needs idleSince in epoch milliseconds.');
      }
      const count = Math.floor(limit);
      if (!(count >= 1)) return [];
      return transaction(db(), async (client) => {
        // skip locked: a conversation that a turn is appending to right now is not idle, and two
        // sweepers never wait for each other or delete the same conversation twice.
        const ids = (
          await queryRows<{ id: string }>(
            client,
            `select id::text as id from ${CONVERSATIONS_TABLE}
             where updated_at < $1::timestamptz
             order by updated_at
             limit $2
             for update skip locked`,
            [new Date(idleSince).toISOString(), count],
          )
        ).map((row) => row.id);
        if (ids.length === 0) return [];
        const files = await attachedFiles(client, ids);
        await client.query(`delete from ${CONVERSATIONS_TABLE} where id = any($1::uuid[])`, [ids]);
        return ids.map((id) => ({ id, fileIds: files.get(id) ?? [] }));
      });
    },

    async diagnose(signal) {
      signal?.throwIfAborted();
      let status: Awaited<ReturnType<typeof schemaStatus>>;
      try {
        status = await schemaStatus(db(), CONVERSATIONS_PART);
      } catch (error) {
        // The error's code only: messages can name the host or the database user.
        const code =
          typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
        const detail =
          typeof code === 'string' && /^[A-Z0-9_]{1,32}$/i.test(code) ? ` (${code})` : '';
        return [
          {
            status: 'fail',
            title: `Postgres conversation store: the database can't be reached${detail}.`,
            fix: 'Check DATABASE_URL (or the url or pool you pass to postgresConversations), and that the database accepts connections from this server.',
          },
        ];
      }
      const checks: Record<typeof status.state, ConversationStoreCheck> = {
        current: {
          status: 'ok',
          title: `Postgres conversation store: schema version ${status.current}.`,
        },
        behind: {
          status: 'fail',
          title: `Postgres conversation store: the schema is at version ${status.current}; this version of @boldare/askdare-postgres needs ${status.latest}.`,
          fix: 'Run `npx askdare-postgres migrate` before this code serves requests.',
        },
        ahead: {
          status: 'warn',
          title: `Postgres conversation store: the schema is at version ${status.current}, newer than this version of @boldare/askdare-postgres knows (${status.latest}).`,
          fix: 'Upgrade @boldare/askdare-postgres to the version that migrated the database.',
        },
      };
      return [checks[status.state]];
    },
  };
}
