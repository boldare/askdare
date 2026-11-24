import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { knowledgeIndexContract } from './contract';
import { knowledgeDocument } from './document';
import { fakeEmbedder } from './fake-embedder';
import { memoryKnowledgeIndex, memoryKnowledgeStore } from './memory-index';
import type { Embedder } from './port';

const store = memoryKnowledgeStore();
knowledgeIndexContract(
  'memoryKnowledgeIndex',
  ({ indexId, embedder }) => memoryKnowledgeIndex({ indexId, embedder, store }),
  { describe, it, expect },
);

const text = '# Plans\n\nThe Team plan costs 12 euros.';
const document = knowledgeDocument({
  path: 'pricing.md',
  sha256: createHash('sha256').update(text).digest('hex'),
  title: 'Pricing',
  url: undefined,
  text,
});

describe('memoryKnowledgeIndex', () => {
  it('leaves the index as it was when embedding fails', async () => {
    const shared = memoryKnowledgeStore();
    const embedder = fakeEmbedder();
    const index = memoryKnowledgeIndex({ embedder, store: shared });
    const failing: Embedder = {
      ...embedder,
      embed: () => Promise.reject(new Error('upstream down')),
    };
    await expect(
      memoryKnowledgeIndex({ embedder: failing, store: shared }).sync([document]),
    ).rejects.toThrow('upstream down');
    expect(await index.passage(document.chunks[0]?.sourceId ?? '')).toBe(undefined);
  });

  it('refuses vectors of the wrong size', async () => {
    const embedder = fakeEmbedder();
    const wrong: Embedder = { ...embedder, embed: async () => ({ vectors: [[1, 0]], tokens: 1 }) };
    await expect(memoryKnowledgeIndex({ embedder: wrong }).sync([document])).rejects.toThrow(
      /wrong number or size/,
    );
  });

  it('refuses to search with another embedder until synced again', async () => {
    const shared = memoryKnowledgeStore();
    await memoryKnowledgeIndex({ embedder: fakeEmbedder(), store: shared }).sync([document]);
    const other = memoryKnowledgeIndex({
      embedder: fakeEmbedder({ id: 'fake:other' }),
      store: shared,
    });
    await expect(other.search('team plan', { maxResults: 3 })).rejects.toThrow(/kb sync/);
  });
});
