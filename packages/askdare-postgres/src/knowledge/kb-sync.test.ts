import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
// The CLI lives in core; until k2 exports the port, its pieces come by relative path here too.
import { kbSync } from '../../../askdare/src/cli/kb-sync';
import { fakeEmbedder } from '../../../askdare/src/knowledge/fake-embedder';
import { migrate, pgvectorIndex } from '../index';
import { createTestSchema, TEST_DATABASE_URL, type TestSchema } from '../testing/database';

const ENV = {
  OPENAI_API_KEY: 'sk-test-unused',
  ASKDARE_EMBEDDING_MODEL: 'model-a',
  ASKDARE_EMBEDDING_DIMENSIONS: '32',
} as const;

const PRICING = `---
title: Pricing
---
# Plans

Pro costs 10 USD a month. Business costs 30 USD a month.

# Billing

Paying yearly saves 20%. Invoices go out on the first day of the month.
`;

/**
 * `askdare kb sync --index` end to end: the CLI reads a folder, loads this add-on's
 * `pgvectorIndex` and syncs it into Postgres. Only the embedder is fake, so nothing is spent.
 */
describe.skipIf(!TEST_DATABASE_URL)('askdare kb sync --index against Postgres', () => {
  const embedder = fakeEmbedder({ dimensions: 32, id: 'fake:model-a:32' });
  let schema: TestSchema;
  let folder: string;
  let cwd: string;
  let saved: Record<string, string | undefined>;
  let out: string[];
  let err: string[];

  const docs = (...parts: string[]) => join(folder, 'kb', ...parts);

  async function sync(): Promise<number> {
    out = [];
    err = [];
    return kbSync(['kb', '--index', 'support'], {
      // The add-on as the CLI would load it from the project, from source.
      load: async () => import('../index'),
      embedder: ({ model, dimensions }) =>
        fakeEmbedder({ dimensions, id: `fake:${model}:${dimensions}` }),
    });
  }

  beforeAll(async () => {
    schema = await createTestSchema();
    await migrate({ pool: schema.pool });
  });

  afterAll(async () => {
    await schema.drop();
  });

  beforeEach(async () => {
    // A folder of its own, so no .env.local or .env of the repository is loaded.
    folder = await mkdtemp(join(tmpdir(), 'askdare-postgres-kb-'));
    cwd = process.cwd();
    process.chdir(folder);
    const keys = [...Object.keys(ENV), 'DATABASE_URL'];
    saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    Object.assign(process.env, ENV, { DATABASE_URL: schema.url });
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => void out.push(String(line)));
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => void err.push(String(line)));
    await mkdir(docs('guides'), { recursive: true });
    await writeFile(docs('guides', 'pricing.md'), PRICING);
    await writeFile(
      docs('mobile.md'),
      '---\ntitle: Mobile apps\n---\n# Mobile\n\nThe app runs on iOS and Android.\n',
    );
    await writeFile(docs('about.html'), '<h1>About</h1><p>We build chat for websites.</p>');
  });

  afterEach(async () => {
    process.chdir(cwd);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.restoreAllMocks();
    await rm(folder, { recursive: true, force: true });
    await pgvectorIndex({ pool: schema.pool, indexId: 'support', embedder }).clear();
  });

  it('syncs a folder, searches it, and syncs only what changed', async () => {
    expect(await sync()).toBe(0);
    expect(out[0]).toBe(
      'Synced to the index "support": 3 added, 0 changed, 0 removed, 0 unchanged.',
    );
    expect(out[1]).toMatch(/^Embedded 4 chunks \(\d+ tokens\), reused 0 chunks\.$/);
    expect(err).toEqual([]);

    const index = pgvectorIndex({ pool: schema.pool, indexId: 'support', embedder });
    const [first] = await index.search('how much does paying yearly save', { maxResults: 3 });
    expect(first).toMatchObject({ path: 'guides/pricing.md', title: 'Pricing' });
    expect(first?.text).toContain('20%');

    const pricing = docs('guides', 'pricing.md');
    await writeFile(pricing, (await readFile(pricing, 'utf8')).replace('20%', '25%'));
    expect(await sync()).toBe(0);
    expect(out).toEqual([
      'Synced to the index "support": 0 added, 1 changed, 0 removed, 2 unchanged.',
      expect.stringMatching(/^Embedded 1 chunk \(\d+ tokens\), reused 1 chunk\.$/),
      '  ~ guides/pricing.md',
    ]);
    const [edited] = await index.search('how much does paying yearly save', { maxResults: 3 });
    expect(edited?.text).toContain('25%');

    const rows = await schema.pool.query<{ chunks: string }>(
      "select count(*) as chunks from askdare_knowledge_chunks where index_id = 'support'",
    );
    expect(rows.rows[0]?.chunks).toBe('4');
  });

  it('touches no table in a dry run', async () => {
    out = [];
    err = [];
    expect(
      await kbSync(['kb', '--index', 'support', '--dry-run'], {
        load: () => Promise.reject(new Error('A dry run loads no add-on.')),
      }),
    ).toBe(0);
    const rows = await schema.pool.query(
      "select 1 from askdare_knowledge_indexes where index_id = 'support'",
    );
    expect(rows.rowCount).toBe(0);
  });
});
