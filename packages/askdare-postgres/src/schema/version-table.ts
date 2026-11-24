/** The table that records which migrations ran, one row per part and version. */
export const VERSION_TABLE = 'askdare_schema_migrations';

export const CREATE_VERSION_TABLE: string = `
create table if not exists ${VERSION_TABLE} (
  part        text not null,
  version     integer not null check (version > 0),
  name        text not null,
  applied_at  timestamptz not null default now(),
  primary key (part, version)
)`;

/** The highest recorded version per part. */
export const SELECT_VERSIONS: string = `select part, max(version)::int as version from ${VERSION_TABLE} group by part`;
