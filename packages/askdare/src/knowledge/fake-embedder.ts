import type { Embedder, Embeddings, KnowledgeCallOptions } from './port';

export interface FakeEmbedderOptions {
  /** Default 64; set it to the column size of an index with fixed dimensions. */
  readonly dimensions?: number;
  /** Default `fake:bag-of-words:<dimensions>`; change it to test an embedder switch. */
  readonly id?: string;
}

const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** FNV-1a, 32 bits: a stable bucket for each word. */
function bucket(word: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < word.length; i += 1) {
    hash ^= word.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * A deterministic, offline embedder for tests and the contract suite: a hashed bag of words,
 * normalized, so texts sharing words are close. One token per word. Honors the abort signal.
 */
export function fakeEmbedder(options: FakeEmbedderOptions = {}): Embedder {
  const dimensions = options.dimensions ?? 64;
  return {
    id: options.id ?? `fake:bag-of-words:${dimensions}`,
    dimensions,
    async embed(texts: readonly string[], call: KnowledgeCallOptions = {}): Promise<Embeddings> {
      call.signal?.throwIfAborted();
      let tokens = 0;
      const vectors = texts.map((text) => {
        const vector = new Array<number>(dimensions).fill(0);
        const all = words(text);
        tokens += all.length;
        for (const word of all) {
          const hash = bucket(word);
          const index = hash % dimensions;
          vector[index] = (vector[index] ?? 0) + (hash & 0x80000000 ? -1 : 1);
        }
        const norm = Math.hypot(...vector);
        if (norm === 0) vector[0] = 1;
        return norm === 0 ? vector : vector.map((value) => value / norm);
      });
      return { vectors, tokens };
    },
  };
}
