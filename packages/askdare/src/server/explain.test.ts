import { describe, expect, it } from 'vitest';
import { AskdareError, scrub } from '../errors';
import { explain } from './explain';

describe('scrub', () => {
  it('cuts API keys down to their prefix', () => {
    expect(scrub('Incorrect API key provided: sk-proj-abcdef123456. You can find…')).toBe(
      'Incorrect API key provided: sk-…. You can find…',
    );
    expect(scrub('no key here')).toBe('no key here');
  });
});

describe('explain', () => {
  const unavailable = (cause: unknown) => new AskdareError('bot_unavailable', { cause });

  it('names a missing variable and says where it goes', () => {
    expect(explain(unavailable('OPENAI_API_KEY is not configured.'))).toBe(
      "OPENAI_API_KEY is not set. Add it to .env.local (or your host's environment) and restart the app.",
    );
  });

  it('explains a key OpenAI rejects, without the key', () => {
    const rejected = Object.assign(new Error('Incorrect API key provided: sk-…'), { status: 401 });
    expect(explain(unavailable(rejected))).toMatch(/^OpenAI rejected the API key \(401\)/);
  });

  it("passes on a setup error's own words, such as a weak secret", () => {
    const weak = new TypeError('[askdare] CHAT_SECRET must be at least 32 characters.');
    expect(explain(unavailable(weak))).toBe('CHAT_SECRET must be at least 32 characters.');
  });

  it('leaves other errors to their generic message', () => {
    expect(explain(new AskdareError('upstream_error', { cause: new Error('boom') }))).toBe(
      undefined,
    );
  });
});
