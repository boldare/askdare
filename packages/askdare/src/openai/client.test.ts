import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAIClient } from './client';

afterEach(() => vi.unstubAllEnvs());

describe('createOpenAIClient()', () => {
  it("uses OpenAI's global endpoint by default", () => {
    vi.stubEnv('OPENAI_BASE_URL', undefined);
    expect(createOpenAIClient({ apiKey: 'sk-test' }).baseURL).toBe('https://api.openai.com/v1');
  });

  // docs/deployment.md#regional-openai-endpoints relies on this: no askdare option is needed.
  it('sends requests to a regional endpoint set in OPENAI_BASE_URL', async () => {
    vi.stubEnv('OPENAI_BASE_URL', 'https://eu.api.openai.com/v1');
    const urls: string[] = [];
    const client = createOpenAIClient({
      apiKey: 'sk-test',
      maxRetries: 0,
      fetch: (input) => {
        urls.push(input instanceof Request ? input.url : String(input));
        return Promise.resolve(Response.json({ object: 'list', data: [] }));
      },
    });
    await client.models.list();
    expect(urls).toEqual(['https://eu.api.openai.com/v1/models']);
  });

  it('prefers an explicit baseURL over the environment', () => {
    vi.stubEnv('OPENAI_BASE_URL', 'https://eu.api.openai.com/v1');
    expect(
      createOpenAIClient({ apiKey: 'sk-test', baseURL: 'http://127.0.0.1:1/v1' }).baseURL,
    ).toBe('http://127.0.0.1:1/v1');
  });
});
