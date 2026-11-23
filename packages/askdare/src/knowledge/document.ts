import { createHash } from 'node:crypto';
import { type ChunkOptions, chunkText } from './chunk';
import type { KnowledgeChunk, KnowledgeDocument } from './port';

const SHA256 = /^[0-9a-f]{64}$/;
const SOURCE_ID_HEX = 12;
const HTTP_URL = /^https?:\/\/\S+$/i;

export interface KnowledgeDocumentInput {
  /** POSIX path relative to the knowledge folder. */
  readonly path: string;
  /** SHA-256 (hex) of the file's bytes. */
  readonly sha256: string;
  readonly title: string;
  readonly url: string | undefined;
  /** Extracted text (`extractKnowledgeText`). */
  readonly text: string;
}

/**
 * The source ID the model cites for a chunk: `k` and the first 12 hex characters of its hash
 * (ADR-0025, decision 5). Derived from content, so it means the same passage in every turn.
 */
export function sourceIdOf(chunkSha256: string): string {
  return `k${chunkSha256.slice(0, SOURCE_ID_HEX)}`;
}

/** The chunk hash, over the document title, the section and the text: what gets embedded. */
export function chunkSha256(title: string, section: string | undefined, text: string): string {
  return createHash('sha256')
    .update(`${title}\n${section ?? ''}\n${text}`)
    .digest('hex');
}

/** Chunks an extracted document and gives every chunk its hash and source ID. */
export function knowledgeDocument(
  input: KnowledgeDocumentInput,
  options: ChunkOptions = {},
): KnowledgeDocument {
  const chunks: KnowledgeChunk[] = chunkText(input.text, options).map(({ section, text }) => {
    const sha256 = chunkSha256(input.title, section, text);
    return { sourceId: sourceIdOf(sha256), section, text, sha256 };
  });
  const document: KnowledgeDocument = {
    path: input.path,
    sha256: input.sha256,
    title: input.title,
    url: input.url,
    chunks,
  };
  checkKnowledgeDocuments([document]);
  return document;
}

/**
 * What the embedder sees for a chunk, and what makes a passage readable on its own: the document
 * title and section above the text. Every index embeds the same input for the same chunk.
 */
export function embeddingInput(
  document: Pick<KnowledgeDocument, 'title'>,
  chunk: Pick<KnowledgeChunk, 'section' | 'text'>,
): string {
  return `${document.title}${chunk.section ? ` — ${chunk.section}` : ''}\n\n${chunk.text}`;
}

/**
 * What every `KnowledgeIndex.sync` checks before it changes anything: unique paths, http(s) URLs,
 * well-formed hashes, source IDs derived from them, and no source ID shared by two different chunks
 * (a 48-bit prefix collision would make a citation resolve to the wrong passage). The same chunk in
 * two places is fine: it is the same text under the same title and section.
 */
export function checkKnowledgeDocuments(documents: readonly KnowledgeDocument[]): void {
  const paths = new Set<string>();
  const hashes = new Map<string, string>();
  for (const document of documents) {
    if (document.path === '' || document.path.startsWith('/') || document.path.includes('\\')) {
      throw new Error(`${document.path}: the path must be a relative POSIX path.`);
    }
    if (paths.has(document.path)) throw new Error(`${document.path}: the path appears twice.`);
    paths.add(document.path);
    if (!SHA256.test(document.sha256)) {
      throw new Error(`${document.path}: sha256 must be 64 lowercase hex characters.`);
    }
    if (document.url !== undefined && !HTTP_URL.test(document.url)) {
      throw new Error(`${document.path}: url must be an http(s) URL.`);
    }
    for (const chunk of document.chunks) {
      if (!SHA256.test(chunk.sha256) || chunk.sourceId !== sourceIdOf(chunk.sha256)) {
        throw new Error(`${document.path}: a chunk's source ID doesn't match its hash.`);
      }
      const known = hashes.get(chunk.sourceId);
      if (known !== undefined && known !== chunk.sha256) {
        throw new Error(
          `${document.path}: source ID ${chunk.sourceId} would stand for two different chunks. Edit one of them slightly and sync again.`,
        );
      }
      hashes.set(chunk.sourceId, chunk.sha256);
    }
  }
}
