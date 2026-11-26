import type { StoredItem } from '@boldare/askdare';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, migrateParts } from '../schema/migrate';
import type { SchemaPart } from '../schema/migration';
import { createTestSchema, TEST_DATABASE_URL, type TestSchema } from '../testing/database';
import { COMPACTION_INDEX, CONVERSATIONS_PART, ITEMS_TABLE } from './schema';
import { FROM_COMPACTION, postgresConversations, selectItems } from './store';

/** The conversations schema as 0.6.0 released it. */
const CONVERSATIONS_V1: SchemaPart = {
  name: CONVERSATIONS_PART.name,
  migrations: CONVERSATIONS_PART.migrations.slice(0, 1),
};

const OWNER = { botId: 'support', owner: 'visitor:abc' } as const;
const MODEL = { provider: 'openai', family: 'gpt-x' } as const;

let counter = 0;
const user = (text: string): StoredItem => {
  counter += 1;
  return { id: `itm_${counter}`, type: 'message', role: 'user', parts: [{ type: 'text', text }] };
};
const compaction = (): StoredItem => {
  counter += 1;
  return {
    id: `itm_${counter}`,
    type: 'native',
    ...MODEL,
    kind: 'compaction',
    data: { type: 'compaction', encrypted_content: `summary-${counter}` },
  };
};

describe.skipIf(!TEST_DATABASE_URL)('the compaction index (conversations migration 2)', () => {
  let schema: TestSchema;

  beforeEach(async () => {
    schema = await createTestSchema();
  });

  afterEach(async () => {
    await schema.drop();
  });

  /** The index's definition and whether Postgres may use it, or undefined without one. */
  const compactionIndex = async (): Promise<{ definition: string; valid: boolean } | undefined> => {
    const result = await schema.pool.query<{ definition: string; valid: boolean }>(
      `select pg_get_indexdef(indexrelid) as definition, indisvalid as valid
       from pg_index where indexrelid = to_regclass($1)`,
      [COMPACTION_INDEX],
    );
    return result.rows[0];
  };

  /** The plan `context()` gets for a conversation, as the JSON of `explain`. */
  const plan = async (id: string, provider: string | null, family: string | null) => {
    const client = await schema.pool.connect();
    try {
      // The plan a pool reuses after a few executions: parameters unknown to the planner.
      await client.query('set plan_cache_mode = force_generic_plan');
      await client.query(
        `prepare context_items(uuid, int, text, text) as ${selectItems(FROM_COMPACTION)}`,
      );
      // EXPLAIN EXECUTE takes no bind parameters; the values are the test's own.
      const literal = (value: string | null): string => (value === null ? 'null' : `'${value}'`);
      const result = await client.query<{ 'QUERY PLAN': unknown }>(
        `explain (format json) execute context_items(${literal(id)}, 100, ${literal(provider)}, ${literal(family)})`,
      );
      return JSON.stringify(result.rows[0]?.['QUERY PLAN']);
    } finally {
      client.release(true);
    }
  };

  it('is created on a fresh database, as a valid partial index', async () => {
    const report = await migrate({ pool: schema.pool, parts: ['conversations'] });
    expect(report.versions).toEqual({ conversations: 2 });
    const index = await compactionIndex();
    expect(index?.valid).toBe(true);
    expect(index?.definition).toContain(
      "(conversation_id, ((item ->> 'provider'::text)), ((item ->> 'family'::text)), seq)",
    );
    expect(index?.definition).toContain(
      "WHERE ((type = 'native'::text) AND ((item ->> 'kind'::text) = 'compaction'::text))",
    );
  });

  it('upgrades a 0.6 database with conversations in it', async () => {
    await migrateParts(schema.pool, [CONVERSATIONS_V1]);
    const store = postgresConversations({ pool: schema.pool });
    const id = await store.create(OWNER);
    const latest = compaction();
    await store.append(id, [user('one'), compaction(), user('two'), latest, user('three')]);
    expect(await compactionIndex()).toBeUndefined();

    const report = await migrate({ pool: schema.pool, parts: ['conversations'] });
    expect(report.applied).toEqual([
      { part: 'conversations', version: 2, name: 'index compaction items' },
    ]);
    expect((await compactionIndex())?.valid).toBe(true);
    // The items stored before the upgrade are found through the new index.
    const context = await store.context(id, { model: MODEL });
    expect(context).toMatchObject({ kind: 'items', version: 5 });
    expect(context.kind === 'items' && context.items.map((item) => item.id)).toEqual([
      latest.id,
      `itm_${counter}`,
    ]);
  });

  it('serves the lookup in a conversation of thousands of items', async () => {
    await migrate({ pool: schema.pool, parts: ['conversations'] });
    const store = postgresConversations({ pool: schema.pool });
    const id = await store.create(OWNER);
    // 3,000 items, every 50th a compaction item, written in one statement rather than 60 appends.
    await schema.pool.query(
      `insert into ${ITEMS_TABLE} (conversation_id, seq, item_id, type, item)
       select $1, s, 'itm_' || s, case when s % 50 = 0 then 'native' else 'message' end,
         case when s % 50 = 0
           then jsonb_build_object('id', 'itm_' || s, 'type', 'native', 'provider', 'openai',
             'family', 'gpt-x', 'kind', 'compaction', 'data', jsonb_build_object('type', 'compaction'))
           else jsonb_build_object('id', 'itm_' || s, 'type', 'message', 'role', 'user',
             'parts', jsonb_build_array(jsonb_build_object('type', 'text', 'text', repeat('lorem ', 50))))
         end
       from generate_series(1, 3000) s`,
      [id],
    );
    await schema.pool.query('update askdare_conversations set version = 3000 where id = $1', [id]);
    await schema.pool.query(`analyze ${ITEMS_TABLE}`);

    // With a matching model, another family, and no model at all: never a scan of every item.
    for (const [provider, family] of [
      ['openai', 'gpt-x'],
      ['openai', 'gpt-y'],
      [null, null],
    ] as const) {
      expect(await plan(id, provider, family)).toContain(`"Index Name":"${COMPACTION_INDEX}"`);
    }
    const context = await store.context(id, { model: MODEL });
    expect(context.kind === 'items' && context.items[0]?.id).toBe('itm_3000');
  });

  it('keeps an index an operator built beforehand with create index concurrently', async () => {
    await migrateParts(schema.pool, [CONVERSATIONS_V1]);
    await schema.pool.query(
      `create index concurrently ${COMPACTION_INDEX}
         on ${ITEMS_TABLE} (conversation_id, (item->>'provider'), (item->>'family'), seq)
         where type = 'native' and item->>'kind' = 'compaction'`,
    );
    const before = await schema.pool.query('select to_regclass($1)::oid as oid', [
      COMPACTION_INDEX,
    ]);
    await migrate({ pool: schema.pool, parts: ['conversations'] });
    const after = await schema.pool.query('select to_regclass($1)::oid as oid', [COMPACTION_INDEX]);
    expect(after.rows[0]?.oid).toBe(before.rows[0]?.oid);
    expect((await compactionIndex())?.valid).toBe(true);
  });

  it('rebuilds an index that a failed concurrent build left invalid', async () => {
    await migrateParts(schema.pool, [CONVERSATIONS_V1]);
    const store = postgresConversations({ pool: schema.pool });
    const id = await store.create(OWNER);
    await store.append(id, [user('one'), user('two')]);
    // A unique index over duplicates fails after its catalog entry exists, and leaves it invalid.
    await expect(
      schema.pool.query(
        `create unique index concurrently ${COMPACTION_INDEX} on ${ITEMS_TABLE} (type)`,
      ),
    ).rejects.toThrow();
    expect((await compactionIndex())?.valid).toBe(false);

    await migrate({ pool: schema.pool, parts: ['conversations'] });
    const index = await compactionIndex();
    expect(index?.valid).toBe(true);
    expect(index?.definition).toContain("WHERE ((type = 'native'::text)");
  });
});
