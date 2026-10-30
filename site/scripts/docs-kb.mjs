// Syncs the published docs to the vector store behind the docs chat (bot "docs" in
// askdare.config.ts), with a title and a link to the docs site for each citation. Run it from the
// repository root whenever docs/ changes; it costs a few cents of OpenAI file storage:
//   SITE_URL=https://<docs site> node site/scripts/docs-kb.mjs
// It reads OPENAI_API_KEY and DOCS_VECTOR_STORE_ID from site/.env.local. Without a store ID it
// creates one and prints it: set it as DOCS_VECTOR_STORE_ID, here and where the site runs.
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const docs = join(site, '../docs');
const base = (process.env.SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
/** Contributor-only, as on the site and in the package. */
const UNPUBLISHED = new Set(['live-testing.md']);

const folder = mkdtempSync(join(tmpdir(), 'askdare-docs-'));
mkdirSync(join(folder, 'adr'));
const entries = {};
const add = (relative, slug) => {
  copyFileSync(join(docs, relative), join(folder, relative));
  const title = /^# (.+)$/m.exec(readFileSync(join(docs, relative), 'utf8'))?.[1] ?? slug;
  entries[relative] = { title, url: `${base}/docs/${slug}` };
};
for (const name of readdirSync(docs)) {
  if (name.endsWith('.md') && !UNPUBLISHED.has(name)) add(name, name.slice(0, -3));
}
for (const name of readdirSync(join(docs, 'adr'))) {
  if (name.endsWith('.md'))
    add(`adr/${name}`, name === 'README.md' ? 'adr' : `adr/${name.slice(0, -3)}`);
}
writeFileSync(join(folder, 'askdare.kb.json'), `${JSON.stringify(entries, null, 2)}\n`);

const store = process.env.DOCS_VECTOR_STORE_ID;
const result = spawnSync(
  join(site, 'node_modules/.bin/askdare'),
  [
    'kb',
    'sync',
    folder,
    '--env-file',
    join(site, '.env.local'),
    '--name',
    'askdare docs',
    ...(store ? ['--store', store] : []),
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
