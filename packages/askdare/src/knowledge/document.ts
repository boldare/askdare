import { createHash } from 'node:crypto';
import { checkKnowledgeDocuments, sourceIdOf } from './check';
import { type ChunkOptions, chunkText } from './chunk';
import type { KnowledgeChunk, KnowledgeDocument } from './port';

// Kept importable from here, where the CLI and the suite always found them.
export { checkKnowledgeDocuments, embeddingInput, sourceIdOf } from './check';

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
