import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AskdareError } from '../errors';
import { TURNSTILE_ORIGIN } from './human-verifier';
import { turnstile } from './turnstile';

// Cloudflare's published test keys (developers.cloudflare.com/turnstile/troubleshooting/testing).
const SITE_KEY = '1x00000000000000000000AA';
const PASSING_SECRET = '1x0000000000000000000000000000000AA';
const DUMMY_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

const context = (): { botId: string; signal: AbortSignal } => ({
  botId: 'support',
  signal: new AbortController().signal,
});

let fetchMock: ReturnType<typeof vi.fn>;

/** A mocked siteverify answer; no request leaves the test. */
function answer(body: unknown, status = 200): void {
  fetchMock.mockResolvedValueOnce(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('turnstile()', () => {
  it('exposes only the public site key as its challenge', () => {
    const verifier = turnstile({ siteKey: ` ${SITE_KEY} `, secretKey: PASSING_SECRET });
    expect(verifier.challenge).toEqual({ provider: 'turnstile', siteKey: SITE_KEY });
    expect(JSON.stringify(verifier)).not.toContain(PASSING_SECRET);
  });

  it('rejects a missing or malformed site key at startup', () => {
    expect(() => turnstile({ siteKey: '' })).toThrow(TypeError);
    expect(() => turnstile({ siteKey: '<script>' })).toThrow(/siteKey/);
    expect(() => turnstile({} as { siteKey: string })).toThrow(TypeError);
  });

  it('posts the secret and the token to siteverify and passes a successful check', async () => {
    answer({
      success: true,
      challenge_ts: '2026-11-21T10:00:00.000Z',
      hostname: 'example.com',
      'error-codes': [],
    });
    const verifier = turnstile({ siteKey: SITE_KEY, secretKey: PASSING_SECRET });
    const signal = new AbortController().signal;
    await expect(verifier.verify(DUMMY_TOKEN, { botId: 'support', signal })).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${TURNSTILE_ORIGIN}/turnstile/v0/siteverify`);
    expect(init.method).toBe('POST');
    expect(init.signal).toBe(signal);
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({
      secret: PASSING_SECRET,
      response: DUMMY_TOKEN,
    });
  });

  it('reads TURNSTILE_SECRET_KEY at the first check, not when the bot is defined', async () => {
    const verifier = turnstile({ siteKey: SITE_KEY });
    vi.stubEnv('TURNSTILE_SECRET_KEY', PASSING_SECRET);
    answer({ success: true });
    await expect(verifier.verify(DUMMY_TOKEN, context())).resolves.toBe(true);
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({
      secret: PASSING_SECRET,
      response: DUMMY_TOKEN,
    });
  });

  it.each([
    ['an invalid token', ['invalid-input-response']],
    ['a used or expired token', ['timeout-or-duplicate']],
    ['a malformed request', ['bad-request']],
    ['no reason', undefined],
  ])('fails the visitor for %s', async (_case, codes) => {
    answer({ success: false, ...(codes ? { 'error-codes': codes } : {}) });
    const verifier = turnstile({ siteKey: SITE_KEY, secretKey: PASSING_SECRET });
    await expect(verifier.verify(DUMMY_TOKEN, context())).resolves.toBe(false);
  });

  it('fails an empty or oversized token without asking Cloudflare', async () => {
    const verifier = turnstile({ siteKey: SITE_KEY, secretKey: PASSING_SECRET });
    await expect(verifier.verify('', context())).resolves.toBe(false);
    await expect(verifier.verify('x'.repeat(2049), context())).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws bot_unavailable when the secret is missing or rejected', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    const unset = turnstile({ siteKey: SITE_KEY });
    const missing = await unset.verify(DUMMY_TOKEN, context()).catch((error: unknown) => error);
    expect(missing).toBeInstanceOf(AskdareError);
    expect(missing).toMatchObject({ code: 'bot_unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();

    answer({ success: false, 'error-codes': ['invalid-input-secret'] });
    const wrong = turnstile({ siteKey: SITE_KEY, secretKey: 'wrong' });
    const rejected = await wrong.verify(DUMMY_TOKEN, context()).catch((error: unknown) => error);
    expect(rejected).toMatchObject({ code: 'bot_unavailable' });
    expect(String((rejected as AskdareError).cause)).toContain('TURNSTILE_SECRET_KEY');
    expect(String((rejected as AskdareError).cause)).not.toContain('wrong');
  });

  it('throws upstream_error when Cloudflare is unreachable or answers without a result', async () => {
    const verifier = turnstile({ siteKey: SITE_KEY, secretKey: PASSING_SECRET });
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(verifier.verify(DUMMY_TOKEN, context())).rejects.toMatchObject({
      code: 'upstream_error',
    });
    answer('<html>Bad gateway</html>', 502);
    await expect(verifier.verify(DUMMY_TOKEN, context())).rejects.toMatchObject({
      code: 'upstream_error',
    });
    answer({ success: false, 'error-codes': ['internal-error'] });
    await expect(verifier.verify(DUMMY_TOKEN, context())).rejects.toMatchObject({
      code: 'upstream_error',
    });
  });

  it('throws timeout when the check is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'));
    const verifier = turnstile({ siteKey: SITE_KEY, secretKey: PASSING_SECRET });
    await expect(
      verifier.verify(DUMMY_TOKEN, { botId: 'support', signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'timeout' });
  });
});
