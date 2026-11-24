import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';

/**
 * The database the Postgres tests run against: the CI service, or the docker-compose.yml next to
 * package.json. Without it the tests skip locally; in CI they must run.
 */
export const TEST_DATABASE_URL: string | undefined = process.env['ASKDARE_POSTGRES_TEST_URL'];

if (!TEST_DATABASE_URL && process.env['CI']) {
  throw new Error('ASKDARE_POSTGRES_TEST_URL is not set; CI must run the Postgres tests.');
}

/** A schema of the test database that only one test uses, dropped by `drop()`. */
export interface TestSchema {
  readonly name: string;
  /** A connection string whose `search_path` is the schema. */
  readonly url: string;
  /** A pool on `url`. */
  readonly pool: Pool;
  drop(): Promise<void>;
}

/** Creates an empty schema, so tests can run in parallel and leave nothing behind. */
export async function createTestSchema(): Promise<TestSchema> {
  if (!TEST_DATABASE_URL) throw new Error('ASKDARE_POSTGRES_TEST_URL is not set.');
  const name = `askdare_test_${randomBytes(6).toString('hex')}`;
  const admin = new Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  await admin.query(`create schema ${name}`);
  const url = new URL(TEST_DATABASE_URL);
  // Extensions such as pgvector live in public, so it stays on the path.
  url.searchParams.set('options', `-c search_path=${name},public`);
  const pool = new Pool({ connectionString: url.toString() });
  return {
    name,
    url: url.toString(),
    pool,
    async drop() {
      await pool.end();
      await admin.query(`drop schema if exists ${name} cascade`);
      await admin.end();
    },
  };
}
