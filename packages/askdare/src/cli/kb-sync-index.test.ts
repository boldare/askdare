import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEmbedder } from '../knowledge/fake-embedder';
import { memoryKnowledgeIndex, memoryKnowledgeStore } from '../knowledge/memory-index';
import type { KnowledgeIndex } from '../knowledge/port';
import { type PgvectorIndexOptions, POSTGRES_PACKAGE } from './kb-index';
import { type KbSyncDependencies, kbSync } from './kb-sync';
import { UsageError } from './usage';

const ENV_KEYS = [
  'OPENAI_API_KEY',
  'DATABASE_URL',
  'ASKDARE_EMBEDDING_MODEL',
  'ASKDARE_EMBEDDING_DIMENSIONS',
  'KB_VECTOR_STORE_ID',
] as const;

let folder: string;
let cwd: string;
let saved: Record<string, string | undefined>;
let out: string[];
let err: string[];
let store: ReturnType<typeof memoryKnowledgeStore>;
let opened: PgvectorIndexOptions[];
let closed: number;

/** k1's in-memory index in place of the add-on's `pgvectorIndex`, sharing one store across runs. */
const dependencies = (): KbSyncDependencies => ({
  load: async (specifier) => {
    expect(specifier).toBe(POSTGRES_PACKAGE);
    return {
      pgvectorIndex: (options: PgvectorIndexOptions): KnowledgeIndex => {
        opened.push(options);
        const index = memoryKnowledgeIndex({
          embedder: options.embedder,
          indexId: options.indexId,
          store,
        });
        const close = async (): Promise<void> => {
          closed += 1;
        };
        return Object.assign(index, { close });
      },
    };
  },
  embedder: ({ model, dimensions }) =>
    fakeEmbedder({ dimensions, id: `fake:${model}:${dimensions}` }),
});

const PRICING = `---
title: Pricing
url: https://example.com/pricing
---
# Plans

Pro costs 10 USD a month. Business costs 30 USD a month.

# Billing

Paying yearly saves 20%. Invoices go out on the first day of the month.
`;

const docs = (...parts: string[]) => join(folder, 'kb', ...parts);

async function run(...extra: string[]): Promise<number> {
  out = [];
  err = [];
  return kbSync(['kb', '--index', 'support', ...extra], dependencies());
}

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'askdare-kb-index-'));
  cwd = process.cwd();
  process.chdir(folder);
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  process.env['OPENAI_API_KEY'] = 'sk-test-shell';
  process.env['DATABASE_URL'] = 'postgres://askdare@127.0.0.1:1/askdare';
  process.env['ASKDARE_EMBEDDING_MODEL'] = 'model-a';
  process.env['ASKDARE_EMBEDDING_DIMENSIONS'] = '32';
  out = [];
  err = [];
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => void out.push(String(line)));
  vi.spyOn(console, 'error').mockImplementation((line: unknown) => void err.push(String(line)));
  store = memoryKnowledgeStore();
  opened = [];
  closed = 0;
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
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
  await rm(folder, { recursive: true, force: true });
});

describe('kb sync --index', () => {
  it('embeds every chunk on the first sync and builds the index from the environment', async () => {
    expect(await run()).toBe(0);
    expect(opened).toEqual([
      {
        url: 'postgres://askdare@127.0.0.1:1/askdare',
        indexId: 'support',
        embedder: expect.objectContaining({ id: 'fake:model-a:32', dimensions: 32 }),
      },
    ]);
    expect(closed).toBe(1);
    expect(out[0]).toBe(
      'Synced to the index "support": 3 added, 0 changed, 0 removed, 0 unchanged.',
    );
    expect(out[1]).toMatch(/^Embedded 4 chunks \(\d+ tokens\), reused 0 chunks\.$/);
    expect(out.slice(2)).toEqual(['  + about.html', '  + guides/pricing.md', '  + mobile.md']);
    expect(err).toEqual([]);
  });

  it('changes and embeds nothing when nothing changed', async () => {
    await run();
    expect(await run()).toBe(0);
    expect(out).toEqual([
      'Synced to the index "support": 0 added, 0 changed, 0 removed, 3 unchanged.',
      'Embedded 0 chunks (0 tokens), reused 0 chunks.',
    ]);
  });

  it('re-embeds only the edited paragraph', async () => {
    await run();
    const pricing = docs('guides', 'pricing.md');
    await writeFile(pricing, (await readFile(pricing, 'utf8')).replace('20%', '25%'));
    await run();
    expect(out[0]).toBe(
      'Synced to the index "support": 0 added, 1 changed, 0 removed, 2 unchanged.',
    );
    expect(out[1]).toMatch(/^Embedded 1 chunk \(\d+ tokens\), reused 1 chunk\.$/);
    expect(out[2]).toBe('  ~ guides/pricing.md');
  });

  it('re-embeds nothing for a renamed file', async () => {
    await run();
    await rename(docs('mobile.md'), docs('mobile-apps.md'));
    await run();
    expect(out).toEqual([
      'Synced to the index "support": 1 added, 0 changed, 1 removed, 2 unchanged.',
      'Embedded 0 chunks (0 tokens), reused 1 chunk.',
      '  + mobile-apps.md',
      '  - mobile.md',
    ]);
  });

  it('re-embeds a renamed file whose title comes from its name, as the title is in every chunk', async () => {
    await run();
    await rename(docs('about.html'), docs('company.html'));
    await run();
    expect(out[1]).toMatch(/^Embedded 1 chunk \(\d+ tokens\), reused 0 chunks\.$/);
  });

  it('removes a deleted file', async () => {
    await run();
    await rm(docs('about.html'));
    await run();
    expect(out).toEqual([
      'Synced to the index "support": 0 added, 0 changed, 1 removed, 2 unchanged.',
      'Embedded 0 chunks (0 tokens), reused 0 chunks.',
      '  - about.html',
    ]);
    const index = memoryKnowledgeIndex({ embedder: fakeEmbedder(), indexId: 'support', store });
    expect(await index.diagnose()).toContainEqual(
      expect.objectContaining({ id: 'knowledge.synced', detail: '2 documents, 3 chunks' }),
    );
  });

  it('skips formats the index can’t read, with a warning, and syncs the rest', async () => {
    await writeFile(docs('handbook.pdf'), '%PDF-1.4 fake');
    await writeFile(docs('faq.json'), '{"q":"a"}');
    await writeFile(docs('app.html'), '<script>render()</script>');
    expect(await run()).toBe(0);
    expect(out[0]).toMatch(/: 3 added,/);
    expect(err).toEqual([
      "Warning: skipped 2 files the index can't read (it reads .md, .markdown, .mdx, .txt, .html and .htm): faq.json, handbook.pdf",
      'Warning: no text found in app.html; not synced.',
    ]);
  });

  it('re-embeds everything when the embedding model changes', async () => {
    await run();
    process.env['ASKDARE_EMBEDDING_MODEL'] = 'model-b';
    await run();
    expect(out[0]).toBe(
      'Synced to the index "support": 3 added, 0 changed, 0 removed, 0 unchanged.',
    );
    expect(out[1]).toMatch(/^Embedded 4 chunks/);
    await run('--embedding-model', 'model-b', '--dimensions', '64');
    expect(out[1]).toMatch(/^Embedded 4 chunks/);
    expect(opened.at(-1)?.embedder.id).toBe('fake:model-b:64');
  });

  it('shows the documents and chunks in a dry run, without an index, key or database', async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    await writeFile(docs('handbook.pdf'), '%PDF-1.4 fake');
    expect(await run('--dry-run')).toBe(0);
    expect(opened).toEqual([]);
    expect(out).toEqual([
      'Would sync 3 documents (4 chunks) to the index "support". The index decides what changed.',
      '  about.html (1 chunk)',
      '  guides/pricing.md (2 chunks)',
      '  mobile.md (1 chunk)',
    ]);
    expect(err).toHaveLength(1);
  });

  it('refuses a broken document before connecting', async () => {
    await writeFile(docs('bad.md'), '---\nurl: javascript:alert(1)\n---\n# Bad\n\nText.\n');
    await expect(run()).rejects.toThrow(/bad\.md: url must be an http\(s\) URL/);
    expect(opened).toEqual([]);
  });

  it('closes the index when the sync fails', async () => {
    const failing: KbSyncDependencies = {
      ...dependencies(),
      embedder: () => ({
        id: 'fake:model-a:32',
        dimensions: 32,
        embed: () => Promise.reject(new Error('rate limited')),
      }),
    };
    await expect(kbSync(['kb', '--index', 'support'], failing)).rejects.toThrow('rate limited');
    expect(closed).toBe(1);
  });
});

describe('kb sync --index arguments', () => {
  it.each([
    [['--store', 'vs_1'], '--index syncs your own index: leave out --store and --name.'],
    [['--name', 'Help'], '--index syncs your own index: leave out --store and --name.'],
  ])('rejects %j next to --index', async (extra, message) => {
    await expect(run(...extra)).rejects.toThrow(new UsageError(message));
  });

  it('rejects the embedding options without --index', async () => {
    await expect(kbSync(['kb', '--dimensions', '32'], dependencies())).rejects.toThrow(
      '--embedding-model and --dimensions go with --index.',
    );
  });

  it('rejects an index ID that is not a plain name', async () => {
    await expect(kbSync(['kb', '--index', '../x'], dependencies())).rejects.toThrow(
      /The index ID must be 1 to 64 letters/,
    );
  });

  it('needs a model and dimensions, with no default model', async () => {
    delete process.env['ASKDARE_EMBEDDING_MODEL'];
    await expect(run()).rejects.toThrow(/--index needs an embedding model/);
    process.env['ASKDARE_EMBEDDING_MODEL'] = 'model-a';
    delete process.env['ASKDARE_EMBEDDING_DIMENSIONS'];
    await expect(run()).rejects.toThrow(/--index needs the vector size/);
    await expect(run('--dimensions', '1.5')).rejects.toThrow(
      '--dimensions must be a positive whole number.',
    );
  });

  it('needs OPENAI_API_KEY and DATABASE_URL', async () => {
    delete process.env['DATABASE_URL'];
    await expect(run()).rejects.toThrow(/--index needs DATABASE_URL/);
    delete process.env['OPENAI_API_KEY'];
    await expect(run()).rejects.toThrow('OPENAI_API_KEY is not set.');
  });

  it('says how to install the add-on when it is missing', async () => {
    const missing: KbSyncDependencies = {
      ...dependencies(),
      load: () =>
        Promise.reject(
          Object.assign(new Error(`Cannot find package '${POSTGRES_PACKAGE}'`), {
            code: 'ERR_MODULE_NOT_FOUND',
          }),
        ),
    };
    await expect(kbSync(['kb', '--index', 'support'], missing)).rejects.toThrow(
      new UsageError(
        `kb sync --index needs ${POSTGRES_PACKAGE} in this project: npm install ${POSTGRES_PACKAGE}`,
      ),
    );
  });

  it('says when the installed add-on has no pgvectorIndex', async () => {
    const old: KbSyncDependencies = { ...dependencies(), load: async () => ({ migrate() {} }) };
    await expect(kbSync(['kb', '--index', 'support'], old)).rejects.toThrow(
      /has no pgvectorIndex: update it/,
    );
  });
});
