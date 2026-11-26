import { type PostgresPool, queryRows } from '../connection';
import { latestVersion, type SchemaPart } from './migration';
import { VERSION_TABLE } from './version-table';

/**
 * How a part's schema in the database compares with the code. The stores' `diagnose()` reports
 * it, so `doctor` can say "run migrate" (ADR-0024, decision 9).
 */
export interface SchemaStatus {
  readonly part: string;
  /** The database's version; 0 when `migrate` never ran for this part. */
  readonly current: number;
  /** The version this package expects. */
  readonly latest: number;
  /** `behind`: run `migrate`. `ahead`: the database was migrated by a newer package. */
  readonly state: 'current' | 'behind' | 'ahead';
}

/** Reads a part's version. Never changes the database, so it is safe at request time. */
export async function schemaStatus(
  db: Pick<PostgresPool, 'query'>,
  part: SchemaPart,
): Promise<SchemaStatus> {
  const [table] = await queryRows<{ exists: boolean }>(
    db,
    'select to_regclass($1) is not null as exists',
    [VERSION_TABLE],
  );
  let current = 0;
  if (table?.exists) {
    const [row] = await queryRows<{ version: number | null }>(
      db,
      `select max(version)::int as version from ${VERSION_TABLE} where part = $1`,
      [part.name],
    );
    current = row?.version ?? 0;
  }
  const latest = latestVersion(part);
  const state = current === latest ? 'current' : current < latest ? 'behind' : 'ahead';
  return { part: part.name, current, latest, state };
}
