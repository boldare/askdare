import OpenAI from 'openai';

export interface OpenAIClientOptions {
  readonly apiKey: string;
  /** Override for tests or proxies. */
  readonly baseURL?: string;
  /** Per-request timeout for the SDK. Default 60 s; the turn deadline is enforced separately. */
  readonly timeoutMs?: number;
  /** SDK retries for failed requests before streaming starts. Default 2. */
  readonly maxRetries?: number;
  /** Custom fetch, for example to route through a proxy. Defaults to the global fetch. */
  readonly fetch?: typeof fetch;
}

/** The SDK client with askdare's explicit timeout and retries. */
export function createOpenAIClient(options: OpenAIClientOptions): OpenAI {
  return new OpenAI({
    apiKey: options.apiKey,
    ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    timeout: options.timeoutMs ?? 60_000,
    maxRetries: options.maxRetries ?? 2,
  });
}
