/**
 * The retrieval port as the spike proposes it for 0.6 (see FINDINGS.md, "ADR input").
 * No OpenAI, Anthropic or Postgres types: every model path (OpenAI, Claude, Open Responses)
 * and every adapter (pgvector, OpenAI vector store, in-process) speaks only these.
 */

/** One file of the knowledge folder, as `askdare kb sync` reads it today. */
export interface KnowledgeDocument {
  /** POSIX path relative to the folder: the document's identity. */
  readonly path: string;
  readonly sha256: string;
  readonly title: string;
  /** http(s) only, checked on sync; the only link a citation may carry. */
  readonly url: string | undefined;
  /** Plain text after extraction (front matter and markup removed). */
  readonly text: string;
}

export interface SyncReport {
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly removed: readonly string[];
  readonly unchanged: number;
  /** Chunks embedded in this run; unchanged chunks are reused by content hash. */
  readonly embeddedChunks: number;
  readonly reusedChunks: number;
  readonly embeddingTokens: number;
}

/** A piece of a document the search returned. Text is untrusted third-party content. */
export interface Passage {
  /** Opaque, stable within one turn ("k1", "k2"…); what the model cites. Never a DB id. */
  readonly sourceId: string;
  readonly path: string;
  readonly title: string;
  readonly url: string | undefined;
  /** Heading trail inside the document, e.g. "Pricing and plans › Billing". */
  readonly section: string | undefined;
  readonly text: string;
  readonly score: number;
}

export interface SearchOptions {
  readonly maxResults: number;
  readonly signal?: AbortSignal;
}

export interface DiagnoseCheck {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

/**
 * What a bot's `knowledge` points at. The server owns the instance (ADR-0004: the client never
 * chooses the index); a turn only calls `search`.
 */
export interface KnowledgeIndex {
  /** Makes the index mirror the documents. Idempotent; only changed content is embedded. */
  sync(documents: readonly KnowledgeDocument[]): Promise<SyncReport>;
  search(query: string, options: SearchOptions): Promise<readonly Omit<Passage, 'sourceId'>[]>;
  /** Removes everything this index holds (bot deleted, `kb sync --reset`). */
  clear(): Promise<void>;
  /** For `askdare doctor`: reachable, extension present, embedding model matches, not empty. */
  diagnose(): Promise<readonly DiagnoseCheck[]>;
}

/** Turns text into vectors. Separate from the index so the key and model are the site's choice. */
export interface Embedder {
  /** Stored with the index; a different id means every chunk is embedded again. */
  readonly id: string;
  readonly dimensions: number;
  embed(texts: readonly string[], signal?: AbortSignal): Promise<{ vectors: number[][]; tokens: number }>;
}
