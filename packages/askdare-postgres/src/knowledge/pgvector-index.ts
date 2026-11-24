import { createHash } from 'node:crypto';
// k1's knowledge code is internal to @boldare/askdare until task k2 exports the port. Until then
// the types are inlined into this package's .d.ts and the two helpers are bundled into its dist:
// the same code, so every index checks and embeds documents the same way.
import { checkKnowledgeDocuments, embeddingInput } from '../../../askdare/src/knowledge/document';
import type {
  Embedder,
  KnowledgeCallOptions,
  KnowledgeCheck,
  KnowledgeDocument,
  KnowledgeIndex,
  Passage,
  SearchOptions,
  SyncReport,
} from '../../../askdare/src/knowledge/port';
import {
  type PostgresConnectionOptions,
  type PostgresPool,
  type PostgresPoolClient,
  queryRows,
} from '../connection';
import { resolvePool } from '../pool';
import { schemaStatus } from '../schema/status';
import { CHUNKS_TABLE, DOCUMENTS_TABLE, INDEXES_TABLE, KNOWLEDGE_SCHEMA } from './schema';

export type PgvectorIndexOptions = PostgresConnectionOptions & {
  /** Turns chunks and queries into vectors. Its ID is stored with the index. */
  readonly embedder: Embedder;
  /**
   * Which index of the database this is; one database holds many bots' indexes. Letters, digits,
   * `.`, `_`, `:` and `-`, at most 128 characters. Default `default`.
   */
  readonly indexId?: string;
};

/** ADR-0025, decision 4: the full-text ranking counts 0.3 of the vector ranking in the fusion. */
const TEXT_WEIGHT = 0.3;
/** Reciprocal rank fusion's constant, as is usual (and as S8 measured). */
const RRF_K = 60;
/** Candidates each side contributes to the fusion, at least. */
const CANDIDATES = 20;
/** Words of a query the full-text side looks for, at most. */
const MAX_QUERY_WORDS = 32;
/** Results of one search, at most: far more than a model's context wants. */
const MAX_RESULTS = 1_000;
const EMBED_BATCH = 256;
/** pgvector's limits: `vector` holds up to 16,000 dimensions, HNSW indexes 2,000 (`halfvec` 4,000). */
const MAX_DIMENSIONS = 16_000;
const MAX_HNSW_VECTOR = 2_000;
const MAX_HNSW_HALFVEC = 4_000;

const INDEX_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SOURCE_ID = /^k[0-9a-f]{12}$/;

const PREFIX = '[askdare-postgres]';

interface IndexRow {
  readonly embedder: string;
  readonly dimensions: number;
}

interface PassageRow {
  readonly source_id: string;
  readonly path: string;
  readonly title: string;
  readonly url: string | null;
  readonly section: string | null;
  readonly text: string;
  readonly score?: number;
}

function toPassage(row: PassageRow): Passage {
  const passage = {
    sourceId: row.source_id,
    path: row.path,
    title: row.title,
    url: row.url ?? undefined,
    section: row.section ?? undefined,
    text: row.text,
  };
  return row.score === undefined ? passage : { ...passage, score: row.score };
}

/**
 * The words the full-text side looks for, as an OR query in `to_tsquery` syntax. Each word is
 * quoted and contains only letters, digits, `_` and `-`, so the query can't be malformed.
 */
export function fullTextQuery(text: string): string {
  const words = text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu) ?? [];
  return [...new Set(words)]
    .slice(0, MAX_QUERY_WORDS)
    .map((word) => `'${word}'`)
    .join(' | ');
}

/** pgvector's text form of a vector. Throws on a vector the embedder shouldn't have returned. */
function vectorLiteral(vector: readonly number[], dimensions: number, embedder: Embedder): string {
  if (vector.length !== dimensions || !vector.every(Number.isFinite)) {
    throw new Error(
      `${PREFIX} The embedder ${embedder.id} returned a vector that isn't ${dimensions} finite numbers.`,
    );
  }
  return `[${vector.join(',')}]`;
}

/**
 * The vector expression an index of `dimensions` is searched by, and its HNSW operator class.
 * Each index has its own partial HNSW index over this expression, so the column needs no fixed
 * size and a search never loses results to another bot's rows. Above 4,000 dimensions pgvector
 * can't build HNSW, and search is exact.
 */
export function vectorExpression(dimensions: number): {
  readonly column: string;
  readonly query: string;
  /** Part of the HNSW index's predicate, so a row of another size is never cast. */
  readonly predicate: string;
  readonly opclass?: string;
} {
  const predicate = `vector_dims(embedding) = ${dimensions}`;
  if (dimensions <= MAX_HNSW_VECTOR) {
    return {
      column: `(embedding::vector(${dimensions}))`,
      query: `$2::vector(${dimensions})`,
      predicate,
      opclass: 'vector_cosine_ops',
    };
  }
  if (dimensions <= MAX_HNSW_HALFVEC) {
    return {
      column: `(embedding::halfvec(${dimensions}))`,
      query: `$2::halfvec(${dimensions})`,
      predicate,
      opclass: 'halfvec_cosine_ops',
    };
  }
  return { column: 'embedding', query: '$2::vector', predicate };
}

/** The name of an index's HNSW index: a hash of its ID, so any valid ID fits in 63 bytes. */
export function hnswIndexName(indexId: string, dimensions: number): string {
  const hash = createHash('sha256').update(indexId).digest('hex').slice(0, 16);
  return `${CHUNKS_TABLE}_hnsw_${hash}_${dimensions}`;
}

/** Hybrid search: vector and full-text candidates, fused by reciprocal rank (ADR-0025, decision 4). */
function searchSql(dimensions: number, fullText: boolean): string {
  const vector = vectorExpression(dimensions);
  const fts = fullText
    ? `,
  fts_rows as (
    select source_id, ts_rank_cd(tsv, to_tsquery('simple', $5)) as rank
    from ${CHUNKS_TABLE}
    where index_id = $1 and tsv @@ to_tsquery('simple', $5)
    order by rank desc
    limit $4
  ),
  fts as (
    select source_id, row_number() over (order by max(rank) desc) as r
    from fts_rows group by source_id
  )`
    : '';
  const ranked = fullText
    ? 'select source_id, r, 1.0::float8 as weight from vec union all select source_id, r, $6::float8 from fts'
    : 'select source_id, r, 1.0::float8 as weight from vec';
  // The same chunk in two documents is one result, shown from the first path (as passage() does).
  return `
with
  vec_rows as (
    select source_id, ${vector.column} <=> ${vector.query} as distance
    from ${CHUNKS_TABLE}
    where index_id = $1 and ${vector.predicate}
    order by ${vector.column} <=> ${vector.query}
    limit $4
  ),
  vec as (
    select source_id, row_number() over (order by min(distance)) as r
    from vec_rows group by source_id
  )${fts},
  fused as (
    select source_id, sum(weight / (${RRF_K} + r))::float8 as score
    from (${ranked}) ranked
    group by source_id
  )
select f.source_id, p.path, p.title, p.url, p.section, p.text, f.score
from fused f
cross join lateral (
  select c.path, c.ordinal, d.title, d.url, c.section, c.text
  from ${CHUNKS_TABLE} c
  join ${DOCUMENTS_TABLE} d on d.index_id = c.index_id and d.path = c.path
  where c.index_id = $1 and c.source_id = f.source_id
  order by c.path collate "C", c.ordinal
  limit 1
) p
order by f.score desc, p.path collate "C", p.ordinal
limit $3`;
}

const PASSAGE_SQL = `
select c.source_id, c.path, d.title, d.url, c.section, c.text
from ${CHUNKS_TABLE} c
join ${DOCUMENTS_TABLE} d on d.index_id = c.index_id and d.path = c.path
where c.index_id = $1 and c.source_id = $2
order by c.path collate "C", c.ordinal
limit 1`;

const INSERT_CHUNKS_SQL = `
insert into ${CHUNKS_TABLE} (index_id, path, ordinal, source_id, sha256, section, text, embedding)
select $1, $2, c.ordinal, c.source_id, c.sha256, c.section, c.text, c.embedding::vector
from unnest($3::int[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[])
  as c(ordinal, source_id, sha256, section, text, embedding)`;

/** Postgres' "undefined table": `migrate` never ran for the knowledge part. */
function missingSchema(error: unknown): Error | undefined {
  if (error instanceof Error && (error as Error & { code?: unknown }).code === '42P01') {
    return new Error(
      `${PREFIX} The knowledge index's tables are missing: run \`npx askdare-postgres migrate\`.`,
      { cause: error },
    );
  }
  return undefined;
}

async function withSchemaHint<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw missingSchema(error) ?? error;
  }
}

async function transaction(client: PostgresPoolClient, body: () => Promise<void>): Promise<void> {
  await client.query('begin');
  try {
    await body();
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
}

/**
 * A knowledge index in the site's own Postgres with pgvector (ADR-0025): hybrid search, sources
 * resolved with one indexed lookup, incremental sync. Create the tables first with `migrate`.
 *
 * ```ts
 * import { openaiEmbedder } from '@boldare/askdare';
 * import { pgvectorIndex } from '@boldare/askdare-postgres';
 *
 * const index = pgvectorIndex({
 *   embedder: openaiEmbedder({ model: '<embedding model>', dimensions: 1536 }),
 * }); // DATABASE_URL; or { url } or { pool }
 * ```
 *
 * `sync` runs from `askdare kb sync`, not at request time. Its first run for an index creates the
 * index's HNSW index, so it needs the database user that owns the tables (the one that migrates).
 */
export function pgvectorIndex(options: PgvectorIndexOptions): KnowledgeIndex {
  const { embedder } = options;
  const indexId = options.indexId ?? 'default';
  if (!INDEX_ID.test(indexId)) {
    throw new Error(
      `${PREFIX} Invalid indexId: use letters, digits, ".", "_", ":" or "-", at most 128 characters.`,
    );
  }
  const { dimensions } = embedder;
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > MAX_DIMENSIONS) {
    throw new Error(
      `${PREFIX} The embedder's dimensions must be a whole number from 1 to ${MAX_DIMENSIONS}.`,
    );
  }
  // Resolved on first use, so a module can create the index before DATABASE_URL is set (a build).
  let pool: PostgresPool | undefined;
  const db = (): PostgresPool => {
    pool ??= resolvePool(options);
    return pool;
  };

  const readIndex = async (client: Pick<PostgresPool, 'query'>): Promise<IndexRow | undefined> => {
    const [row] = await queryRows<IndexRow>(
      client,
      `select embedder, dimensions from ${INDEXES_TABLE} where index_id = $1`,
      [indexId],
    );
    return row;
  };

  /**
   * Gives the index the HNSW index for its embedder's size, and drops any for another size, which
   * stay empty. Only reads when the index is as it should be; otherwise DDL, which only the
   * tables' owner may run.
   */
  const ensureHnsw = async (client: PostgresPoolClient): Promise<void> => {
    const { column, opclass, predicate } = vectorExpression(dimensions);
    const name = hnswIndexName(indexId, dimensions);
    const prefix = hnswIndexName(indexId, 0).slice(0, -1);
    const existing = await queryRows<{ name: string }>(
      client,
      `select c.relname as name from pg_index i join pg_class c on c.oid = i.indexrelid
       where i.indrelid = to_regclass($1) and starts_with(c.relname, $2)`,
      [CHUNKS_TABLE, prefix],
    );
    for (const { name: stale } of existing) {
      if (stale === name || !/^[a-z0-9_]+$/.test(stale)) continue;
      await client.query(`drop index ${stale}`);
    }
    if (opclass === undefined || existing.some((index) => index.name === name)) return;
    // DDL takes no parameters: the ID is checked against INDEX_ID (no quotes) and quoted anyway.
    const literal = `'${indexId.replaceAll("'", "''")}'`;
    await client.query(
      `create index if not exists ${name} on ${CHUNKS_TABLE} using hnsw (${column} ${opclass}) where index_id = ${literal} and ${predicate}`,
    );
  };

  const ensureHnswAsOwner = async (client: PostgresPoolClient): Promise<void> => {
    try {
      await ensureHnsw(client);
    } catch (error) {
      // Postgres' "insufficient privilege": only the tables' owner may create an index.
      if (!(error instanceof Error) || (error as Error & { code?: unknown }).code !== '42501') {
        throw error;
      }
      throw new Error(
        `${PREFIX} The first sync of an index creates its vector index, which only the owner of the askdare tables may: sync as the database user that runs \`migrate\`.`,
        { cause: error },
      );
    }
  };

  const embedAll = async (
    inputs: readonly string[],
    call: KnowledgeCallOptions,
  ): Promise<{ vectors: string[]; tokens: number }> => {
    const vectors: string[] = [];
    let tokens = 0;
    for (let start = 0; start < inputs.length; start += EMBED_BATCH) {
      call.signal?.throwIfAborted();
      const batch = inputs.slice(start, start + EMBED_BATCH);
      const result = await embedder.embed(batch, call);
      if (result.vectors.length !== batch.length) {
        throw new Error(
          `${PREFIX} The embedder ${embedder.id} returned ${result.vectors.length} vectors for ${batch.length} texts.`,
        );
      }
      for (const vector of result.vectors) {
        vectors.push(vectorLiteral(vector, dimensions, embedder));
      }
      tokens += result.tokens;
    }
    return { vectors, tokens };
  };

  const syncLocked = async (
    client: PostgresPoolClient,
    documents: readonly KnowledgeDocument[],
    call: KnowledgeCallOptions,
  ): Promise<SyncReport> => {
    const stored = await readIndex(client);
    // A different embedder makes every stored vector useless: the index starts over.
    const restart =
      stored !== undefined && (stored.embedder !== embedder.id || stored.dimensions !== dimensions);
    const remote = new Map(
      (
        await queryRows<{ path: string; sha256: string; title: string; url: string | null }>(
          client,
          `select path, sha256, title, url from ${DOCUMENTS_TABLE} where index_id = $1`,
          [indexId],
        )
      ).map((row) => [row.path, row]),
    );

    const added: string[] = [];
    const changed: string[] = [];
    const todo: KnowledgeDocument[] = [];
    let unchanged = 0;
    for (const document of documents) {
      const existing = remote.get(document.path);
      remote.delete(document.path);
      if (existing === undefined || restart) {
        added.push(document.path);
        todo.push(document);
      } else if (
        existing.sha256 !== document.sha256 ||
        existing.title !== document.title ||
        (existing.url ?? undefined) !== document.url
      ) {
        changed.push(document.path);
        todo.push(document);
      } else unchanged += 1;
    }
    const removed = [...remote.keys()];

    // Embeddings the index already has, by chunk hash; then the chunks it doesn't.
    const vectors = new Map<string, string>();
    const hashes = [...new Set(todo.flatMap((d) => d.chunks.map((chunk) => chunk.sha256)))];
    if (!restart && hashes.length > 0) {
      const rows = await queryRows<{ sha256: string; embedding: string }>(
        client,
        `select distinct on (sha256) sha256, embedding::text as embedding
         from ${CHUNKS_TABLE} where index_id = $1 and sha256 = any($2::text[])`,
        [indexId, hashes],
      );
      for (const row of rows) vectors.set(row.sha256, row.embedding);
    }
    const missing = new Map<string, string>();
    let reusedChunks = 0;
    for (const document of todo) {
      for (const chunk of document.chunks) {
        if (vectors.has(chunk.sha256)) reusedChunks += 1;
        else if (!missing.has(chunk.sha256)) {
          missing.set(chunk.sha256, embeddingInput(document, chunk));
        }
      }
    }
    const embedded = await embedAll([...missing.values()], call);
    for (const [i, sha256] of [...missing.keys()].entries()) {
      vectors.set(sha256, embedded.vectors[i] ?? '');
    }
    call.signal?.throwIfAborted();

    if (stored === undefined || restart) {
      await transaction(client, async () => {
        // Old vectors first, so the new HNSW index never sees a vector of another size.
        if (restart) {
          await client.query(`delete from ${DOCUMENTS_TABLE} where index_id = $1`, [indexId]);
        }
        await client.query(
          `insert into ${INDEXES_TABLE} (index_id, embedder, dimensions) values ($1, $2, $3)
           on conflict (index_id) do update set embedder = excluded.embedder, dimensions = excluded.dimensions`,
          [indexId, embedder.id, dimensions],
        );
        await ensureHnswAsOwner(client);
      });
    } else {
      // Puts back an HNSW index that went missing; only reads when it is there.
      await ensureHnswAsOwner(client);
    }

    // One transaction per document: a search never sees half a document.
    for (const document of todo) {
      call.signal?.throwIfAborted();
      await transaction(client, async () => {
        await client.query(`delete from ${DOCUMENTS_TABLE} where index_id = $1 and path = $2`, [
          indexId,
          document.path,
        ]);
        await client.query(
          `insert into ${DOCUMENTS_TABLE} (index_id, path, sha256, title, url) values ($1, $2, $3, $4, $5)`,
          [indexId, document.path, document.sha256, document.title, document.url ?? null],
        );
        if (document.chunks.length === 0) return;
        await client.query(INSERT_CHUNKS_SQL, [
          indexId,
          document.path,
          document.chunks.map((_, ordinal) => ordinal),
          document.chunks.map((chunk) => chunk.sourceId),
          document.chunks.map((chunk) => chunk.sha256),
          document.chunks.map((chunk) => chunk.section ?? null),
          document.chunks.map((chunk) => chunk.text),
          document.chunks.map((chunk) => vectors.get(chunk.sha256) ?? ''),
        ]);
      });
    }
    if (removed.length > 0) {
      await client.query(
        `delete from ${DOCUMENTS_TABLE} where index_id = $1 and path = any($2::text[])`,
        [indexId, removed],
      );
    }
    await client.query(`update ${INDEXES_TABLE} set synced_at = now() where index_id = $1`, [
      indexId,
    ]);
    return {
      added,
      changed,
      removed,
      unchanged,
      embeddedChunks: missing.size,
      reusedChunks,
      embeddingTokens: embedded.tokens,
    };
  };

  return {
    async sync(documents, call = {}) {
      checkKnowledgeDocuments(documents);
      call.signal?.throwIfAborted();
      const client = await db().connect();
      let broken = false;
      try {
        // One sync per index at a time; syncs of other indexes run alongside.
        const key = `askdare_knowledge:${indexId}`;
        await client.query('select pg_advisory_lock(hashtextextended($1, 0))', [key]);
        try {
          return await withSchemaHint(() => syncLocked(client, documents, call));
        } finally {
          await client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [key]);
        }
      } catch (error) {
        broken = true;
        throw error;
      } finally {
        // After a failure the session may still hold the lock or a transaction: close it.
        client.release(broken);
      }
    },

    async search(query: string, search: SearchOptions): Promise<readonly Passage[]> {
      search.signal?.throwIfAborted();
      const limit = Math.min(Math.floor(search.maxResults), MAX_RESULTS);
      if (!(limit > 0) || query.trim() === '') return [];
      const pool = db();
      const index = await withSchemaHint(() => readIndex(pool));
      if (index === undefined) return [];
      if (index.embedder !== embedder.id || index.dimensions !== dimensions) {
        throw new Error(
          `${PREFIX} The index "${indexId}" was built with another embedder: run \`askdare kb sync\`.`,
        );
      }
      const embedded = await embedder.embed(
        [query],
        search.signal ? { signal: search.signal } : {},
      );
      const [vector] = embedded.vectors;
      if (embedded.vectors.length !== 1 || vector === undefined) {
        throw new Error(`${PREFIX} The embedder ${embedder.id} returned no vector for the query.`);
      }
      const literal = vectorLiteral(vector, index.dimensions, embedder);
      search.signal?.throwIfAborted();
      const words = fullTextQuery(query);
      const candidates = Math.max(CANDIDATES, limit);
      // $1 index, $2 query vector, $3 results, $4 candidates per side, $5 words, $6 text weight.
      const values: unknown[] = [indexId, literal, limit, candidates];
      if (words !== '') values.push(words, TEXT_WEIGHT);
      const rows = await queryRows<PassageRow>(
        pool,
        searchSql(index.dimensions, words !== ''),
        values,
      );
      search.signal?.throwIfAborted();
      return rows.map(toPassage);
    },

    async passage(sourceId, call = {}) {
      call.signal?.throwIfAborted();
      if (!SOURCE_ID.test(sourceId)) return undefined;
      const [row] = await withSchemaHint(() =>
        queryRows<PassageRow>(db(), PASSAGE_SQL, [indexId, sourceId]),
      );
      return row === undefined ? undefined : toPassage(row);
    },

    async clear(call = {}) {
      call.signal?.throwIfAborted();
      await withSchemaHint(() =>
        db().query(`delete from ${INDEXES_TABLE} where index_id = $1`, [indexId]),
      );
    },

    async diagnose(call = {}): Promise<readonly KnowledgeCheck[]> {
      call.signal?.throwIfAborted();
      const checks: KnowledgeCheck[] = [];
      try {
        const pool = db();
        const [extension] = await queryRows<{ extversion: string }>(
          pool,
          "select extversion from pg_extension where extname = 'vector'",
        );
        checks.push({ id: 'knowledge.reachable', ok: true, detail: 'The database answers.' });
        checks.push({
          id: 'knowledge.pgvector',
          ok: extension !== undefined,
          detail:
            extension === undefined
              ? 'The vector extension is not installed: run `npx askdare-postgres migrate`.'
              : `pgvector ${extension.extversion}`,
        });
        const status = await schemaStatus(pool, KNOWLEDGE_SCHEMA);
        checks.push({
          id: 'knowledge.schema',
          ok: status.state === 'current',
          detail:
            status.state === 'current'
              ? `Schema version ${status.current}.`
              : status.state === 'behind'
                ? `Schema version ${status.current} of ${status.latest}: run \`npx askdare-postgres migrate\`.`
                : `Schema version ${status.current} is newer than this package knows (${status.latest}): upgrade @boldare/askdare-postgres.`,
        });
        if (status.current === 0) {
          checks.push({
            id: 'knowledge.synced',
            ok: false,
            detail: 'Never synced: run `askdare kb sync`.',
          });
          return checks;
        }
        const [row] = await queryRows<IndexRow & { documents: number; chunks: number }>(
          pool,
          `select i.embedder, i.dimensions,
                  (select count(*)::int from ${DOCUMENTS_TABLE} d where d.index_id = i.index_id) as documents,
                  (select count(*)::int from ${CHUNKS_TABLE} c where c.index_id = i.index_id) as chunks
           from ${INDEXES_TABLE} i where i.index_id = $1`,
          [indexId],
        );
        checks.push({
          id: 'knowledge.synced',
          ok: row !== undefined && row.documents > 0,
          detail:
            row === undefined
              ? 'Never synced: run `askdare kb sync`.'
              : `${row.documents} documents, ${row.chunks} chunks`,
        });
        if (row !== undefined) {
          const same = row.embedder === embedder.id && row.dimensions === dimensions;
          checks.push({
            id: 'knowledge.embedder',
            ok: same,
            detail: same
              ? row.embedder
              : `The index was built with ${row.embedder}, the bot uses ${embedder.id}: run \`askdare kb sync\`.`,
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        checks.push(
          checks.length === 0
            ? {
                id: 'knowledge.reachable',
                ok: false,
                detail: `The database can't be reached: ${message}`,
              }
            : { id: 'knowledge.synced', ok: false, detail: `The index can't be read: ${message}` },
        );
      }
      return checks;
    },
  };
}
