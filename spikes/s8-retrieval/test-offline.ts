// Offline check of scan, chunking and the pgvector SQL with a fake embedder: `node test-offline.ts`.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import pg from 'pg';
import { chunkDocument } from './chunk.ts';
import { migrate, PgKnowledgeIndex } from './pg-index.ts';
import type { Embedder } from './port.ts';
import { scanFolder } from './scan.ts';

const documents = await scanFolder(join(import.meta.dirname, 'fixtures/knowledge'));
for (const d of documents) {
  const chunks = chunkDocument(d.title, d.text);
  console.log(d.path.padEnd(26), d.title.padEnd(36), d.url ?? '-', `${chunks.length} chunks`);
}
const sample = chunkDocument('T', documents.find((d) => d.path === 'pricing.md')!.text);
console.log(sample.map((c) => `[${c.section}] ${c.text.slice(0, 50).replace(/\n/g, ' ')}`).join('\n'));

const fake: Embedder = {
  id: 'fake:8',
  dimensions: 1536,
  async embed(texts) {
    const vectors = texts.map((t) => {
      const h = createHash('sha512').update(t).digest();
      return Array.from({ length: 1536 }, (_, i) => (h[i % 64]! - 128) / 128);
    });
    return { vectors, tokens: texts.join(' ').length / 4 };
  },
};
const pool = new pg.Pool({ connectionString: 'postgres://s8:s8@127.0.0.1:54328/s8' });
await migrate(pool, 1536);
const index = new PgKnowledgeIndex({ pool, indexId: 'offline', embedder: fake, mode: 'text' });
await index.clear();
const first = await index.sync(documents);
const again = await index.sync(documents);
assert.equal(again.unchanged, documents.length);
assert.equal(again.embeddedChunks, 0);
console.log('first', first.embeddedChunks, 'again', again.embeddedChunks);
const hits = await index.search('X-Brightloop-Signature webhook', { maxResults: 3 });
assert.equal(hits[0]?.path, 'api.md');
const hybrid = new PgKnowledgeIndex({ pool, indexId: 'offline', embedder: fake });
console.log((await hybrid.search('rate limit', { maxResults: 3 })).map((h) => `${h.path} ${h.score.toFixed(4)}`));
console.log(await index.diagnose());
await index.clear();
await pool.end();
console.log('offline ok');
