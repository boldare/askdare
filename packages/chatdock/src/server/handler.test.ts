import { beforeAll, describe, expect, it } from 'vitest';
import { defineBot } from '../bot/define-bot';
import type { ModelGateway, TurnRequest } from '../gateway';
import type { ProtocolEvent } from '../protocol/events';
import { decodeEvent, SseParser } from '../protocol/sse';
import { createTokenService, type TokenService } from '../security/tokens';
import type { EmbedAssets } from './embed-page';
import { createRequestHandler, type RequestHandler } from './handler';

const APP = 'https://app.example.com';
const BASE = `${APP}/api/chat`;

const assets: EmbedAssets = {
  loaderJs: 'console.log("loader")',
  widgetJs: 'console.log("widget")',
  widgetCss: 'body{}',
  widgetJsFile: 'widget.abc123.js',
  widgetCssFile: 'widget.def456.css',
};

const bot = defineBot({
  id: 'support',
  model: 'test-model',
  instructions: 'Be brief.',
  limits: { maxInputChars: 20 },
  security: { allowedOrigins: ['https://www.client.com'] },
  widget: { title: 'Help </script><script>alert(1)</script>' },
});

let tokens: TokenService;
let handler: RequestHandler;
const turns: TurnRequest[] = [];

const gateway: ModelGateway = {
  createConversation: async () => 'conv_1',
  deleteConversation: async () => {},
  runTurn: async (request) => {
    turns.push(request);
    request.emit({ type: 'text.delta', messageId: request.messageId, delta: 'Hello!' });
    return {
      reason: 'completed',
      usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
    };
  },
};

beforeAll(async () => {
  tokens = await createTokenService({ secret: 'x'.repeat(40) });
  handler = createRequestHandler({
    bots: [bot],
    basePath: '/api/chat',
    assets,
    gateway: () => gateway,
    tokens: async () => tokens,
    onError: () => {},
  });
});

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: APP,
      host: 'app.example.com',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function events(response: Response): Promise<ProtocolEvent[]> {
  const parser = new SseParser();
  return parser.push(await response.text()).flatMap((raw) => {
    const result = decodeEvent(raw);
    return result.ok ? [result.event] : [];
  });
}

async function session(resumeToken?: string): Promise<string> {
  const response = await handler(post('/session', { botId: 'support', resumeToken }));
  return ((await response.json()) as { accessToken: string }).accessToken;
}

describe('static routes', () => {
  it('serves the loader for cross-origin pages', async () => {
    const response = await handler(new Request(`${BASE}/widget.js`));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/javascript');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
    expect(await response.text()).toBe(assets.loaderJs);
  });

  it('serves hashed assets with immutable caching and 404s anything else', async () => {
    const js = await handler(new Request(`${BASE}/assets/widget.abc123.js`));
    expect(js.headers.get('cache-control')).toContain('immutable');
    const missing = await handler(new Request(`${BASE}/assets/other.js`));
    expect(missing.status).toBe(404);
  });

  it('renders the embed page with a strict CSP and the bot allowlist', async () => {
    const response = await handler(new Request(`${BASE}/embed/support`));
    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("frame-ancestors 'self' https://www.client.com");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-inline');
    const html = await response.text();
    expect(html).toContain('/api/chat/assets/widget.abc123.js');
    expect(html).not.toContain('</script><script>alert(1)');
  });

  it('returns 404 for unknown bots and routes', async () => {
    expect((await handler(new Request(`${BASE}/embed/nope`))).status).toBe(404);
    expect((await handler(new Request(`${APP}/elsewhere`))).status).toBe(404);
    expect((await handler(new Request(`${BASE}/session`))).status).toBe(404);
  });
});

describe('POST /session', () => {
  it('issues an access token for a new visitor', async () => {
    const response = await handler(post('/session', { botId: 'support' }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { accessToken: string; resumable: boolean };
    expect(body.resumable).toBe(false);
    await expect(tokens.verifyAccess(body.accessToken, 'support')).resolves.toMatchObject({
      visitorId: expect.stringMatching(/^v_/),
    });
  });

  it('keeps the visitor identity when a valid resume token is presented', async () => {
    const resume = await tokens.issueResume('support', {
      visitorId: 'v_known',
      conversationId: 'c',
    });
    const access = await session(resume.token);
    await expect(tokens.verifyAccess(access, 'support')).resolves.toEqual({ visitorId: 'v_known' });
  });

  it('starts a fresh visitor for a forged resume token', async () => {
    const access = await session('forged');
    await expect(tokens.verifyAccess(access, 'support')).resolves.not.toEqual({
      visitorId: 'v_known',
    });
  });

  it('rejects cross-origin requests and non-JSON bodies', async () => {
    const cross = await handler(
      post('/session', { botId: 'support' }, { origin: 'https://evil.com' }),
    );
    expect(cross.status).toBe(401);
    const form = await handler(
      new Request(`${BASE}/session`, {
        method: 'POST',
        body: 'botId=support',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      }),
    );
    expect(form.status).toBe(400);
  });
});

describe('POST /messages', () => {
  it('requires a valid access token', async () => {
    const response = await handler(post('/messages', { botId: 'support', text: 'Hi' }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'unauthorized' } });
  });

  it('streams a turn and hands out a resume token for the new conversation', async () => {
    const access = await session();
    const response = await handler(
      post(
        '/messages',
        { botId: 'support', text: '  Hi  ' },
        { authorization: `Bearer ${access}` },
      ),
    );
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const stream = await events(response);
    const created = stream.find((event) => event.type === 'conversation.created');
    expect(created).toBeDefined();
    const grant = await tokens.verifyResume(
      (created as { resumeToken: string }).resumeToken,
      'support',
    );
    expect(grant.conversationId).toBe('conv_1');
    expect(turns.at(-1)?.text).toBe('Hi');
    expect(stream.some((event) => event.type === 'text.delta')).toBe(true);
  });

  it('continues a conversation owned by the same visitor', async () => {
    const resume = await tokens.issueResume('support', {
      visitorId: 'v_owner',
      conversationId: 'conv_9',
    });
    const access = (await tokens.issueAccess('support', 'v_owner')).token;
    const response = await handler(
      post(
        '/messages',
        { botId: 'support', text: 'Again', resumeToken: resume.token },
        { authorization: `Bearer ${access}` },
      ),
    );
    await events(response);
    expect(turns.at(-1)?.conversationId).toBe('conv_9');
  });

  it("returns 404 for another visitor's conversation", async () => {
    const resume = await tokens.issueResume('support', {
      visitorId: 'v_owner',
      conversationId: 'conv_9',
    });
    const intruder = (await tokens.issueAccess('support', 'v_intruder')).token;
    const response = await handler(
      post(
        '/messages',
        { botId: 'support', text: 'Hi', resumeToken: resume.token },
        { authorization: `Bearer ${intruder}` },
      ),
    );
    expect(response.status).toBe(404);
  });

  it('enforces the message length limit', async () => {
    const access = await session();
    const long = await handler(
      post(
        '/messages',
        { botId: 'support', text: 'x'.repeat(21) },
        { authorization: `Bearer ${access}` },
      ),
    );
    expect(long.status).toBe(400);
    const empty = await handler(
      post('/messages', { botId: 'support', text: '   ' }, { authorization: `Bearer ${access}` }),
    );
    expect(empty.status).toBe(400);
  });

  it('rejects page URLs that are not http(s)', async () => {
    const access = await session();
    const response = await handler(
      post(
        '/messages',
        { botId: 'support', text: 'Hi', pageUrl: 'javascript:alert(1)' },
        { authorization: `Bearer ${access}` },
      ),
    );
    expect(response.status).toBe(400);
  });
});
