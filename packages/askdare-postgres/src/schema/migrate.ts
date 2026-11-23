import { type PostgresConnectionOptions, type PostgresPool, queryRows } from '../connection';
import { connectionString, createPool } from '../pool';
import { latestVersion, type SchemaPart, validateParts } from './migration';
import { SCHEMA_PARTS } from './parts';
import { CREATE_VERSION_TABLE, SELECT_VERSIONS, VERSION_TABLE } from './version-table';

/** A migration that `migrate` ran. */
export interface AppliedMigration {
  readonly part: string;
  readonly version: number;
  readonly name: string;
}

/** What `migrate` did. */
export interface MigrateReport {
  /** The migrations it ran, in order. Empty when the schema was up to date. */
  readonly applied: readonly AppliedMigration[];
  /** Each part's schema version afterwards. */
  readonly versions: Readonly<Record<string, number>>;
}

/** Serialises concurrent `migrate` runs on one database ("askdare" as an int8). */
const LOCK_KEY = '27429977823736421';

/**
 * How long a migration waits for a lock: for another `migrate` to finish, or for the app's
 * queries on a table it alters. A migration queued behind a lock would block those queries too.
 */
const LOCK_TIMEOUT = '60s';

/**
 * Creates the schema, or upgrades it to this version of the package. Idempotent: run it on every
 * deployment, before the new code serves requests (a release phase or a build step), or once by
 * hand with `npx askdare-postgres migrate`. askdare never migrates at request time.
 *
 * Concurrent runs on one database wait for each other. Each migration runs in a transaction with
 * the record of its version, so a failed one leaves the previous version in place.
 *
 * ```ts
 * import { migrate } from '@boldare/askdare-postgres';
 * await migrate(); // DATABASE_URL, or { url } or { pool }
 * ```
 */
export async function migrate(options: PostgresConnectionOptions = {}): Promise<MigrateReport> {
  if (options.pool) return migrateParts(options.pool, SCHEMA_PARTS);
  // A pool of its own, ended afterwards, so a script that migrates can exit.
  const pool = createPool(connectionString(options), 1);
  try {
    return await migrateParts(pool, SCHEMA_PARTS);
  } finally {
    await pool.end();
  }
}

/** `migrate` for the given parts; the tests pass their own. */
export async function migrateParts(
  pool: PostgresPool,
  parts: readonly SchemaPart[],
): Promise<MigrateReport> {
  validateParts(parts);
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query(`set lock_timeout = '${LOCK_TIMEOUT}'`);
    await client.query('select pg_advisory_lock($1::bigint)', [LOCK_KEY]);
    try {
      await client.query(CREATE_VERSION_TABLE);
      const rows = await queryRows<{ part: string; version: number }>(client, SELECT_VERSIONS);
      const versions: Record<string, number> = {};
      for (const row of rows) versions[row.part] = row.version;

      // Refuse before changing anything when the database is ahead of this code.
      for (const part of parts) {
        const current = versions[part.name] ?? 0;
        if (current > latestVersion(part)) {
          throw new Error(
            `[askdare-postgres] The database has version ${current} of the "${part.name}" schema; this version of @boldare/askdare-postgres knows up to ${latestVersion(part)}. Upgrade the package.`,
          );
        }
      }

      const applied: AppliedMigration[] = [];
      for (const part of parts) {
        const current = versions[part.name] ?? 0;
        for (const migration of part.migrations.slice(current)) {
          await client.query('begin');
          try {
            await client.query(migration.sql);
            await client.query(
              `insert into ${VERSION_TABLE} (part, version, name) values ($1, $2, $3)`,
              [part.name, migration.version, migration.name],
            );
            await client.query('commit');
          } catch (error) {
            await client.query('rollback');
            throw new Error(
              `[askdare-postgres] Migration ${migration.version} of "${part.name}" (${migration.name}) failed: ${error instanceof Error ? error.message : String(error)}`,
              { cause: error },
            );
          }
          applied.push({ part: part.name, version: migration.version, name: migration.name });
          versions[part.name] = migration.version;
        }
      }
      return { applied, versions };
    } finally {
      await client.query('select pg_advisory_unlock($1::bigint)', [LOCK_KEY]);
    }
  } catch (error) {
    broken = true;
    throw error;
  } finally {
    if (!broken) {
      try {
        await client.query('reset lock_timeout');
      } catch {
        broken = true;
      }
    }
    // After a failure the session may still hold the lock or the setting: close it rather than
    // hand it back to the app's pool.
    client.release(broken);
  }
}
