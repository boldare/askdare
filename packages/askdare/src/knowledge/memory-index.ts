import { checkKnowledgeDocuments, embeddingInput } from './document';
import type {
  Embedder,
  KnowledgeCallOptions,
  KnowledgeCheck,
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeIndex,
  Passage,
  SearchOptions,
  SyncReport,
} from './port';

interface StoredIndex {
  readonly embedderId: string;
  /** By path, sorted, so a chunk found in two documents resolves to the same one every time. */
  readonly documents: ReadonlyMap<string, KnowledgeDocument>;
  /** By chunk hash. */
  readonly vectors: ReadonlyMap<string, readonly number[]>;
}

/** What several `memoryKnowledgeIndex` instances share, as one database holds many indexes. */
export interface MemoryKnowledgeStore {
  readonly indexes: Map<string, StoredIndex>;
}

export interface MemoryKnowledgeIndexOptions {
  readonly embedder: Embedder;
  /** Default `default`. */
  readonly indexId?: string;
  /** Shared by instances that should see the same indexes; a new one by default. */
  readonly store?: MemoryKnowledgeStore;
}

const SOURCE_ID = /^k[0-9a-f]{12}$/;

export function memoryKnowledgeStore(): MemoryKnowledgeStore {
  return { indexes: new Map() };
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}

function toPassage(document: KnowledgeDocument, chunk: KnowledgeChunk): Passage {
  return {
    sourceId: chunk.sourceId,
    path: document.path,
    title: document.title,
    url: document.url,
    section: chunk.section,
    text: chunk.text,
  };
}

function checkVectors(
  embedder: Embedder,
  vectors: readonly (readonly number[])[],
  count: number,
): void {
  if (vectors.length !== count || vectors.some((vector) => vector.length !== embedder.dimensions)) {
    throw new Error(`The embedder ${embedder.id} returned vectors of the wrong number or size.`);
  }
}

/**
 * A brute-force index in memory, for tests and the contract suite: cosine similarity over every
 * chunk, no full-text side. Not for production; ADR-0025 leaves an in-process index out of 0.6.
 */
export function memoryKnowledgeIndex(options: MemoryKnowledgeIndexOptions): KnowledgeIndex {
  const { embedder } = options;
  const indexId = options.indexId ?? 'default';
  const store = options.store ?? memoryKnowledgeStore();

  return {
    async sync(
      documents: readonly KnowledgeDocument[],
      call: KnowledgeCallOptions = {},
    ): Promise<SyncReport> {
      checkKnowledgeDocuments(documents);
      call.signal?.throwIfAborted();
      const existing = store.indexes.get(indexId);
      // A different embedder makes every stored vector useless: the index starts over.
      const previous = existing?.embedderId === embedder.id ? existing : undefined;
      const remaining = new Map(previous?.documents);
      const added: string[] = [];
      const changed: string[] = [];
      const todo: KnowledgeDocument[] = [];
      let unchanged = 0;
      for (const document of documents) {
        const stored = remaining.get(document.path);
        remaining.delete(document.path);
        if (stored === undefined) {
          added.push(document.path);
          todo.push(document);
        } else if (
          stored.sha256 !== document.sha256 ||
          stored.title !== document.title ||
          stored.url !== document.url
        ) {
          changed.push(document.path);
          todo.push(document);
        } else unchanged += 1;
      }

      const vectors = new Map(previous?.vectors);
      const missing = new Map<string, string>();
      let reusedChunks = 0;
      for (const document of todo) {
        for (const chunk of document.chunks) {
          if (vectors.has(chunk.sha256)) reusedChunks += 1;
          else missing.set(chunk.sha256, embeddingInput(document, chunk));
        }
      }
      let embeddingTokens = 0;
      if (missing.size > 0) {
        const result = await embedder.embed([...missing.values()], call);
        checkVectors(embedder, result.vectors, missing.size);
        embeddingTokens = result.tokens;
        for (const [i, sha256] of [...missing.keys()].entries()) {
          vectors.set(sha256, result.vectors[i] ?? []);
        }
      }

      // Unchanged documents keep what is stored, so their chunks match the stored vectors.
      const rewritten = new Set(todo);
      const next = new Map<string, KnowledgeDocument>();
      for (const document of [...documents].sort((a, b) => (a.path < b.path ? -1 : 1))) {
        const stored = rewritten.has(document) ? undefined : previous?.documents.get(document.path);
        next.set(document.path, stored ?? document);
      }
      const used = new Set(
        [...next.values()].flatMap((document) => document.chunks.map((chunk) => chunk.sha256)),
      );
      for (const sha256 of vectors.keys()) if (!used.has(sha256)) vectors.delete(sha256);
      // Committed at once: a search sees the old index or the new one, never half of it.
      store.indexes.set(indexId, { embedderId: embedder.id, documents: next, vectors });
      return {
        added,
        changed,
        removed: [...remaining.keys()],
        unchanged,
        embeddedChunks: missing.size,
        reusedChunks,
        embeddingTokens,
      };
    },

    async search(query: string, search: SearchOptions): Promise<readonly Passage[]> {
      search.signal?.throwIfAborted();
      const index = store.indexes.get(indexId);
      const limit = Math.floor(search.maxResults);
      if (index === undefined || index.documents.size === 0 || !(limit > 0)) return [];
      if (index.embedderId !== embedder.id) {
        throw new Error(`The index was built with another embedder: run \`askdare kb sync\`.`);
      }
      const embedded = await embedder.embed(
        [query],
        search.signal ? { signal: search.signal } : {},
      );
      checkVectors(embedder, embedded.vectors, 1);
      const queryVector = embedded.vectors[0] ?? [];
      const seen = new Set<string>();
      const scored: Passage[] = [];
      for (const document of index.documents.values()) {
        for (const chunk of document.chunks) {
          if (seen.has(chunk.sourceId)) continue;
          seen.add(chunk.sourceId);
          const score = cosine(queryVector, index.vectors.get(chunk.sha256) ?? []);
          scored.push({ ...toPassage(document, chunk), score });
        }
      }
      // A stable sort keeps document order between equal scores.
      return scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, limit);
    },

    async passage(sourceId: string, call: KnowledgeCallOptions = {}): Promise<Passage | undefined> {
      call.signal?.throwIfAborted();
      if (!SOURCE_ID.test(sourceId)) return undefined;
      for (const document of store.indexes.get(indexId)?.documents.values() ?? []) {
        const chunk = document.chunks.find((candidate) => candidate.sourceId === sourceId);
        if (chunk !== undefined) return toPassage(document, chunk);
      }
      return undefined;
    },

    async clear(call: KnowledgeCallOptions = {}): Promise<void> {
      call.signal?.throwIfAborted();
      store.indexes.delete(indexId);
    },

    async diagnose(call: KnowledgeCallOptions = {}): Promise<readonly KnowledgeCheck[]> {
      call.signal?.throwIfAborted();
      const index = store.indexes.get(indexId);
      if (index === undefined) {
        return [
          { id: 'knowledge.synced', ok: false, detail: 'Never synced: run `askdare kb sync`.' },
        ];
      }
      const chunks = [...index.documents.values()].reduce(
        (sum, document) => sum + document.chunks.length,
        0,
      );
      return [
        {
          id: 'knowledge.synced',
          ok: index.documents.size > 0,
          detail: `${index.documents.size} documents, ${chunks} chunks`,
        },
        {
          id: 'knowledge.embedder',
          ok: index.embedderId === embedder.id,
          detail:
            index.embedderId === embedder.id
              ? index.embedderId
              : `The index was built with ${index.embedderId}, the bot uses ${embedder.id}: run \`askdare kb sync\`.`,
        },
      ];
    },
  };
}
