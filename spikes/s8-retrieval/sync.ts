/**
 * Q2 (sync): first sync, a no-op re-sync, a re-sync after editing one paragraph, a rename and a
 * delete, all on a temporary copy of the fixtures. Then syncs the eval index. `pnpm sync`.
 */
import { appendFile, cp, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { EMBEDDING_DIMENSIONS, EMBEDDING_PRICE, client, openAIEmbedder } from './openai.ts';
import { migrate, PgKnowledgeIndex } from './pg-index.ts';
import { scanFolder } from './scan.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures/knowledge');
const pool = new pg.Pool({ connectionString: 'postgres://s8:s8@127.0.0.1:54328/s8' });
await migrate(pool, EMBEDDING_DIMENSIONS);
const embedder = openAIEmbedder(client());
const results: Record<string, unknown> = {};

async function step(label: string, index: PgKnowledgeIndex, root: string): Promise<void> {
  const started = performance.now();
  const documents = await scanFolder(root);
  const report = await index.sync(documents);
  const ms = Math.round(performance.now() - started);
  results[label] = { ...report, ms, usd: (report.embeddingTokens / 1e6) * EMBEDDING_PRICE };
  console.log(
    `${label.padEnd(22)} +${report.added.length} ~${report.changed.length} -${report.removed.length} =${report.unchanged}` +
      ` embedded ${report.embeddedChunks} reused ${report.reusedChunks} tokens ${report.embeddingTokens} ${ms} ms`,
  );
}

const work = await mkdtemp(join(tmpdir(), 's8-sync-'));
try {
  await cp(FIXTURES, work, { recursive: true });
  const index = new PgKnowledgeIndex({ pool, indexId: 's8-sync-test', embedder });
  await index.clear();
  await step('first sync', index, work);
  await step('no-op re-sync', index, work);
  const pricing = join(work, 'pricing.md');
  await writeFile(pricing, (await readFile(pricing, 'utf8')).replace('Paying yearly saves 20%', 'Paying yearly saves 25%'));
  await step('edit one paragraph', index, work);
  await appendFile(join(work, 'api.md'), '\n## SDKs\n\nOfficial SDKs exist for TypeScript and Python.\n');
  await step('append a section', index, work);
  await rename(join(work, 'mobile.md'), join(work, 'mobile-apps.md'));
  await step('rename a file', index, work);
  await rm(join(work, 'community-faq.md'));
  await step('delete a file', index, work);
  console.log('diagnose', await index.diagnose());
  await index.clear();
} finally {
  await rm(work, { recursive: true, force: true });
}

const evalIndex = new PgKnowledgeIndex({ pool, indexId: 's8-eval', embedder });
await step('eval index', evalIndex, FIXTURES);
const chunks = await pool.query<{ n: string; avg: string; max: string }>(
  "select count(*) n, avg(length(text))::int avg, max(length(text)) max from kb_chunks where index_id = 's8-eval'",
);
results['eval chunks'] = chunks.rows[0];
console.log('eval chunks', chunks.rows[0]);
await writeFile(join(import.meta.dirname, 'results-sync.json'), `${JSON.stringify(results, null, 2)}\n`);
await pool.end();
