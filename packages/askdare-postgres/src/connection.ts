/** What a query answers, as far as this package reads it. */
export interface PostgresQueryResult {
  readonly rows: readonly unknown[];
  readonly rowCount: number | null;
}

/** A connection checked out of a pool. A `pg` `PoolClient` is one. */
export interface PostgresPoolClient {
  query(text: string, values?: readonly unknown[]): Promise<PostgresQueryResult>;
  /** Returns the connection to the pool; `true` closes it instead. */
  release(destroy?: boolean): void;
}

/**
 * The subset of a `pg` `Pool` this package uses. Pass a `new Pool()` from `pg`, or any pool with
 * the same methods (such as `@neondatabase/serverless`).
 */
export interface PostgresPool {
  query(text: string, values?: readonly unknown[]): Promise<PostgresQueryResult>;
  connect(): Promise<PostgresPoolClient>;
}

/**
 * Where the database is: a connection string, or a pool the app already has. With neither, the
 * `DATABASE_URL` environment variable.
 */
export type PostgresConnectionOptions =
  | {
      /** A connection string, such as `postgres://host:5432/db?sslmode=require`; the user and password go in the URL or in `PGUSER` and `PGPASSWORD`. */
      readonly url?: string;
      readonly pool?: undefined;
    }
  | {
      /** An existing pool. The app keeps owning it: askdare never ends it. */
      readonly pool: PostgresPool;
      readonly url?: undefined;
    };

/** Runs a query and returns its rows typed as the caller's SQL selects them. */
export async function queryRows<Row>(
  db: Pick<PostgresPool, 'query'>,
  text: string,
  values?: readonly unknown[],
): Promise<Row[]> {
  const result = await db.query(text, values);
  // The rows are the columns the SQL above names; the database, not a client, produced them.
  return result.rows as Row[];
}
