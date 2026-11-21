import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncOptions, SyncResult } from '../openai/knowledge-sync';
import { KB_USAGE, kbSync } from './kb-sync';
import { UsageError } from './usage';

const sync = vi.hoisted(() => vi.fn());

// The OpenAI side has its own tests (knowledge-sync.test.ts); here only the command matters.
vi.mock('../openai/knowledge-sync', () => ({ syncKnowledgeFolder: sync }));

const ENV_KEYS = ['OPENAI_API_KEY', 'KB_VECTOR_STORE_ID'] as const;

let folder: string;
let cwd: string;
let saved: Record<string, string | undefined>;
let out: string[];
let err: string[];

function result(overrides: Partial<SyncResult> = {}): SyncResult {
  return {
    vectorStoreId: 'vs_existing',
    created: false,
    plan: { upload: [], retag: [], remove: [], unchanged: 0, unmanaged: 0 },
    skipped: [],
    failed: [],
    ...overrides,
  } as SyncResult;
}

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'askdare-kb-'));
  cwd = process.cwd();
  // No .env.local or .env of the repo gets loaded.
  process.chdir(folder);
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  process.env['OPENAI_API_KEY'] = 'sk-test-shell';
  out = [];
  err = [];
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => void out.push(String(line)));
  vi.spyOn(console, 'error').mockImplementation((line: unknown) => void err.push(String(line)));
  sync.mockReset();
  sync.mockResolvedValue(result());
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

const options = (): SyncOptions => sync.mock.calls[0]?.[1] as SyncOptions;

describe('kb sync arguments', () => {
  it('prints its help without syncing', async () => {
    expect(await kbSync(['--help'])).toBe(0);
    expect(out).toEqual([KB_USAGE]);
    expect(sync).not.toHaveBeenCalled();
  });

  it('needs exactly one folder', async () => {
    await expect(kbSync([])).rejects.toThrow(new UsageError('Expected exactly one folder.'));
    await expect(kbSync(['a', 'b'])).rejects.toThrow('Expected exactly one folder.');
    expect(sync).not.toHaveBeenCalled();
  });

  it('rejects an unknown option', async () => {
    await expect(kbSync(['docs', '--force'])).rejects.toMatchObject({
      code: 'ERR_PARSE_ARGS_UNKNOWN_OPTION',
    });
  });

  it('needs OPENAI_API_KEY', async () => {
    delete process.env['OPENAI_API_KEY'];
    await expect(kbSync(['docs'])).rejects.toThrow('OPENAI_API_KEY is not set.');
  });

  it('syncs the folder, resolved from the current one, into the store from the environment', async () => {
    process.env['KB_VECTOR_STORE_ID'] = 'vs_from_env';
    expect(await kbSync(['docs'])).toBe(0);
    expect(sync).toHaveBeenCalledWith('sk-test-shell', expect.anything());
    expect(options()).toMatchObject({
      root: join(process.cwd(), 'docs'),
      vectorStoreId: 'vs_from_env',
      dryRun: false,
    });
    expect(options()).not.toHaveProperty('name');
  });

  it('prefers --store and passes --name and --dry-run', async () => {
    process.env['KB_VECTOR_STORE_ID'] = 'vs_from_env';
    await kbSync(['docs', '--store', 'vs_flag', '--name', 'Help center', '--dry-run']);
    expect(options()).toMatchObject({
      vectorStoreId: 'vs_flag',
      name: 'Help center',
      dryRun: true,
    });
  });

  it('creates a store when none is given (an empty KB_VECTOR_STORE_ID counts as none)', async () => {
    process.env['KB_VECTOR_STORE_ID'] = '';
    await kbSync(['docs']);
    expect(options().vectorStoreId).toBeUndefined();
  });

  it('rejects a store ID that is not a vector store', async () => {
    await expect(kbSync(['docs', '--store', 'file-123'])).rejects.toThrow(
      'The vector store ID must look like vs_….',
    );
    expect(sync).not.toHaveBeenCalled();
  });
});

describe('kb sync environment files', () => {
  it('loads .env.local and .env from the current folder, the shell winning', async () => {
    delete process.env['OPENAI_API_KEY'];
    await writeFile('.env.local', 'OPENAI_API_KEY=sk-test-local\n');
    await writeFile('.env', 'OPENAI_API_KEY=sk-test-dotenv\nKB_VECTOR_STORE_ID=vs_dotenv\n');
    await kbSync(['docs']);
    expect(out[0]).toBe('Loaded .env.local, .env.');
    expect(sync).toHaveBeenCalledWith('sk-test-local', expect.anything());
    expect(options().vectorStoreId).toBe('vs_dotenv');
  });

  it('loads only --env-file when given', async () => {
    delete process.env['OPENAI_API_KEY'];
    await writeFile('.env.local', 'OPENAI_API_KEY=sk-test-local\n');
    await writeFile('kb.env', 'OPENAI_API_KEY=sk-test-file\n');
    await kbSync(['docs', '--env-file', 'kb.env']);
    expect(out[0]).toBe('Loaded kb.env.');
    expect(sync).toHaveBeenCalledWith('sk-test-file', expect.anything());
  });

  it('says nothing about env files when there are none', async () => {
    await kbSync(['docs']);
    expect(out.some((line) => line.startsWith('Loaded'))).toBe(false);
  });
});

describe('kb sync report', () => {
  it('summarises a sync', async () => {
    sync.mockResolvedValue(
      result({
        plan: {
          upload: [{ path: 'a.md' }],
          retag: [],
          remove: [{ fileId: 'file-1', path: 'old.md' }],
          unchanged: 3,
          unmanaged: 0,
        },
      } as unknown as Partial<SyncResult>),
    );
    expect(await kbSync(['docs'])).toBe(0);
    expect(out).toEqual(['Synced: 1 added, 0 retagged, 1 removed, 3 unchanged.']);
  });

  it('lists each change in a dry run', async () => {
    sync.mockResolvedValue(
      result({
        plan: {
          upload: [{ path: 'new.md' }],
          retag: [{ document: { path: 'moved.md' } }],
          remove: [{ fileId: 'file-1', path: 'old.md' }, { fileId: 'file-2' }],
          unchanged: 0,
          unmanaged: 2,
        },
        skipped: ['logo.png'],
      } as unknown as Partial<SyncResult>),
    );
    await kbSync(['docs', '--dry-run']);
    expect(out).toEqual([
      'Would sync: 1 added, 1 retagged, 2 removed, 0 unchanged.',
      '  + new.md',
      '  ~ moved.md',
      '  - old.md',
      '  - file-2',
      'Skipped (unsupported type): logo.png',
      'Left alone: 2 file(s) in the store not uploaded by askdare.',
    ]);
  });

  it('exits 1 and lists failures', async () => {
    sync.mockResolvedValue(result({ failed: [{ path: 'big.pdf', reason: 'too large' }] }));
    expect(await kbSync(['docs'])).toBe(1);
    expect(err).toEqual(['Failed: big.pdf (too large)']);
  });

  it('tells how to keep a newly created store', async () => {
    sync.mockResolvedValue(result({ created: true, vectorStoreId: 'vs_new' }));
    await kbSync(['docs']);
    expect(out).toContain('  KB_VECTOR_STORE_ID=vs_new');
  });
});
