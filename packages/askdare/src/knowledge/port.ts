/**
 * The retrieval port of ADR-0025: what a bot's own knowledge index is, with no OpenAI or database
 * types. Every model path and every adapter (in-memory, pgvector, community ones) speaks only these.
 * Server-side only: the client never chooses an index (ADR-0004).
 */

/**
 * One piece of a document: within one section, at most about 350 tokens. Core chunks every
 * document (`knowledgeDocument`), so every index stores the same chunks.
 */
export interface KnowledgeChunk {
  /** What the model cites: `k` and the first 12 hex characters of `sha256`. Stable across syncs and turns. */
  readonly sourceId: string;
  /** The heading trail inside the document, such as "Pricing › Billing"; undefined before the first heading. */
  readonly section: string | undefined;
  readonly text: string;
  /** SHA-256 (hex) over the document title, the section and the text: the embedding cache key. */
  readonly sha256: string;
}

/** One file of the knowledge folder, extracted and chunked. Built by `askdare kb sync`, never at runtime. */
export interface KnowledgeDocument {
  /** POSIX path relative to the knowledge folder: the document's identity in the index. */
  readonly path: string;
  /** SHA-256 (hex) of the file's bytes: an unchanged file is skipped. */
  readonly sha256: string;
  readonly title: string;
  /** http(s) only; the only link a citation may carry. */
  readonly url: string | undefined;
  /** In document order. */
  readonly chunks: readonly KnowledgeChunk[];
}

/** What one `sync` did. */
export interface SyncReport {
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly removed: readonly string[];
  /** Documents whose file hash, title and URL were already in the index. */
  readonly unchanged: number;
  /** Distinct chunks embedded in this run. */
  readonly embeddedChunks: number;
  /** Chunks of added or changed documents whose embedding the index already had. */
  readonly reusedChunks: number;
  readonly embeddingTokens: number;
}

/** A chunk with its document, as search and citations see it. `text` is untrusted third-party content. */
export interface Passage {
  readonly sourceId: string;
  readonly path: string;
  readonly title: string;
  readonly url: string | undefined;
  readonly section: string | undefined;
  readonly text: string;
  /** Relevance from `search`, higher is better; absent from `passage()`. */
  readonly score?: number;
}

export interface SearchOptions {
  readonly maxResults: number;
  readonly signal?: AbortSignal;
}

export interface KnowledgeCallOptions {
  readonly signal?: AbortSignal;
}

/**
 * One finding of `diagnose`, for `askdare doctor`. Every index reports `knowledge.synced` and
 * `knowledge.embedder`; adapters add their own, such as `knowledge.pgvector`.
 */
export interface KnowledgeCheck {
  readonly id: string;
  readonly ok: boolean;
  /** Counts, versions and what to do. Never document text. */
  readonly detail: string;
}

/** A bot's knowledge. One database may hold many bots' indexes, each under its own index ID. */
export interface KnowledgeIndex {
  /**
   * Makes the index mirror `documents`, the whole folder. Idempotent: an unchanged file is skipped,
   * and only chunks whose hash the index doesn't have are embedded. Each document is written
   * atomically. Refuses documents that `checkKnowledgeDocuments` refuses, before changing anything.
   */
  sync(
    documents: readonly KnowledgeDocument[],
    options?: KnowledgeCallOptions,
  ): Promise<SyncReport>;
  /** The best passages first, each with a score. */
  search(query: string, options: SearchOptions): Promise<readonly Passage[]>;
  /** Resolves a cited source ID from this turn or an earlier one; undefined once the chunk is gone. */
  passage(sourceId: string, options?: KnowledgeCallOptions): Promise<Passage | undefined>;
  /** Removes everything this index holds. */
  clear(options?: KnowledgeCallOptions): Promise<void>;
  diagnose(options?: KnowledgeCallOptions): Promise<readonly KnowledgeCheck[]>;
}

export interface Embeddings {
  /** One vector per input, in input order, each `dimensions` long. */
  readonly vectors: readonly (readonly number[])[];
  readonly tokens: number;
}

/** Turns text into vectors. Separate from the index, so the site picks the key and the model. */
export interface Embedder {
  /**
   * Provider, model and dimensions, such as `openai:<model>:1536`. Stored with the index: a
   * different ID makes the next sync embed everything again.
   */
  readonly id: string;
  readonly dimensions: number;
  embed(texts: readonly string[], options?: KnowledgeCallOptions): Promise<Embeddings>;
}
