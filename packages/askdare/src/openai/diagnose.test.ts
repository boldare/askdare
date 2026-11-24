import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ModelGateway } from '../gateway';
import { fakeEmbedder } from '../knowledge/fake-embedder';
import { memoryKnowledgeIndex, memoryKnowledgeStore } from '../knowledge/memory-index';
import type { KnowledgeIndex } from '../knowledge/port';
import { createOpenAIGateway } from './gateway';
import { OPENAI_TEST_BASE_URL } from './testing/msw';

const server = setupServer();
let gateway: ModelGateway;
const calls: string[] = [];
beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
  server.events.on('request:start', ({ request }) => {
    calls.push(`${request.method} ${new URL(request.url).pathname.replace('/v1', '')}`);
  });
  gateway = createOpenAIGateway({ apiKey: 'sk-test', baseURL: OPENAI_TEST_BASE_URL });
});
afterEach(() => {
  server.resetHandlers();
  calls.length = 0;
});
afterAll(() => server.close());

const url = (path: string) => `${OPENAI_TEST_BASE_URL}${path}`;
const error = (status: number, code: string, message = 'Incorrect API key provided: sk-ab***yz') =>
  HttpResponse.json({ error: { message, type: 'invalid_request_error', code } }, { status });

/** Every endpoint answering as for a healthy project. */
const healthy = [
  http.get(url('/models/:model'), ({ params }) =>
    HttpResponse.json({ id: params['model'], object: 'model', created: 0, owned_by: 'openai' }),
  ),
  http.post(url('/responses'), () =>
    HttpResponse.json({ id: 'resp_1', object: 'response', status: 'completed', output: [] }),
  ),
  http.post(url('/conversations'), () =>
    HttpResponse.json({ id: 'conv_doc', object: 'conversation', created_at: 0, metadata: {} }),
  ),
  http.delete(url('/conversations/:id'), () =>
    HttpResponse.json({ id: 'conv_doc', object: 'conversation.deleted', deleted: true }),
  ),
  http.get(url('/vector_stores/:id'), ({ params }) =>
    HttpResponse.json({
      id: params['id'],
      object: 'vector_store',
      status: 'completed',
      file_counts: { completed: 12, failed: 0, in_progress: 0, cancelled: 0, total: 12 },
    }),
  ),
  http.post(url('/audio/transcriptions'), () => HttpResponse.json({ text: '' })),
  http.post(url('/files'), () => HttpResponse.json({ id: 'file-doc', object: 'file' })),
  http.delete(url('/files/:id'), () =>
    HttpResponse.json({ id: 'file-doc', object: 'file', deleted: true }),
  ),
];

const everything = {
  model: 'gpt-test',
  vectorStoreId: 'vs_kb',
  transcriptionModel: 'transcribe-test',
  attachments: true,
};

describe('diagnose', () => {
  it('proves each feature with one small request and cleans up after itself', async () => {
    server.use(...healthy);
    const checks = await gateway.diagnose(everything);
    expect(checks.every((check) => check.status === 'ok')).toBe(true);
    expect(checks.map((check) => check.title)).toContain('Vector store vs_kb: 12 documents ready.');
    expect(calls).toEqual([
      'GET /models/gpt-test',
      'POST /responses',
      'POST /conversations',
      'DELETE /conversations/conv_doc',
      'GET /vector_stores/vs_kb',
      'GET /models/transcribe-test',
      'POST /audio/transcriptions',
      'POST /files',
      'DELETE /files/file-doc',
    ]);
  });

  it("reports the bot's own index through its diagnose()", async () => {
    server.use(...healthy);
    const index = memoryKnowledgeIndex({ embedder: fakeEmbedder(), store: memoryKnowledgeStore() });
    const checks = await gateway.diagnose({
      model: 'gpt-test',
      knowledgeIndex: index,
      attachments: false,
    });
    expect(checks.slice(-1)).toEqual([
      {
        status: 'fail',
        title: 'Knowledge index: Never synced: run `askdare kb sync`.',
        fix: 'Run `npx @boldare/askdare kb sync <folder> --index <id>` with the embedder the bot uses.',
      },
    ]);
    const broken: KnowledgeIndex = {
      ...index,
      diagnose: () => Promise.reject(new Error('connect ECONNREFUSED')),
    };
    const failed = await gateway.diagnose({
      model: 'gpt-test',
      knowledgeIndex: broken,
      attachments: false,
    });
    expect(failed.at(-1)).toEqual({
      status: 'fail',
      title: 'The knowledge index could not be checked.',
    });
  });

  it('warns about a chat or transcription model with a shutdown date and keeps checking', async () => {
    server.use(
      http.get(url('/models/gpt-old'), () =>
        HttpResponse.json({
          id: 'gpt-old',
          object: 'model',
          created: 0,
          owned_by: 'openai',
          shutdown_date: '2099-12-11',
        }),
      ),
      http.get(url('/models/transcribe-old'), () =>
        HttpResponse.json({
          id: 'transcribe-old',
          object: 'model',
          created: 0,
          owned_by: 'openai',
          shutdown_date: '2099-02-26T00:00:00Z',
        }),
      ),
      ...healthy,
    );
    const checks = await gateway.diagnose({
      model: 'gpt-old',
      transcriptionModel: 'transcribe-old',
      attachments: false,
    });
    const deprecations = 'https://developers.openai.com/api/docs/deprecations';
    expect(checks.filter((check) => check.status !== 'ok')).toEqual([
      {
        status: 'warn',
        title: 'Model gpt-old is scheduled to shut down on 2099-12-11.',
        fix: `Change model in defineBot to the replacement OpenAI recommends: ${deprecations}`,
      },
      {
        status: 'warn',
        title: 'Model transcribe-old is scheduled to shut down on 2099-02-26.',
        fix: `Change voice.model in defineBot to the replacement OpenAI recommends: ${deprecations}`,
      },
    ]);
    // A warning, not a failure: the model still works, so the other checks run.
    expect(calls).toContain('POST /responses');
    expect(calls).toContain('POST /audio/transcriptions');
  });

  it('treats a null or missing shutdown date as no shutdown', async () => {
    server.use(
      http.get(url('/models/gpt-test'), () =>
        HttpResponse.json({
          id: 'gpt-test',
          object: 'model',
          created: 0,
          owned_by: 'openai',
          shutdown_date: null,
        }),
      ),
      ...healthy,
    );
    const checks = await gateway.diagnose({
      model: 'gpt-test',
      transcriptionModel: 'transcribe-test',
      attachments: false,
    });
    expect(checks).toContainEqual({ status: 'ok', title: 'Model gpt-test is available.' });
    expect(checks).toContainEqual({ status: 'ok', title: 'Model transcribe-test is available.' });
    expect(checks.every((check) => check.status === 'ok')).toBe(true);
  });

  it('keeps an unexpected shutdown date out of the report', async () => {
    server.use(
      http.get(url('/models/:model'), () =>
        HttpResponse.json({
          id: 'gpt-test',
          object: 'model',
          created: 0,
          owned_by: 'openai',
          shutdown_date: 'soon <script>',
        }),
      ),
      ...healthy,
    );
    const [model] = await gateway.diagnose({ model: 'gpt-test', attachments: false });
    expect(model).toMatchObject({
      status: 'warn',
      title: 'Model gpt-test has an announced shutdown date.',
    });
  });

  it('stops at a rejected key and never repeats what OpenAI said about it', async () => {
    server.use(http.get(url('/models/:model'), () => error(401, 'invalid_api_key')));
    const checks = await gateway.diagnose(everything);
    expect(checks).toEqual([
      expect.objectContaining({ status: 'fail', title: 'OpenAI rejected OPENAI_API_KEY.' }),
    ]);
    expect(JSON.stringify(checks)).not.toContain('sk-');
  });

  it('tells a missing scope from a rejected key', async () => {
    server.use(
      http.get(url('/models/:model'), () =>
        HttpResponse.json(
          {
            error: {
              message: 'Missing scopes: api.model.read.',
              type: 'invalid_request_error',
              code: null,
            },
          },
          { status: 401 },
        ),
      ),
      http.post(url('/responses'), () =>
        error(401, 'missing_scope', 'Missing scopes: api.responses.write.'),
      ),
      ...healthy,
    );
    const checks = await gateway.diagnose({ model: 'gpt-test', attachments: false });
    expect(checks.slice(0, 2)).toEqual([
      expect.objectContaining({
        status: 'warn',
        title: 'The key may not look up models, so the model name was not checked.',
      }),
      expect.objectContaining({
        status: 'fail',
        title: 'The key may not create responses with gpt-test.',
        fix: 'Allow "Responses API: Write" for the key.',
      }),
    ]);
  });

  it('names the missing model, store and permissions', async () => {
    server.use(
      http.get(url('/models/gpt-test'), () => error(404, 'model_not_found')),
      http.post(url('/conversations'), () => error(403, 'insufficient_permissions')),
      http.get(url('/vector_stores/:id'), () => error(404, 'not_found')),
      http.post(url('/files'), () => error(429, 'insufficient_quota')),
      ...healthy,
    );
    const checks = await gateway.diagnose(everything);
    const titles = checks.filter((check) => check.status === 'fail').map((check) => check.title);
    expect(titles).toEqual([
      "Model gpt-test isn't available to this OpenAI project.",
      'The key may not create conversations.',
      "Vector store vs_kb doesn't exist in this OpenAI project.",
      'The OpenAI project is out of credit or reached its spend limit.',
    ]);
    // No response is attempted with a model the project doesn't have.
    expect(calls).not.toContain('POST /responses');
  });

  it('tries again to delete the test conversation when the first delete fails', async () => {
    let deletes = 0;
    server.use(
      http.delete(url('/conversations/:id'), () => {
        deletes += 1;
        return deletes === 1 ? error(500, 'server_error') : HttpResponse.json({ deleted: true });
      }),
      ...healthy,
    );
    const checks = await gateway.diagnose({ model: 'gpt-test', attachments: false });
    expect(checks).toContainEqual(
      expect.objectContaining({
        status: 'fail',
        title: 'Could not delete conversations (HTTP 500, server_error).',
      }),
    );
    expect(deletes).toBe(2);
  });

  it('warns about an empty knowledge base and skips features the bot does not use', async () => {
    server.use(
      http.get(url('/vector_stores/:id'), () =>
        HttpResponse.json({
          id: 'vs_kb',
          object: 'vector_store',
          status: 'completed',
          file_counts: { completed: 0, failed: 0, in_progress: 0, cancelled: 0, total: 0 },
        }),
      ),
      ...healthy,
    );
    const checks = await gateway.diagnose({
      model: 'gpt-test',
      vectorStoreId: 'vs_kb',
      attachments: false,
    });
    expect(checks.at(-1)).toMatchObject({
      status: 'warn',
      title: 'Vector store vs_kb has no searchable documents.',
    });
    expect(calls.some((call) => call.includes('/files') || call.includes('/audio'))).toBe(false);
  });
});
