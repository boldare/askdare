/**
 * The pgvector adapter of the KnowledgeIndex port. One database can hold many bots' indexes:
 * every row carries `index_id`. Hybrid search: cosine similarity (HNSW) and full-text search,
 * fused with reciprocal rank fusion, like file_search's `hybrid_search`.
 */
import pg from 'pg';
import { chunkDocument, embeddingInput } from './chunk.ts';
import type {
  DiagnoseCheck,
  Embedder,
  KnowledgeDocument,
  KnowledgeIndex,
  Passage,
  SearchOptions,
  SyncReport,
} from './port.ts';

export interface PgIndexOptions {
  readonly pool: pg.Pool;
  readonly indexId: string;
  readonly embedder: Embedder;
  /** 'vector' only, 'text' only, or both fused (default). For the spike's comparison. */
  readonly mode?: 'hybrid' | 'vector' | 'text';
}

const RRF_K = 60;
const CANDIDATES = 20;

/** Language-neutral OR query: Postgres' 'simple' config, words of three letters or more. */
function orQuery(text: string): string {
  const words = text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu) ?? [];
  return [...new Set(words)].map((word) => `'${word.replace(/'/g, "''")}'`).join(' | ');
}

const toVector = (values: readonly number[]): string => `[${values.join(',')}]`;

export async function migrate(pool: pg.Pool, dimensions: number): Promise<void> {
  await pool.query(`
    create extension if not exists vector;
    create table if not exists kb_indexes (
      index_id text primary key,
      embedder text not null,
      dimensions int not null
    );
    create table if not exists kb_documents (
      index_id text not null references kb_indexes on delete cascade,
      path text not null,
      sha256 text not null,
      title text not null,
      url text,
      primary key (index_id, path)
    );
    create table if not exists kb_chunks (
      index_id text not null,
      path text not null,
      ordinal int not null,
      section text,
      text text not null,
      sha256 text not null,
      embedding vector(${dimensions}) not null,
      tsv tsvector generated always as (to_tsvector('simple', coalesce(section, '') || ' ' || text)) stored,
      primary key (index_id, path, ordinal),
      foreign key (index_id, path) references kb_documents on delete cascade
    );
    create index if not exists kb_chunks_embedding on kb_chunks using hnsw (embedding vector_cosine_ops);
    create index if not exists kb_chunks_tsv on kb_chunks using gin (tsv);
    create index if not exists kb_chunks_sha on kb_chunks (index_id, sha256);
  `);
}

export class PgKnowledgeIndex implements KnowledgeIndex {
  readonly #pool: pg.Pool;
  readonly #indexId: string;
  readonly #embedder: Embedder;
  readonly #mode: 'hybrid' | 'vector' | 'text';

  constructor(options: PgIndexOptions) {
    this.#pool = options.pool;
    this.#indexId = options.indexId;
    this.#embedder = options.embedder;
    this.#mode = options.mode ?? 'hybrid';
  }

  async sync(documents: readonly KnowledgeDocument[]): Promise<SyncReport> {
    const pool = this.#pool;
    const id = this.#indexId;
    // A different embedding model makes every stored vector useless: start over.
    const existingIndex = await pool.query<{ embedder: string }>(
      'select embedder from kb_indexes where index_id = $1',
      [id],
    );
    if (existingIndex.rows[0] && existingIndex.rows[0].embedder !== this.#embedder.id) {
      await pool.query('delete from kb_indexes where index_id = $1', [id]);
    }
    await pool.query(
      `insert into kb_indexes (index_id, embedder, dimensions) values ($1, $2, $3)
       on conflict (index_id) do nothing`,
      [id, this.#embedder.id, this.#embedder.dimensions],
    );

    const remote = new Map(
      (
        await pool.query<{ path: string; sha256: string; title: string; url: string | null }>(
          'select path, sha256, title, url from kb_documents where index_id = $1',
          [id],
        )
      ).rows.map((row) => [row.path, row]),
    );
    const added: string[] = [];
    const changed: string[] = [];
    let unchanged = 0;
    const todo: KnowledgeDocument[] = [];
    for (const document of documents) {
      const existing = remote.get(document.path);
      remote.delete(document.path);
      if (!existing) {
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

    // Chunk everything that changed, then embed only chunks whose hash isn't stored yet.
    const planned = todo.map((document) => ({
      document,
      chunks: chunkDocument(document.title, document.text),
    }));
    const hashes = [...new Set(planned.flatMap((p) => p.chunks.map((c) => c.sha256)))];
    const cached = new Map<string, string>();
    if (hashes.length > 0) {
      const rows = await pool.query<{ sha256: string; embedding: string }>(
        `select distinct on (sha256) sha256, embedding::text as embedding
         from kb_chunks where index_id = $1 and sha256 = any($2)`,
        [id, hashes],
      );
      for (const row of rows.rows) cached.set(row.sha256, row.embedding);
    }
    const missing = planned.flatMap((p) =>
      p.chunks
        .filter((chunk) => !cached.has(chunk.sha256))
        .map((chunk) => ({ chunk, input: embeddingInput(p.document.title, chunk) })),
    );
    const unique = [...new Map(missing.map((m) => [m.chunk.sha256, m])).values()];
    let tokens = 0;
    for (let start = 0; start < unique.length; start += 256) {
      const batch = unique.slice(start, start + 256);
      const result = await this.#embedder.embed(batch.map((m) => m.input));
      tokens += result.tokens;
      batch.forEach((m, index) => cached.set(m.chunk.sha256, toVector(result.vectors[index] ?? [])));
    }

    // One transaction per document: a search never sees half a document.
    for (const { document, chunks } of planned) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query('delete from kb_documents where index_id = $1 and path = $2', [id, document.path]);
        await client.query(
          'insert into kb_documents (index_id, path, sha256, title, url) values ($1, $2, $3, $4, $5)',
          [id, document.path, document.sha256, document.title, document.url ?? null],
        );
        for (const chunk of chunks) {
          await client.query(
            `insert into kb_chunks (index_id, path, ordinal, section, text, sha256, embedding)
             values ($1, $2, $3, $4, $5, $6, $7)`,
            [id, document.path, chunk.ordinal, chunk.section ?? null, chunk.text, chunk.sha256, cached.get(chunk.sha256)],
          );
        }
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }
    if (removed.length > 0) {
      await pool.query('delete from kb_documents where index_id = $1 and path = any($2)', [id, removed]);
    }
    const totalChunks = planned.reduce((sum, p) => sum + p.chunks.length, 0);
    return {
      added,
      changed,
      removed,
      unchanged,
      embeddedChunks: unique.length,
      reusedChunks: totalChunks - missing.length,
      embeddingTokens: tokens,
    };
  }

  async search(query: string, options: SearchOptions): Promise<Omit<Passage, 'sourceId'>[]> {
    const vector =
      this.#mode === 'text'
        ? undefined
        : toVector((await this.#embedder.embed([query], options.signal)).vectors[0] ?? []);
    const text = this.#mode === 'vector' ? '' : orQuery(query);
    const result = await this.#pool.query<{
      path: string;
      title: string;
      url: string | null;
      section: string | null;
      text: string;
      score: number;
    }>(
      `with
       vec as (
         select path, ordinal, row_number() over (order by embedding <=> $2::vector) as r
         from kb_chunks where index_id = $1 and $2::vector is not null
         order by embedding <=> $2::vector limit ${CANDIDATES}
       ),
       fts as (
         select path, ordinal,
                row_number() over (order by ts_rank_cd(tsv, to_tsquery('simple', $3)) desc) as r
         from kb_chunks where index_id = $1 and $3 <> '' and tsv @@ to_tsquery('simple', $3)
         order by ts_rank_cd(tsv, to_tsquery('simple', $3)) desc limit ${CANDIDATES}
       ),
       fused as (
         select path, ordinal, sum(1.0 / (${RRF_K} + r))::float8 as score
         from (select * from vec union all select * from fts) ranked
         group by path, ordinal
       )
       select c.path, d.title, d.url, c.section, c.text, f.score
       from fused f
       join kb_chunks c on c.index_id = $1 and c.path = f.path and c.ordinal = f.ordinal
       join kb_documents d on d.index_id = $1 and d.path = c.path
       order by f.score desc limit $4`,
      [this.#indexId, vector ?? null, text, options.maxResults],
    );
    return result.rows.map((row) => ({
      path: row.path,
      title: row.title,
      url: row.url ?? undefined,
      section: row.section ?? undefined,
      text: row.text,
      score: row.score,
    }));
  }

  async clear(): Promise<void> {
    await this.#pool.query('delete from kb_indexes where index_id = $1', [this.#indexId]);
  }

  async diagnose(): Promise<DiagnoseCheck[]> {
    const checks: DiagnoseCheck[] = [];
    try {
      const extension = await this.#pool.query<{ extversion: string }>(
        "select extversion from pg_extension where extname = 'vector'",
      );
      const version = extension.rows[0]?.extversion;
      checks.push({
        id: 'knowledge.pgvector',
        ok: version !== undefined,
        detail: version ? `pgvector ${version}` : 'The vector extension is not installed.',
      });
      const index = await this.#pool.query<{ embedder: string; dimensions: number; documents: string; chunks: string }>(
        `select i.embedder, i.dimensions,
                (select count(*) from kb_documents d where d.index_id = i.index_id) as documents,
                (select count(*) from kb_chunks c where c.index_id = i.index_id) as chunks
         from kb_indexes i where i.index_id = $1`,
        [this.#indexId],
      );
      const row = index.rows[0];
      checks.push({
        id: 'knowledge.synced',
        ok: row !== undefined && Number(row.documents) > 0,
        detail: row ? `${row.documents} documents, ${row.chunks} chunks` : 'Never synced: run `askdare kb sync`.',
      });
      if (row) {
        checks.push({
          id: 'knowledge.embedder',
          ok: row.embedder === this.#embedder.id,
          detail:
            row.embedder === this.#embedder.id
              ? row.embedder
              : `Index was built with ${row.embedder}, the bot uses ${this.#embedder.id}: run \`askdare kb sync\`.`,
        });
      }
    } catch (error) {
      checks.push({
        id: 'knowledge.reachable',
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return checks;
  }
}
