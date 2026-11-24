import type { SchemaPart } from '../schema/migration';

/** The tables of the knowledge index. Every row carries its index ID: one database, many bots. */
export const INDEXES_TABLE = 'askdare_knowledge_indexes';
export const DOCUMENTS_TABLE = 'askdare_knowledge_documents';
export const CHUNKS_TABLE = 'askdare_knowledge_chunks';

/**
 * The knowledge index's schema (ADR-0025). The embedding column has no fixed size, so one table
 * holds indexes built with embedders of any dimensions; each index gets its own HNSW index, made
 * by its first sync for the size its embedder has (see `pgvector-index.ts`).
 *
 * Full text uses the language-neutral `simple` configuration over the section and the text.
 */
export const KNOWLEDGE_SCHEMA: SchemaPart = {
  name: 'knowledge',
  migrations: [
    {
      version: 1,
      name: 'create the knowledge index',
      sql: `
create extension if not exists vector;

create table ${INDEXES_TABLE} (
  index_id    text primary key,
  embedder    text not null,
  dimensions  integer not null check (dimensions > 0),
  synced_at   timestamptz not null default now()
);

create table ${DOCUMENTS_TABLE} (
  index_id  text not null references ${INDEXES_TABLE} on delete cascade,
  path      text not null,
  sha256    text not null,
  title     text not null,
  url       text,
  primary key (index_id, path)
);

create table ${CHUNKS_TABLE} (
  index_id   text not null,
  path       text not null,
  ordinal    integer not null,
  source_id  text not null,
  sha256     text not null,
  section    text,
  text       text not null,
  embedding  vector not null,
  tsv        tsvector generated always as (to_tsvector('simple', coalesce(section, '') || ' ' || text)) stored,
  primary key (index_id, path, ordinal),
  foreign key (index_id, path) references ${DOCUMENTS_TABLE} on delete cascade
);

create index ${CHUNKS_TABLE}_source on ${CHUNKS_TABLE} (index_id, source_id);
create index ${CHUNKS_TABLE}_sha256 on ${CHUNKS_TABLE} (index_id, sha256);
create index ${CHUNKS_TABLE}_tsv on ${CHUNKS_TABLE} using gin (tsv);
`,
    },
  ],
};
