import { Pool } from 'pg';
import type { PostgresConnectionOptions, PostgresPool } from './connection';

/** Bounds the wait for a connection, so a database that is down fails the request. */
const CONNECT_TIMEOUT_MS = 10_000;

/** Where the connection string comes from: the option, else `DATABASE_URL`. */
export function connectionString(options: PostgresConnectionOptions): string {
  const url = options.url ?? process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('[askdare-postgres] Set DATABASE_URL, or pass url or pool.');
  }
  return url;
}

/** A new pool for a connection string. Whoever creates it ends it. */
export function createPool(url: string, max?: number): Pool {
  const pool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    ...(max === undefined ? {} : { max }),
  });
  // Without a listener, an idle connection that drops (a database restart, a proxy timeout)
  // would crash the process. The pool replaces it on the next checkout.
  pool.on('error', (error) => {
    console.error(`[askdare-postgres] An idle connection failed: ${error.message}`);
  });
  return pool;
}

const shared = new Map<string, Pool>();

/**
 * The pool for these options. Pools made from a connection string are shared per string, so the
 * conversation store and the knowledge index on one `DATABASE_URL` use one pool per instance.
 */
export function resolvePool(options: PostgresConnectionOptions): PostgresPool {
  if (options.pool) return options.pool;
  const url = connectionString(options);
  let pool = shared.get(url);
  if (!pool) {
    pool = createPool(url);
    shared.set(url, pool);
  }
  return pool;
}
