// Syncs the published docs to the vector store behind the docs chat (bot "docs" in
// askdare.config.ts), with a title and a link to the docs site for each citation. Run it from the
// repository root whenever docs/ changes; it costs a few cents of OpenAI file storage:
//   SITE_URL=https://<docs site> node site/scripts/docs-kb.mjs [--env-file <file>] [--dry-run]
// OPENAI_API_KEY and DOCS_VECTOR_STORE_ID come from the environment or the env file (default
// site/.env.local). Without a store ID it creates one and prints it: set it as
// DOCS_VECTOR_STORE_ID, here and where the site runs.
//
// Only the key reaches `kb sync`, never the env file itself: its KB_VECTOR_STORE_ID (the demo's
// store) would otherwise be the default, and a sync makes the store mirror the docs, deleting
// everything else in it.
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const docs = join(site, '../docs');
const { values } = parseArgs({
  options: { 'env-file': { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
});
const envFile = resolve(values['env-file'] ?? join(site, '.env.local'));
const fromFile = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
const key = process.env.OPENAI_API_KEY || fromFile.OPENAI_API_KEY;
const store = process.env.DOCS_VECTOR_STORE_ID || fromFile.DOCS_VECTOR_STORE_ID;
if (!key) {
  console.error(`OPENAI_API_KEY is not set, here or in ${envFile}.`);
  process.exit(1);
}
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
  if (name.endsWith('.md')) {
    add(`adr/${name}`, name === 'README.md' ? 'adr' : `adr/${name.slice(0, -3)}`);
  }
}
writeFileSync(join(folder, 'askdare.kb.json'), `${JSON.stringify(entries, null, 2)}\n`);

// An empty working folder: `kb sync` finds no .env files to load there.
const cwd = mkdtempSync(join(tmpdir(), 'askdare-docs-cwd-'));
const result = spawnSync(
  join(site, 'node_modules/.bin/askdare'),
  [
    'kb',
    'sync',
    folder,
    '--name',
    'askdare docs',
    ...(store ? ['--store', store] : []),
    ...(values['dry-run'] ? ['--dry-run'] : []),
  ],
  {
    cwd,
    stdio: 'inherit',
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      OPENAI_API_KEY: key,
      ...(process.env.OPENAI_BASE_URL ? { OPENAI_BASE_URL: process.env.OPENAI_BASE_URL } : {}),
    },
  },
);
if (!store && result.status === 0 && !values['dry-run']) {
  console.log(
    '\nFor the docs chat, set the ID above as DOCS_VECTOR_STORE_ID (not KB_VECTOR_STORE_ID).',
  );
}
process.exit(result.status ?? 1);
