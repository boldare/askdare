export type {
  PostgresConnectionOptions,
  PostgresPool,
  PostgresPoolClient,
  PostgresQueryResult,
} from './connection';
export {
  type PgvectorIndexOptions,
  pgvectorIndex,
} from './knowledge/pgvector-index';
export {
  type AppliedMigration,
  type MigrateOptions,
  type MigrateReport,
  migrate,
} from './schema/migrate';
