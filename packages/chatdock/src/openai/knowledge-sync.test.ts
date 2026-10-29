import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import OpenAI from 'openai';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type LocalDocument,
  planSync,
  type RemoteDocument,
  scanDirectory,
  syncKnowledge,
} from './knowledge-sync';
import { OPENAI_TEST_BASE_URL } from './testing/msw';

const doc = (path: string, sha256: string, extra: Partial<LocalDocument> = {}): LocalDocument => ({
  path,
  absolutePath: `/kb/${path}`,
  sha256,
  title: path,
  url: undefined,
  ...extra,
});
const remote = (
  fileId: string,
  path: string,
  sha256: string,
  extra: Partial<RemoteDocument> = {},
): RemoteDocument => ({
  fileId,
  path,
  sha256,
  title: path,
  url: undefined,
  ...extra,
});

describe('planSync', () => {
  it('uploads new files, keeps unchanged ones and is a no-op when in sync', () => {
    const plan = planSync([doc('a.md', '1'), doc('b.md', '2')], [remote('f-a', 'a.md', '1')]);
    expect(plan.upload.map((item) => item.path)).toEqual(['b.md']);
    expect(plan.unchanged).toBe(1);
    expect(plan.remove).toEqual([]);

    const again = planSync([doc('a.md', '1')], [remote('f-a', 'a.md', '1')]);
    expect(again).toMatchObject({ upload: [], retag: [], remove: [], unchanged: 1 });
  });

  it('replaces changed content and removes deleted files', () => {
    const plan = planSync(
      [doc('a.md', 'new')],
      [remote('f-old', 'a.md', 'old'), remote('f-gone', 'gone.md', '9')],
    );
    expect(plan.upload.map((item) => item.path)).toEqual(['a.md']);
    expect(plan.remove.map((item) => item.fileId).sort()).toEqual(['f-gone', 'f-old']);
  });

  it('only retags when the title or URL changed', () => {
    const plan = planSync(
      [doc('a.md', '1', { title: 'Pricing', url: 'https://example.com/pricing' })],
      [remote('f-a', 'a.md', '1', { title: 'Old title' })],
    );
    expect(plan.retag).toEqual([
      { document: expect.objectContaining({ path: 'a.md' }), fileId: 'f-a' },
    ]);
    expect(plan.upload).toEqual([]);
  });

  it('removes duplicate copies and leaves files it did not upload alone', () => {
    const plan = planSync(
      [doc('a.md', '1')],
      [
        remote('f-1', 'a.md', '1'),
        remote('f-2', 'a.md', '1'),
        {
          fileId: 'f-foreign',
          path: undefined,
          sha256: undefined,
          title: undefined,
          url: undefined,
        },
      ],
    );
    expect(plan.remove.map((item) => item.fileId)).toEqual(['f-2']);
    expect(plan.unmanaged).toBe(1);
  });
});

describe('scanDirectory', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'chatdock-kb-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads titles and URLs from front matter or the manifest and skips other files', async () => {
    await mkdir(join(root, 'guides'));
    await writeFile(
      join(root, 'guides', 'pricing.md'),
      '---\ntitle: "Pricing"\nurl: https://example.com/pricing\n---\n# Plans\n',
    );
    await writeFile(join(root, 'handbook.pdf'), '%PDF-1.4 fake');
    await writeFile(join(root, 'notes.txt'), 'plain');
    await writeFile(join(root, 'logo.png'), 'png');
    await writeFile(join(root, '.secret.md'), 'hidden');
    await writeFile(
      join(root, 'chatdock.kb.json'),
      JSON.stringify({
        'handbook.pdf': { title: 'Team handbook', url: 'https://example.com/handbook' },
      }),
    );
    const { documents, skipped } = await scanDirectory(root);
    expect(documents.map(({ path, title, url }) => ({ path, title, url }))).toEqual([
      { path: 'guides/pricing.md', title: 'Pricing', url: 'https://example.com/pricing' },
      { path: 'handbook.pdf', title: 'Team handbook', url: 'https://example.com/handbook' },
      { path: 'notes.txt', title: 'notes', url: undefined },
    ]);
    expect(skipped).toEqual(['logo.png']);
    expect(documents[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects URLs that are not http(s)', async () => {
    await writeFile(join(root, 'bad.md'), '---\nurl: javascript:alert(1)\n---\n');
    await expect(scanDirectory(root)).rejects.toThrow(/bad\.md: url must be an http\(s\) URL/);
  });
});

describe('syncKnowledge', () => {
  const server = setupServer();
  let client: OpenAI;
  let root: string;
  let calls: string[];
  let storeFiles: Record<string, unknown>[];
  beforeAll(() => {
    server.listen({ onUnhandledFrame: 'error' });
    client = new OpenAI({ apiKey: 'sk-test', baseURL: OPENAI_TEST_BASE_URL, maxRetries: 0 });
  });
  afterAll(() => server.close());
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'chatdock-kb-'));
    calls = [];
    storeFiles = [];
    let uploads = 0;
    const record = (label: string) => calls.push(label);
    server.use(
      http.get(`${OPENAI_TEST_BASE_URL}/vector_stores/vs_1/files`, () =>
        HttpResponse.json({
          object: 'list',
          data: storeFiles,
          first_id: null,
          last_id: null,
          has_more: false,
        }),
      ),
      http.post(`${OPENAI_TEST_BASE_URL}/vector_stores`, () => {
        record('create store');
        return HttpResponse.json({
          id: 'vs_new',
          object: 'vector_store',
          name: 'kb',
          status: 'completed',
        });
      }),
      http.post(`${OPENAI_TEST_BASE_URL}/files`, () => {
        uploads += 1;
        record(`upload file-${uploads}`);
        return HttpResponse.json({
          id: `file-${uploads}`,
          object: 'file',
          purpose: 'assistants',
          status: 'processed',
        });
      }),
      http.post(
        `${OPENAI_TEST_BASE_URL}/vector_stores/:store/files`,
        async ({ request, params }) => {
          const body = (await request.json()) as {
            file_id: string;
            attributes: Record<string, string>;
          };
          record(`attach ${body.file_id} ${body.attributes['path']}`);
          storeFiles.push({
            id: body.file_id,
            object: 'vector_store.file',
            status: 'completed',
            attributes: body.attributes,
          });
          return HttpResponse.json({
            id: body.file_id,
            object: 'vector_store.file',
            status: 'in_progress',
            vector_store_id: params['store'],
          });
        },
      ),
      http.get(`${OPENAI_TEST_BASE_URL}/vector_stores/:store/files/:file`, ({ params }) =>
        HttpResponse.json({
          id: params['file'],
          object: 'vector_store.file',
          status: 'completed',
          last_error: null,
        }),
      ),
      http.post(`${OPENAI_TEST_BASE_URL}/vector_stores/vs_1/files/:file`, ({ params }) => {
        record(`retag ${params['file']}`);
        return HttpResponse.json({
          id: params['file'],
          object: 'vector_store.file',
          status: 'completed',
        });
      }),
      http.delete(`${OPENAI_TEST_BASE_URL}/vector_stores/vs_1/files/:file`, ({ params }) => {
        record(`detach ${params['file']}`);
        return HttpResponse.json({
          id: params['file'],
          deleted: true,
          object: 'vector_store.file.deleted',
        });
      }),
      http.delete(`${OPENAI_TEST_BASE_URL}/files/:file`, ({ params }) => {
        record(`delete ${params['file']}`);
        return HttpResponse.json({ id: params['file'], deleted: true, object: 'file' });
      }),
    );
  });
  afterEach(async () => {
    server.resetHandlers();
    await rm(root, { recursive: true, force: true });
  });

  it('creates a store on first run, then does nothing on the second', async () => {
    await writeFile(join(root, 'faq.md'), '---\ntitle: FAQ\n---\nQ&A');
    const first = await syncKnowledge(client, { root });
    expect(first).toMatchObject({ vectorStoreId: 'vs_new', created: true, failed: [] });
    expect(calls).toEqual(['create store', 'upload file-1', 'attach file-1 faq.md']);

    calls = [];
    const second = await syncKnowledge(client, { root, vectorStoreId: 'vs_1' });
    expect(second.plan).toMatchObject({ upload: [], retag: [], remove: [], unchanged: 1 });
    expect(calls).toEqual([]);
  });

  it('replaces changed files and deletes removed ones, file included', async () => {
    await writeFile(join(root, 'faq.md'), 'new content');
    storeFiles.push(
      {
        id: 'file-old',
        object: 'vector_store.file',
        status: 'completed',
        attributes: { path: 'faq.md', sha256: 'stale', title: 'faq' },
      },
      {
        id: 'file-gone',
        object: 'vector_store.file',
        status: 'completed',
        attributes: { path: 'gone.md', sha256: 'x', title: 'gone' },
      },
    );
    await syncKnowledge(client, { root, vectorStoreId: 'vs_1' });
    expect(calls).toEqual(
      expect.arrayContaining([
        'upload file-1',
        'attach file-1 faq.md',
        'detach file-old',
        'delete file-old',
        'detach file-gone',
        'delete file-gone',
      ]),
    );
  });

  it('changes nothing in a dry run', async () => {
    await writeFile(join(root, 'faq.md'), 'content');
    const result = await syncKnowledge(client, { root, vectorStoreId: 'vs_1', dryRun: true });
    expect(result.plan.upload).toHaveLength(1);
    expect(calls).toEqual([]);
  });
});
