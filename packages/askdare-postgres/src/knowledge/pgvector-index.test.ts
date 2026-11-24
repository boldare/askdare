import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// Until task k2 exports the suite from @boldare/askdare/testing (ADR-0025, decision 12).
import { knowledgeIndexContract } from '../../../askdare/src/knowledge/contract';
import { knowledgeDocument } from '../../../askdare/src/knowledge/document';
import { fakeEmbedder } from '../../../askdare/src/knowledge/fake-embedder';
import type { Embedder, KnowledgeDocument } from '../../../askdare/src/knowledge/port';
import { migrate, pgvectorIndex } from '../index';
import { createTestSchema, TEST_DATABASE_URL, type TestSchema } from '../testing/database';
import { fullTextQuery, hnswIndexName, vectorExpression } from './pgvector-index';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

function doc(path: string, title: string, text: string): KnowledgeDocument {
  return knowledgeDocument({
    path,
    sha256: sha256(`${title}\n${text}`),
    title,
    url: undefined,
    text,
  });
}

describe('pgvectorIndex without a database', () => {
  const embedder = fakeEmbedder();

  it('refuses an index ID that is not a plain name', () => {
    for (const indexId of [
      "a'; drop table askdare_knowledge_chunks; --",
      '',
      'a b',
      'x'.repeat(129),
    ]) {
      expect(() => pgvectorIndex({ url: 'postgres://localhost/x', embedder, indexId })).toThrow(
        'Invalid indexId',
      );
    }
  });

  it('refuses dimensions pgvector cannot store', () => {
    for (const dimensions of [0, 1.5, 16_001]) {
      expect(() =>
        pgvectorIndex({ url: 'postgres://localhost/x', embedder: { ...embedder, dimensions } }),
      ).toThrow("The embedder's dimensions");
    }
  });

  it('builds a full-text query that cannot be malformed', () => {
    expect(fullTextQuery("What's the X-Brightloop-Signature? a & b | !c")).toBe(
      "'what' | 'the' | 'x-brightloop-signature'",
    );
    expect(fullTextQuery('?? a b')).toBe('');
  });

  it('indexes up to 4,000 dimensions with HNSW, and names the index within 63 bytes', () => {
    expect(vectorExpression(1536).opclass).toBe('vector_cosine_ops');
    expect(vectorExpression(3072).opclass).toBe('halfvec_cosine_ops');
    expect(vectorExpression(4096).opclass).toBe(undefined);
    expect(hnswIndexName('x'.repeat(128), 16_000).length).toBeLessThanOrEqual(63);
  });
});

describe.skipIf(!TEST_DATABASE_URL)('pgvectorIndex against Postgres', () => {
  let schema: TestSchema;

  beforeAll(async () => {
    schema = await createTestSchema();
    await migrate({ pool: schema.pool });
  });

  afterAll(async () => {
    await schema.drop();
  });

  knowledgeIndexContract('pgvectorIndex', {
    describe,
    it,
    expect,
    open: ({ indexId, embedder }) => pgvectorIndex({ pool: schema.pool, indexId, embedder }),
  });

  const open = (indexId: string, embedder: Embedder = fakeEmbedder()) =>
    pgvectorIndex({ pool: schema.pool, indexId, embedder });

  it("finds a small index's passages next to a large one (no results lost to filtering)", async () => {
    const large = open('large');
    const small = open('small');
    const many = Array.from({ length: 30 }, (_, i) =>
      doc(
        `many-${i}.md`,
        `Webhooks ${i}`,
        Array.from(
          { length: 10 },
          (_, j) => `# Webhook part ${j}\n\nWebhook delivery ${i}.${j} retries with a signature.`,
        ).join('\n\n'),
      ),
    );
    await large.sync(many);
    await small.sync([doc('only.md', 'Only', 'A webhook carries a signature header.')]);
    const results = await small.search('webhook signature', { maxResults: 5 });
    expect(results.map((result) => result.path)).toEqual(['only.md']);
    await large.clear();
    await small.clear();
  });

  it('searches an index through its own HNSW index', async () => {
    const index = open('planned');
    await index.sync([doc('a.md', 'A', 'Refunds are possible within 14 days.')]);
    const name = hnswIndexName('planned', 64);
    const client = await schema.pool.connect();
    try {
      await client.query('set enable_seqscan = off');
      await client.query('set enable_sort = off');
      const vector = `[${Array.from({ length: 64 }, (_, i) => (i === 0 ? 1 : 0)).join(',')}]`;
      const plan = await client.query(
        `explain (format json) select source_id from askdare_knowledge_chunks
         where index_id = $1 and ${vectorExpression(64).predicate}
         order by ${vectorExpression(64).column} <=> $2::vector(64) limit 5`,
        ['planned', vector],
      );
      expect(JSON.stringify(plan.rows)).toContain(name);
    } finally {
      await client.query('reset all');
      client.release();
      await index.clear();
    }
  });

  it('works for embedders of any size, switching sizes on a sync', async () => {
    const documents = [doc('a.md', 'A', '# Refunds\n\nRefunds are possible within 14 days.')];
    for (const dimensions of [2048, 4100, 16]) {
      const index = open('sizes', fakeEmbedder({ dimensions }));
      const report = await index.sync(documents);
      expect(report.added).toEqual(['a.md']);
      expect(report.embeddedChunks).toBe(1);
      expect((await index.search('refunds', { maxResults: 3 }))[0]?.path).toBe('a.md');
    }
    // The index now holds 16-dimension vectors; a bot still on another embedder is told to sync.
    await expect(
      open('sizes', fakeEmbedder({ dimensions: 2048 })).search('refunds', { maxResults: 3 }),
    ).rejects.toThrow('was built with another embedder');
    await open('sizes').clear();
  });

  it('returns a chunk found in two documents once, from the first path', async () => {
    const index = open('twins');
    const text = 'Support answers within one business day.';
    await index.sync([doc('b.md', 'Support', text), doc('B.md', 'Support', text)]);
    const results = await index.search('support business day', { maxResults: 5 });
    expect(results.map((result) => result.path)).toEqual(['B.md']);
    const id = results[0]?.sourceId ?? '';
    expect((await index.passage(id))?.path).toBe('B.md');
    await index.clear();
  });

  it('searches with a query that has no full-text words, or tsquery syntax', async () => {
    const index = open('syntax');
    await index.sync([doc('a.md', 'A', 'Refunds are possible within 14 days.')]);
    expect(await index.search('?! a', { maxResults: 3 })).toHaveLength(1);
    expect(await index.search("refunds' & !(days | :*", { maxResults: 3 })).toHaveLength(1);
    expect(await index.search('   ', { maxResults: 3 })).toEqual([]);
    await index.clear();
  });

  it('runs one sync of an index at a time', async () => {
    const documents = [
      doc('a.md', 'A', 'Refunds are possible within 14 days.'),
      doc('b.md', 'B', 'Invoices go out monthly.'),
    ];
    const reports = await Promise.all([open('race').sync(documents), open('race').sync(documents)]);
    expect(reports.map((report) => report.embeddedChunks).sort()).toEqual([0, 2]);
    expect(reports.map((report) => report.unchanged).sort()).toEqual([0, 2]);
    await open('race').clear();
  });

  it('reports the database, the extension, the schema and the index', async () => {
    const index = open('diagnosed');
    await index.sync([doc('a.md', 'A', 'Refunds are possible within 14 days.')]);
    const checks = Object.fromEntries((await index.diagnose()).map((check) => [check.id, check]));
    expect(checks['knowledge.reachable']?.ok).toBe(true);
    expect(checks['knowledge.pgvector']?.detail).toMatch(/^pgvector \d+\.\d+/);
    expect(checks['knowledge.schema']).toEqual({
      id: 'knowledge.schema',
      ok: true,
      detail: 'Schema version 1.',
    });
    expect(checks['knowledge.synced']).toEqual({
      id: 'knowledge.synced',
      ok: true,
      detail: '1 documents, 1 chunks',
    });
    expect(checks['knowledge.embedder']?.ok).toBe(true);
    await index.clear();
  });

  it("lets a user that doesn't own the tables sync once the owner made the index", async () => {
    const role = `askdare_test_app_${randomBytes(6).toString('hex')}`;
    await schema.pool.query(`create role ${role} login`);
    const url = new URL(schema.url);
    url.username = role;
    const app = new Pool({ connectionString: url.toString() });
    try {
      await schema.pool.query(`grant usage on schema ${schema.name} to ${role}`);
      await schema.pool.query(
        `grant select, insert, update, delete on all tables in schema ${schema.name} to ${role}`,
      );
      const documents = [doc('a.md', 'A', 'Refunds are possible within 14 days.')];
      const asApp = pgvectorIndex({ pool: app, indexId: 'owned', embedder: fakeEmbedder() });
      await expect(asApp.sync(documents)).rejects.toThrow('sync as the database user that runs');
      await open('owned').sync(documents);
      const edited = [doc('a.md', 'A', 'Refunds are possible within 30 days.')];
      expect((await asApp.sync(edited)).changed).toEqual(['a.md']);
      expect((await asApp.search('refunds', { maxResults: 1 }))[0]?.text).toContain('30 days');
      await open('owned').clear();
    } finally {
      await app.end();
      await schema.pool.query(`drop owned by ${role}`);
      await schema.pool.query(`drop role ${role}`);
    }
  });

  it('says to migrate when the tables are missing', async () => {
    const bare = await createTestSchema();
    try {
      const index = pgvectorIndex({ pool: bare.pool, embedder: fakeEmbedder() });
      await expect(index.sync([])).rejects.toThrow('run `npx askdare-postgres migrate`');
      await expect(index.search('x', { maxResults: 1 })).rejects.toThrow('migrate');
      const checks = await index.diagnose();
      expect(checks.find((check) => check.id === 'knowledge.schema')).toMatchObject({
        ok: false,
        detail: 'Schema version 0 of 1: run `npx askdare-postgres migrate`.',
      });
      expect(checks.find((check) => check.id === 'knowledge.synced')?.ok).toBe(false);
    } finally {
      await bare.drop();
    }
  });

  it('reports an unreachable database as a failed check', async () => {
    const index = pgvectorIndex({
      url: 'postgres://askdare@127.0.0.1:1/askdare',
      embedder: fakeEmbedder(),
    });
    const checks = await index.diagnose();
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ id: 'knowledge.reachable', ok: false });
  });
});
