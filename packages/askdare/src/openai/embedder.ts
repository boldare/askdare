import OpenAI from 'openai';
import type { Embedder, Embeddings, KnowledgeCallOptions } from '../knowledge/port';
import { fromOpenAIError } from './errors';

/**
 * Limits of `POST /v1/embeddings` (developers.openai.com/api/reference/resources/embeddings/methods/create,
 * checked 2026-11-23): at most 2048 inputs per request, 8192 tokens per input and 300,000 tokens
 * summed over a request. Chunks stay near 350 tokens, so batches are capped by count and by
 * characters, with room for scripts that take more than one token per character.
 */
const MAX_INPUTS = 2048;
const DEFAULT_BATCH = 256;
const MAX_BATCH_CHARACTERS = 250_000;

export interface OpenAIEmbedderOptions {
  /** The embedding model. Required: the library names no model IDs. */
  readonly model: string;
  /** Vector size, sent as `dimensions`; part of the embedder's ID and of the index's schema. */
  readonly dimensions: number;
  /** Defaults to `OPENAI_API_KEY`, read on the first call. */
  readonly apiKey?: string;
  /** Override for tests or proxies. */
  readonly baseURL?: string;
  /** Per-request timeout for the SDK. Default 60 s. */
  readonly timeoutMs?: number;
  /** SDK retries for a failed request. Default 2. */
  readonly maxRetries?: number;
  /** Custom fetch, for example to route through a proxy. */
  readonly fetch?: typeof fetch;
  /** Inputs per request, 1 to 2048. Default 256. */
  readonly batchSize?: number;
}

function batches(texts: readonly string[], size: number): string[][] {
  const result: string[][] = [];
  let current: string[] = [];
  let characters = 0;
  for (const text of texts) {
    if (
      current.length > 0 &&
      (current.length >= size || characters + text.length > MAX_BATCH_CHARACTERS)
    ) {
      result.push(current);
      current = [];
      characters = 0;
    }
    current.push(text);
    characters += text.length;
  }
  if (current.length > 0) result.push(current);
  return result;
}

/**
 * Embeddings from OpenAI for a knowledge index (ADR-0025, decision 3), with the OpenAI key the site
 * already has, on any model path. Batched, abortable, and checked: one vector of `dimensions` per input.
 */
export function openaiEmbedder(options: OpenAIEmbedderOptions): Embedder {
  const { model, dimensions } = options;
  if (typeof model !== 'string' || model.trim() === '') {
    throw new Error('openaiEmbedder needs a model: the library names no model IDs.');
  }
  if (!Number.isInteger(dimensions) || dimensions < 1) {
    throw new Error('openaiEmbedder needs dimensions as a positive integer.');
  }
  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_INPUTS) {
    throw new Error(`openaiEmbedder batchSize must be an integer from 1 to ${MAX_INPUTS}.`);
  }
  let client: OpenAI | undefined;
  const openai = (): OpenAI => {
    if (client !== undefined) return client;
    const apiKey = options.apiKey ?? process.env['OPENAI_API_KEY'];
    if (!apiKey) throw new Error('openaiEmbedder needs an API key: set OPENAI_API_KEY.');
    client = new OpenAI({
      apiKey,
      ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      timeout: options.timeoutMs ?? 60_000,
      maxRetries: options.maxRetries ?? 2,
    });
    return client;
  };

  return {
    id: `openai:${model}:${dimensions}`,
    dimensions,
    async embed(texts: readonly string[], call: KnowledgeCallOptions = {}): Promise<Embeddings> {
      const { signal } = call;
      if (texts.some((text) => text.trim() === '')) {
        throw new Error('openaiEmbedder cannot embed empty text.');
      }
      const vectors: number[][] = [];
      let tokens = 0;
      const sdk = openai();
      for (const batch of batches(texts, batchSize)) {
        let response: OpenAI.CreateEmbeddingResponse;
        try {
          signal?.throwIfAborted();
          response = await sdk.embeddings.create(
            { model, input: batch, dimensions, encoding_format: 'float' },
            signal ? { signal } : undefined,
          );
        } catch (error) {
          throw fromOpenAIError(
            error,
            signal?.reason instanceof DOMException && signal.reason.name === 'TimeoutError',
          );
        }
        const ordered = [...response.data].sort((a, b) => a.index - b.index);
        if (
          ordered.length !== batch.length ||
          ordered.some((item, i) => item.index !== i || item.embedding.length !== dimensions)
        ) {
          throw new Error(`OpenAI returned embeddings of the wrong number or size for ${model}.`);
        }
        for (const item of ordered) vectors.push(item.embedding);
        tokens += response.usage.total_tokens;
      }
      return { vectors, tokens };
    },
  };
}
