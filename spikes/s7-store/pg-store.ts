import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import {
  type ConversationInfo,
  type ConversationStore,
  type Positioned,
  type StoredItem,
  VersionConflict,
} from './port.ts';

export const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://askdare:askdare@127.0.0.1:54327/askdare';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function migrate(pool: pg.Pool): Promise<void> {
  await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
}

interface ItemRow {
  seq: string;
  item: StoredItem;
  created_at: Date;
}
const positioned = (row: ItemRow): Positioned => ({ ...row.item, seq: Number(row.seq), at: row.created_at.getTime() });

/** File IDs in the visitor's messages, read inside the database. */
const FILES_SQL = `
  select distinct f #>> '{}' as file_id
  from askdare_items, jsonb_path_query(item, '$.parts[*] ? (@.type == "file").fileId') f
  where conversation_id = $1 and type = 'message' and item->>'role' = 'user'`;

/** The prototype `postgres()` store. One pool per server; all queries are parameterised. */
export function postgresStore(pool: pg.Pool): ConversationStore {
  const deleteOne = async (client: pg.PoolClient, id: string): Promise<string[]> => {
    const files = await client.query<{ file_id: string }>(FILES_SQL, [id]);
    await client.query('delete from askdare_conversations where id = $1', [id]);
    return files.rows.map((row) => row.file_id);
  };
  return {
    name: 'postgres',

    async create({ botId, owner }) {
      const id = randomUUID();
      await pool.query('insert into askdare_conversations (id, bot_id, owner) values ($1, $2, $3)', [id, botId, owner]);
      return id;
    },

    async info(id) {
      if (!UUID.test(id)) return undefined;
      const { rows } = await pool.query<{ bot_id: string; owner: string; created_at: Date; updated_at: Date; version: string }>(
        'select bot_id, owner, created_at, updated_at, version from askdare_conversations where id = $1',
        [id],
      );
      const row = rows[0];
      if (!row) return undefined;
      return { id, botId: row.bot_id, owner: row.owner, createdAt: row.created_at.getTime(), updatedAt: row.updated_at.getTime(), version: Number(row.version) } satisfies ConversationInfo;
    },

    async context(id, options) {
      const maxItems = options?.maxItems ?? 1_000;
      const info = await this.info(id);
      if (!info) throw new Error('not_found');
      const { rows } = await pool.query<ItemRow>(
        'select seq, item, created_at from askdare_items where conversation_id = $1 order by seq desc limit $2',
        [id, maxItems],
      );
      const items = rows.reverse().map(positioned);
      // Cut forward to a turn start unless the window reaches the first item.
      const cut = items[0] && items[0].seq > 1 ? items.findIndex((item) => item.type === 'message' && item.role === 'user') : 0;
      const window = cut < 0 ? [] : items.slice(cut);
      return { kind: 'items', items: window, version: info.version };
    },

    async append(id, items, options) {
      if (items.length === 0) return (await this.info(id))?.version ?? 0;
      const client = await pool.connect();
      try {
        await client.query('begin');
        // The row lock serialises appends to one conversation.
        const { rows } = await client.query<{ version: string }>(
          'select version from askdare_conversations where id = $1 for update',
          [id],
        );
        const row = rows[0];
        if (!row) throw new Error('not_found');
        const version = Number(row.version);
        if (options?.expect !== undefined && options.expect !== version) throw new VersionConflict(options.expect, version);
        await client.query(
          `insert into askdare_items (conversation_id, seq, item_id, type, item)
           select $1, $2::bigint + ord, x->>'id', x->>'type', x
           from jsonb_array_elements($3::jsonb) with ordinality as t(x, ord)`,
          [id, version, JSON.stringify(items)],
        );
        const next = version + items.length;
        await client.query('update askdare_conversations set version = $2, updated_at = now() where id = $1', [id, next]);
        await client.query('commit');
        return next;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async page(id, options) {
      const limit = Math.min(options?.limit ?? 100, 1_000);
      const before = options?.before === undefined ? Number.MAX_SAFE_INTEGER : Number(options.before);
      const { rows } = await pool.query<ItemRow>(
        'select seq, item, created_at from askdare_items where conversation_id = $1 and seq < $2 order by seq desc limit $3',
        [id, before, limit],
      );
      const items = rows.reverse().map(positioned);
      const first = items[0];
      return first && first.seq > 1 ? { items, before: String(first.seq) } : { items };
    },

    async delete(id) {
      if (!UUID.test(id)) return { fileIds: [] };
      const client = await pool.connect();
      try {
        await client.query('begin');
        const fileIds = await deleteOne(client, id);
        await client.query('commit');
        return { fileIds };
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },

    async sweep(idleSince, limit) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        // skip locked: two sweeping instances never block each other or a live append.
        const { rows } = await client.query<{ id: string }>(
          'select id from askdare_conversations where updated_at < to_timestamp($1 / 1000.0) order by updated_at limit $2 for update skip locked',
          [idleSince, limit],
        );
        const deleted = [];
        for (const { id } of rows) deleted.push({ id, fileIds: await deleteOne(client, id) });
        await client.query('commit');
        return deleted;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
