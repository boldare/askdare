import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBot } from '../bot/define-bot';
import { fakeConversations } from '../conversations/testing/fake-store';
import { AskdareError } from '../errors';
import type { ModelGateway } from '../gateway';
import { createLimits } from '../limits/limits';
import { memoryStore } from '../limits/store';
import type { HumanCheckContext, HumanVerifier } from '../security/human-verifier';
import { createTokenService, type TokenService } from '../security/tokens';
import type { EmbedAssets } from './embed-page';
import { createRequestHandler, type RequestHandler } from './handler';
import { publicConfig } from './public-config';

const APP = 'https://app.example.com';
const BASE = `${APP}/api/chat`;
const SITE_KEY = '1x00000000000000000000AA';

const assets: EmbedAssets = {
  loaderJs: 'console.log(JSON.parse(`__ASKDARE_LAUNCHERS__`))',
  widgetJs: '',
  widgetCss: '',
  widgetJsFile: 'widget.abc123.js',
  widgetCssFile: 'widget.def456.css',
  fontsCss: '',
  fontsCssFile: 'fonts.222.css',
  fontFiles: {},
  skinCss: '',
  skinCssFile: 'skin.333.css',
};

/** A verifier that passes the token `human` and records each check. */
const checks: { token: string; context: HumanCheckContext }[] = [];
let outcome: (token: string) => Promise<boolean> = async (token) => token === 'human';
const verifier: HumanVerifier = {
  // A custom verifier may carry more; only the site key reaches browsers.
  challenge: { provider: 'turnstile', siteKey: SITE_KEY, secret: 'do-not-leak' } as never,
  verify: (token, context) => {
    checks.push({ token, context });
    return outcome(token);
  },
};

const plain = createBot({
  id: 'plain',
  model: 'test-model',
  instructions: 'Help.',
  security: { allowedOrigins: ['https://www.client.com'] },
});
const guarded = createBot({
  id: 'guarded',
  model: 'test-model',
  instructions: 'Help.',
  limits: { sessionsPerIpPerHour: 5 },
  security: { allowedOrigins: ['https://www.client.com'], humanVerifier: verifier },
});

const gateway = {} as ModelGateway;
let tokens: TokenService;
let handler: RequestHandler;
const reported: AskdareError[] = [];

beforeAll(async () => {
  tokens = await createTokenService({ secret: 'aHVtYW4tY2hlY2stdGVzdHMtc2VjcmV0LTEyMzQ1Njc4OTA' });
});

beforeEach(() => {
  checks.length = 0;
  reported.length = 0;
  outcome = async (token) => token === 'human';
  handler = createRequestHandler({
    bots: [plain, guarded],
    basePath: '/api/chat',
    assets,
    gateway: () => gateway,
    conversations: fakeConversations(),
    tokens: async () => tokens,
    limits: createLimits({ store: memoryStore() }),
    clientIp: (request) => request.headers.get('x-test-ip') ?? 'test',
    onError: (error) => reported.push(error),
  });
});

function post(body: unknown, ip = 'test'): Request {
  return new Request(`${BASE}/session`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: APP,
      host: 'app.example.com',
      'x-test-ip': ip,
    },
    body: JSON.stringify(body),
  });
}

describe('a bot without a human check (as in 0.4)', () => {
  it('starts sessions without a token and ignores one sent anyway', async () => {
    expect((await handler(post({ botId: 'plain' }))).status).toBe(200);
    expect((await handler(post({ botId: 'plain', humanToken: 'anything' }))).status).toBe(200);
    expect(checks).toHaveLength(0);
  });

  it('keeps the iframe CSP of 0.4, with no third-party origin', async () => {
    const response = await handler(new Request(`${BASE}/embed/plain`));
    expect(response.headers.get('content-security-policy')).toBe(
      [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self'",
        "connect-src 'self'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'self' https://www.client.com",
      ].join('; '),
    );
  });

  it('renews any session as before, with or without a check time, however old', async () => {
    const visitorId = `v_${'f6'.repeat(16)}`;
    const old = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
    for (const checkedAt of [undefined, old]) {
      const previous = (await tokens.issueAccess('plain', visitorId, undefined, checkedAt)).token;
      const renewed = await handler(post({ botId: 'plain', accessToken: previous }));
      expect(renewed.status).toBe(200);
      const next = ((await renewed.json()) as { accessToken: string }).accessToken;
      await expect(tokens.verifyAccess(next, 'plain')).resolves.toEqual({ visitorId });
    }
  });

  it('sends browsers no human check', () => {
    expect(publicConfig(plain, '/api/chat')).not.toHaveProperty('humanCheck');
  });
});

describe('a bot with a human check', () => {
  it('refuses a new session without a token, without asking the verifier', async () => {
    const response = await handler(post({ botId: 'guarded' }));
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string; key: string } };
    expect(body.error).toMatchObject({ code: 'unauthorized', key: 'error.humanCheck' });
    expect(checks).toHaveLength(0);
  });

  it('refuses a token that fails the check', async () => {
    const response = await handler(post({ botId: 'guarded', humanToken: 'bot' }));
    expect(response.status).toBe(401);
    expect(checks.map((check) => check.token)).toEqual(['bot']);
    expect(reported).toHaveLength(0);
  });

  it('starts a session for a token that passes, telling the verifier which bot it is for', async () => {
    const response = await handler(post({ botId: 'guarded', humanToken: 'human' }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { accessToken: string };
    await expect(tokens.verifyAccess(body.accessToken, 'guarded')).resolves.toBeDefined();
    expect(checks).toHaveLength(1);
    expect(checks[0]?.context.botId).toBe('guarded');
    expect(checks[0]?.context.signal).toBeInstanceOf(AbortSignal);
  });

  it('renews a live session without a new check, but not on a stored conversation alone', async () => {
    const visitorId = `v_${'d4'.repeat(16)}`;
    const checkedAt = Math.floor(Date.now() / 1000) - 60;
    const previous = (await tokens.issueAccess('guarded', visitorId, undefined, checkedAt)).token;
    const renewed = await handler(post({ botId: 'guarded', accessToken: previous }));
    expect(renewed.status).toBe(200);
    expect(checks).toHaveLength(0);
    // The renewed session keeps the time of the original check, so the cap can't be reset.
    const next = ((await renewed.json()) as { accessToken: string }).accessToken;
    await expect(tokens.verifyRenewal(next, 'guarded')).resolves.toMatchObject({
      visitorId,
      humanCheckedAt: checkedAt,
    });

    // Another bot's session isn't a renewal of this one.
    const foreign = (await tokens.issueAccess('plain', visitorId, undefined, checkedAt)).token;
    expect((await handler(post({ botId: 'guarded', accessToken: foreign }))).status).toBe(401);

    const resume = await tokens.issueResume('guarded', { visitorId, conversationId: 'conv_1' });
    expect((await handler(post({ botId: 'guarded', resumeToken: resume.token }))).status).toBe(401);
    const resumed = await handler(
      post({ botId: 'guarded', resumeToken: resume.token, humanToken: 'human' }),
    );
    expect(resumed.status).toBe(200);
    expect(((await resumed.json()) as { resumable: boolean }).resumable).toBe(true);
  });

  it('asks again after 24 hours, and for sessions that never passed a check', async () => {
    const visitorId = `v_${'e5'.repeat(16)}`;
    const now = Math.floor(Date.now() / 1000);
    const stale = (await tokens.issueAccess('guarded', visitorId, undefined, now - 25 * 3600))
      .token;
    // Issued before the bot turned the check on: no claim, so no free renewal.
    const unchecked = (await tokens.issueAccess('guarded', visitorId)).token;
    const future = (await tokens.issueAccess('guarded', visitorId, undefined, now + 3600)).token;
    for (const accessToken of [stale, unchecked, future]) {
      expect((await handler(post({ botId: 'guarded', accessToken }))).status).toBe(401);
    }
    expect(checks).toHaveLength(0);
    // With a new check the visitor is kept, and the clock starts again.
    const renewed = await handler(
      post({ botId: 'guarded', accessToken: stale, humanToken: 'human' }),
    );
    expect(renewed.status).toBe(200);
    const next = ((await renewed.json()) as { accessToken: string }).accessToken;
    const grant = await tokens.verifyRenewal(next, 'guarded');
    expect(grant.visitorId).toBe(visitorId);
    expect(grant.humanCheckedAt).toBeGreaterThanOrEqual(now);
  });

  it('issues a check time only for bots with a check', async () => {
    const fresh = await handler(post({ botId: 'guarded', humanToken: 'human' }));
    const guardedToken = ((await fresh.json()) as { accessToken: string }).accessToken;
    expect((await tokens.verifyRenewal(guardedToken, 'guarded')).humanCheckedAt).toBeTypeOf(
      'number',
    );
    const plainSession = await handler(post({ botId: 'plain' }));
    const plainToken = ((await plainSession.json()) as { accessToken: string }).accessToken;
    expect(await tokens.verifyRenewal(plainToken, 'plain')).not.toHaveProperty('humanCheckedAt');
  });

  it('applies the session limit before the check, so floods never reach the provider', async () => {
    for (let index = 0; index < 5; index += 1) {
      await handler(post({ botId: 'guarded', humanToken: 'bot' }, 'flood'));
    }
    const limited = await handler(post({ botId: 'guarded', humanToken: 'human' }, 'flood'));
    expect(limited.status).toBe(429);
    expect(checks).toHaveLength(5);
  });

  it('fails closed when the check cannot run, and reports it', async () => {
    outcome = async () => {
      throw new Error('provider down');
    };
    const down = await handler(post({ botId: 'guarded', humanToken: 'human' }));
    expect(down.status).toBe(502);
    expect(reported.map((error) => error.code)).toEqual(['upstream_error']);

    outcome = async () => {
      throw new AskdareError('bot_unavailable', {
        cause: 'TURNSTILE_SECRET_KEY is not configured.',
      });
    };
    const unset = await handler(post({ botId: 'guarded', humanToken: 'human' }));
    expect(unset.status).toBe(503);
    expect(reported.map((error) => error.code)).toEqual(['upstream_error', 'bot_unavailable']);
  });

  it('refuses an oversized token before any check', async () => {
    const response = await handler(post({ botId: 'guarded', humanToken: 'x'.repeat(2049) }));
    expect(response.status).toBe(400);
    expect(checks).toHaveLength(0);
  });

  it("widens the iframe CSP by the provider's script and frame origin only", async () => {
    const response = await handler(new Request(`${BASE}/embed/guarded`));
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'self' https://challenges.cloudflare.com;");
    expect(csp).toContain('frame-src https://challenges.cloudflare.com;');
    expect(csp).toContain("connect-src 'self';");
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('unsafe');
  });

  it('sends browsers the site key and nothing else of the verifier', async () => {
    expect(publicConfig(guarded, '/api/chat').humanCheck).toEqual({
      provider: 'turnstile',
      siteKey: SITE_KEY,
    });
    const page = await (await handler(new Request(`${BASE}/embed/guarded`))).text();
    expect(page).toContain(SITE_KEY);
    expect(page).not.toContain('do-not-leak');
  });
});

describe('defineBot security.humanVerifier', () => {
  it('rejects anything that is not a verifier', () => {
    const define = (humanVerifier: unknown): unknown =>
      createBot({
        id: 'x',
        model: 'm',
        instructions: 'i',
        security: { humanVerifier: humanVerifier as HumanVerifier },
      });
    expect(() => define({ challenge: { provider: 'turnstile', siteKey: SITE_KEY } })).toThrow(
      /security\.humanVerifier/,
    );
    expect(() =>
      define({ challenge: { provider: 'recaptcha', siteKey: SITE_KEY }, verify: async () => true }),
    ).toThrow(/security\.humanVerifier/);
    expect(() =>
      define({ challenge: { provider: 'turnstile', siteKey: '"><x>' }, verify: async () => true }),
    ).toThrow(/security\.humanVerifier/);
    expect(define(verifier)).toBeDefined();
  });
});
