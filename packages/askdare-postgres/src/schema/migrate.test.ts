import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostgresPool } from '../connection';
import { migrate } from '../index';
import { createTestSchema, TEST_DATABASE_URL, type TestSchema } from '../testing/database';
import { migrateParts } from './migrate';
import { type SchemaPart, validateParts } from './migration';
import { SCHEMA_PARTS } from './parts';
import { schemaStatus } from './status';

// A pool from pg is a PostgresPool: this line fails to compile if the interface drifts from pg.
const _fromPg: (pool: Pool) => PostgresPool = (pool) => pool;

const notes: SchemaPart = {
  name: 'notes',
  migrations: [
    { version: 1, name: 'create notes', sql: 'create table notes (id int primary key)' },
    {
      version: 2,
      name: 'add text',
      sql: "alter table notes add column text text not null default ''; create index notes_text on notes (text)",
    },
  ],
};
const notesV1: SchemaPart = { name: 'notes', migrations: notes.migrations.slice(0, 1) };
const tags: SchemaPart = {
  name: 'tags',
  migrations: [{ version: 1, name: 'create tags', sql: 'create table tags (id int primary key)' }],
};

describe('validateParts', () => {
  it('accepts the parts this package ships', () => {
    expect(() => validateParts(SCHEMA_PARTS)).not.toThrow();
  });

  it('rejects a part listed twice', () => {
    expect(() => validateParts([notes, notesV1])).toThrow('"notes" is listed twice');
  });

  it('rejects versions that are not 1, 2, 3… in order', () => {
    const gap = { name: 'gap', migrations: [{ version: 2, name: 'two', sql: 'select 1' }] };
    expect(() => validateParts([gap])).toThrow('Migration 1 of "gap" has version 2');
  });

  it('rejects a part name that is not a plain identifier', () => {
    expect(() => validateParts([{ name: 'Notes; drop', migrations: [] }])).toThrow(
      'Invalid schema part name',
    );
  });
});

describe('migrate without a database', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('asks for DATABASE_URL when given neither url nor pool', async () => {
    vi.stubEnv('DATABASE_URL', '');
    await expect(migrate()).rejects.toThrow('Set DATABASE_URL, or pass url or pool.');
  });
});

describe.skipIf(!TEST_DATABASE_URL)('migrate against Postgres', () => {
  let schema: TestSchema;

  beforeEach(async () => {
    schema = await createTestSchema();
  });

  afterEach(async () => {
    await schema.drop();
  });

  const tables = async (): Promise<string[]> => {
    const result = await schema.pool.query<{ table_name: string }>(
      'select table_name from information_schema.tables where table_schema = $1 order by 1',
      [schema.name],
    );
    return result.rows.map((row) => row.table_name);
  };

  const recorded = async (): Promise<{ part: string; version: number; name: string }[]> => {
    const result = await schema.pool.query(
      'select part, version, name from askdare_schema_migrations order by part, version',
    );
    return result.rows;
  };

  it('runs on a database with pgvector, which the knowledge index needs', async () => {
    const result = await schema.pool.query(
      "select 1 from pg_available_extensions where name = 'vector'",
    );
    expect(result.rowCount).toBe(1);
  });

  it('creates the schema-version table, and a second run changes nothing', async () => {
    const first = await migrate({ url: schema.url });
    expect(first).toEqual({ applied: [], versions: {} });
    expect(await tables()).toEqual(['askdare_schema_migrations']);

    const second = await migrate({ url: schema.url });
    expect(second).toEqual({ applied: [], versions: {} });
    expect(await tables()).toEqual(['askdare_schema_migrations']);
  });

  it('applies every migration in order, once', async () => {
    const report = await migrateParts(schema.pool, [notes, tags]);
    expect(report).toEqual({
      applied: [
        { part: 'notes', version: 1, name: 'create notes' },
        { part: 'notes', version: 2, name: 'add text' },
        { part: 'tags', version: 1, name: 'create tags' },
      ],
      versions: { notes: 2, tags: 1 },
    });
    expect(await tables()).toEqual(['askdare_schema_migrations', 'notes', 'tags']);
    expect(await recorded()).toEqual([
      { part: 'notes', version: 1, name: 'create notes' },
      { part: 'notes', version: 2, name: 'add text' },
      { part: 'tags', version: 1, name: 'create tags' },
    ]);

    const again = await migrateParts(schema.pool, [notes, tags]);
    expect(again).toEqual({ applied: [], versions: { notes: 2, tags: 1 } });
    expect(await recorded()).toHaveLength(3);
  });

  it('upgrades a part from the version the database has', async () => {
    await migrateParts(schema.pool, [notesV1]);
    const report = await migrateParts(schema.pool, [notes, tags]);
    expect(report.applied).toEqual([
      { part: 'notes', version: 2, name: 'add text' },
      { part: 'tags', version: 1, name: 'create tags' },
    ]);
    await schema.pool.query("insert into notes (id, text) values (1, 'hello')");
  });

  it('rolls back a failed migration and keeps the previous version', async () => {
    const broken: SchemaPart = {
      name: 'notes',
      migrations: [
        ...notesV1.migrations,
        {
          version: 2,
          name: 'half done',
          sql: 'create table notes_extra (id int); select * from no_such_table',
        },
      ],
    };
    await expect(migrateParts(schema.pool, [broken])).rejects.toThrow(
      'Migration 2 of "notes" (half done) failed: relation "no_such_table" does not exist',
    );
    expect(await tables()).toEqual(['askdare_schema_migrations', 'notes']);
    expect(await recorded()).toEqual([{ part: 'notes', version: 1, name: 'create notes' }]);

    // Fixed in the next release of the code, the migration goes through.
    const report = await migrateParts(schema.pool, [notes]);
    expect(report.versions).toEqual({ notes: 2 });
  });

  it('refuses a database migrated by a newer package, before changing anything', async () => {
    await migrateParts(schema.pool, [notes]);
    await expect(migrateParts(schema.pool, [tags, notesV1])).rejects.toThrow(
      'The database has version 2 of the "notes" schema; this version of @boldare/askdare-postgres knows up to 1.',
    );
    expect(await tables()).toEqual(['askdare_schema_migrations', 'notes']);
  });

  it('runs each migration once when several instances migrate at the same time', async () => {
    const pools = Array.from({ length: 4 }, () => new Pool({ connectionString: schema.url }));
    try {
      const reports = await Promise.all(pools.map((pool) => migrateParts(pool, [notes, tags])));
      expect(reports.flatMap((report) => report.applied)).toHaveLength(3);
      expect(await recorded()).toHaveLength(3);
    } finally {
      await Promise.all(pools.map((pool) => pool.end()));
    }
  });

  it("leaves the app's own pool open, with its connection settings as they were", async () => {
    const pool = new Pool({ connectionString: schema.url, max: 1 });
    try {
      await migrate({ pool });
      const result = await pool.query<{ lock_timeout: string }>('show lock_timeout');
      expect(result.rows[0]?.lock_timeout).toBe('0');
      const locks = await pool.query(
        "select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()",
      );
      expect(locks.rowCount).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it('reports each part as behind, current or ahead', async () => {
    expect(await schemaStatus(schema.pool, notes)).toEqual({
      part: 'notes',
      current: 0,
      latest: 2,
      state: 'behind',
    });
    await migrateParts(schema.pool, [notesV1]);
    expect(await schemaStatus(schema.pool, notes)).toMatchObject({ current: 1, state: 'behind' });
    await migrateParts(schema.pool, [notes]);
    expect(await schemaStatus(schema.pool, notes)).toMatchObject({ current: 2, state: 'current' });
    expect(await schemaStatus(schema.pool, notesV1)).toMatchObject({ current: 2, state: 'ahead' });
    expect(await schemaStatus(schema.pool, tags)).toMatchObject({ current: 0, state: 'behind' });
  });
});
