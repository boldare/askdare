import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AskdareError, TurnAbortedError } from '../errors';
import { openaiEmbedder } from './embedder';
import { OPENAI_TEST_BASE_URL } from './testing/msw';

const server = setupServer();
const bodies: Record<string, unknown>[] = [];
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  bodies.length = 0;
});
afterAll(() => server.close());

const options = {
  model: 'embed-test',
  dimensions: 3,
  apiKey: 'sk-test',
  baseURL: OPENAI_TEST_BASE_URL,
};

/** Answers like the API, with a vector that encodes each input's length, in reverse order. */
function embeddings(dimensions = 3) {
  return http.post(`${OPENAI_TEST_BASE_URL}/embeddings`, async ({ request }) => {
    const body = (await request.json()) as { input: string[] };
    bodies.push(body);
    const data = body.input.map((text, index) => ({
      object: 'embedding',
      index,
      embedding: Array.from({ length: dimensions }, (_, i) => text.length + i),
    }));
    return HttpResponse.json({
      object: 'list',
      data: data.reverse(),
      model: 'embed-test',
      usage: { prompt_tokens: body.input.length * 2, total_tokens: body.input.length * 2 },
    });
  });
}

describe('openaiEmbedder', () => {
  it('names itself by provider, model and dimensions', () => {
    const embedder = openaiEmbedder(options);
    expect(embedder.id).toBe('openai:embed-test:3');
    expect(embedder.dimensions).toBe(3);
  });

  it('has no default model and checks its options', () => {
    expect(() => openaiEmbedder({ dimensions: 3 } as never)).toThrow(/needs a model/);
    expect(() => openaiEmbedder({ ...options, dimensions: 0 })).toThrow(/dimensions/);
    expect(() => openaiEmbedder({ ...options, batchSize: 2049 })).toThrow(/batchSize/);
  });

  it('sends the model and dimensions, and returns vectors in input order with tokens', async () => {
    server.use(embeddings());
    const result = await openaiEmbedder(options).embed(['a', 'bbb']);
    expect(bodies).toEqual([
      { model: 'embed-test', input: ['a', 'bbb'], dimensions: 3, encoding_format: 'float' },
    ]);
    expect(result).toEqual({
      vectors: [
        [1, 2, 3],
        [3, 4, 5],
      ],
      tokens: 4,
    });
  });

  it('batches inputs and sums the tokens', async () => {
    server.use(embeddings());
    const result = await openaiEmbedder({ ...options, batchSize: 2 }).embed([
      'a',
      'bb',
      'ccc',
      'dddd',
      'eeeee',
    ]);
    expect(bodies.map((body) => body['input'])).toEqual([['a', 'bb'], ['ccc', 'dddd'], ['eeeee']]);
    expect(result.vectors.map((vector) => vector[0])).toEqual([1, 2, 3, 4, 5]);
    expect(result.tokens).toBe(10);
  });

  it('splits a batch that would be too long for one request', async () => {
    server.use(embeddings());
    const long = 'x'.repeat(150_000);
    await openaiEmbedder(options).embed([long, long, 'y']);
    expect(bodies.map((body) => (body['input'] as string[]).length)).toEqual([1, 2]);
  });

  it('refuses vectors of the wrong size', async () => {
    server.use(embeddings(2));
    await expect(openaiEmbedder(options).embed(['a'])).rejects.toThrow(/wrong number or size/);
  });

  it('refuses empty text without calling the API', async () => {
    server.use(embeddings());
    await expect(openaiEmbedder(options).embed(['a', '  '])).rejects.toThrow(/empty text/);
    expect(bodies).toEqual([]);
  });

  it('stops when aborted', async () => {
    server.use(embeddings());
    const controller = new AbortController();
    controller.abort();
    await expect(
      openaiEmbedder(options).embed(['a'], { signal: controller.signal }),
    ).rejects.toBeInstanceOf(TurnAbortedError);
    expect(bodies).toEqual([]);
  });

  it('maps API errors to client-safe errors', async () => {
    server.use(
      http.post(`${OPENAI_TEST_BASE_URL}/embeddings`, () =>
        HttpResponse.json(
          {
            error: {
              message: 'Incorrect API key provided',
              type: 'invalid_request_error',
              code: 'invalid_api_key',
            },
          },
          { status: 401 },
        ),
      ),
    );
    const failure = await openaiEmbedder({ ...options, maxRetries: 0 })
      .embed(['a'])
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AskdareError);
    expect((failure as AskdareError).code).toBe('bot_unavailable');
  });

  it('reads OPENAI_API_KEY only when it embeds', async () => {
    const saved = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    try {
      const embedder = openaiEmbedder({ model: 'embed-test', dimensions: 3 });
      await expect(embedder.embed(['a'])).rejects.toThrow(/OPENAI_API_KEY/);
    } finally {
      if (saved !== undefined) process.env['OPENAI_API_KEY'] = saved;
    }
  });
});
