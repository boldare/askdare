import { createHmac, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatHandoffReport } from './report';
import { webhookHandoff } from './webhook';

const KEY = randomBytes(32);
const SECRET = `whsec_${KEY.toString('base64')}`;
const VISITOR_TEXT = 'my account number is 12345, please call me';

const report: ChatHandoffReport = {
  id: 'hof_1',
  bot: 'support',
  locale: 'en',
  createdAt: 1_790_000_000_000,
  trigger: 'model',
  reason: 'complaint',
  visitor: 'v_abc',
  conversationId: 'conv_1',
  available: true,
  contact: { email: 'anna@example.com', name: 'Anna' },
  summary: VISITOR_TEXT,
  transcript: [{ role: 'user', text: VISITOR_TEXT }],
};

interface Received {
  readonly headers: IncomingMessage['headers'];
  readonly body: string;
}

type Reply = (response: ServerResponse) => void;

let server: Server;
let url: string;
let replies: Reply[];
let received: Received[];

beforeEach(async () => {
  replies = [];
  received = [];
  server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      received.push({ headers: request.headers, body });
      const reply = replies.shift() ?? ((res: ServerResponse) => res.writeHead(204).end());
      reply(response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hooks/handoff`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  vi.unstubAllEnvs();
});

const status =
  (code: number, body = ''): Reply =>
  (response) =>
    response.writeHead(code, { 'content-type': 'text/plain' }).end(body);
const hang: Reply = () => undefined;

/** The Standard Webhooks check, written independently of the implementation. */
function verify({ headers, body }: Received): boolean {
  const id = String(headers['webhook-id']);
  const timestamp = String(headers['webhook-timestamp']);
  const expected = createHmac('sha256', KEY).update(`${id}.${timestamp}.${body}`).digest('base64');
  return String(headers['webhook-signature'])
    .split(' ')
    .some((entry) => entry === `v1,${expected}`);
}

async function failure(promise: Promise<unknown>): Promise<Error> {
  const error = await promise.then(
    () => undefined,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(Error);
  return error as Error;
}

describe('webhookHandoff', () => {
  it('posts the report as JSON with valid Standard Webhooks headers', async () => {
    await webhookHandoff({ url, secret: SECRET, headers: { 'x-api-key': 'k' } })(report);

    expect(received).toHaveLength(1);
    const [request] = received;
    if (!request) throw new Error('no request');
    expect(JSON.parse(request.body)).toEqual(report);
    expect(request.headers['content-type']).toBe('application/json');
    expect(request.headers['x-api-key']).toBe('k');
    expect(request.headers['webhook-id']).toBe('hof_1');
    const timestamp = Number(request.headers['webhook-timestamp']);
    expect(Math.abs(timestamp - Date.now() / 1000)).toBeLessThan(5);
    expect(verify(request)).toBe(true);
    expect(verify({ ...request, body: request.body.replace('Anna', 'Eve') })).toBe(false);
  });

  it('retries once after a 5xx, with the same webhook-id and a valid signature', async () => {
    replies.push(status(503));
    await webhookHandoff({ url, secret: SECRET })(report);

    expect(received).toHaveLength(2);
    expect(received.map((request) => request.headers['webhook-id'])).toEqual(['hof_1', 'hof_1']);
    expect(received.every(verify)).toBe(true);
  });

  it.each([408, 429])('retries once after a %i', async (code) => {
    replies.push(status(code));
    await webhookHandoff({ url, secret: SECRET })(report);
    expect(received).toHaveLength(2);
  });

  it('fails after the retry when the endpoint keeps failing', async () => {
    replies.push(status(500, VISITOR_TEXT), status(502, VISITOR_TEXT));
    const error = await failure(webhookHandoff({ url, secret: SECRET })(report));

    expect(received).toHaveLength(2);
    expect(error.name).toBe('HandoffDeliveryError');
    expect(error.message).toBe('The handoff webhook answered 502.');
  });

  it.each([400, 401, 404, 410])('does not retry a %i', async (code) => {
    replies.push(status(code));
    const error = await failure(webhookHandoff({ url, secret: SECRET })(report));
    expect(received).toHaveLength(1);
    expect(error.message).toBe(`The handoff webhook answered ${code}.`);
  });

  it('does not follow redirects', async () => {
    replies.push((response) => response.writeHead(307, { location: `${url}/elsewhere` }).end());
    const error = await failure(webhookHandoff({ url, secret: SECRET })(report));

    expect(received).toHaveLength(1);
    expect(error.message).toMatch(/redirect \(307\)/);
  });

  it('times out a hanging attempt and retries it once', async () => {
    replies.push(hang, hang);
    const startedAt = Date.now();
    const error = await failure(webhookHandoff({ url, secret: SECRET, timeoutMs: 100 })(report));

    expect(received).toHaveLength(2);
    expect(error.message).toBe('The handoff webhook did not answer within 100 ms.');
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });

  it('succeeds when the retry of a timed-out attempt answers', async () => {
    replies.push(hang);
    await webhookHandoff({ url, secret: SECRET, timeoutMs: 100 })(report);
    expect(received).toHaveLength(2);
  });

  it('skips the retry when it would not fit in the ten-second deadline', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      replies.push((response) => {
        vi.setSystemTime(Date.now() + 9000);
        status(503)(response);
      });
      await failure(webhookHandoff({ url, secret: SECRET })(report));
      expect(received).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails when the endpoint is unreachable', async () => {
    const closed = url;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    const error = await failure(webhookHandoff({ url: closed, secret: SECRET })(report));
    expect(error.message).toBe('The handoff webhook could not be reached.');
  });

  it('keeps visitor text out of the error and logs', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    try {
      replies.push(status(500, VISITOR_TEXT), status(500, VISITOR_TEXT));
      const error = await failure(webhookHandoff({ url, secret: SECRET })(report));
      const seen = JSON.stringify([
        error.message,
        String(error.stack),
        spies.map((s) => s.mock.calls),
      ]);
      expect(seen).not.toContain('12345');
      expect(seen).not.toContain('anna@example.com');
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  describe('options', () => {
    it.each([
      ['plain http to another host', 'http://example.com/hook'],
      ['another scheme', 'ftp://example.com/hook'],
      ['not a URL', 'example.com/hook'],
      ['credentials in the URL', 'https://user:pass@example.com/hook'],
    ])('rejects %s', (_, value) => {
      expect(() => webhookHandoff({ url: value, secret: SECRET })).toThrow(TypeError);
    });

    it('accepts https anywhere, and http://localhost outside production only', () => {
      expect(() => webhookHandoff({ url: 'https://example.com/h', secret: SECRET })).not.toThrow();
      expect(() =>
        webhookHandoff({ url: 'http://localhost:3000/h', secret: SECRET }),
      ).not.toThrow();
      vi.stubEnv('NODE_ENV', 'production');
      expect(() => webhookHandoff({ url: 'http://localhost:3000/h', secret: SECRET })).toThrow(
        /https/,
      );
      expect(() => webhookHandoff({ url: 'https://example.com/h', secret: SECRET })).not.toThrow();
    });

    it.each([
      ['no whsec_ prefix', KEY.toString('base64')],
      ['not base64', 'whsec_not base64!'],
      ['too short', `whsec_${randomBytes(16).toString('base64')}`],
    ])('rejects a secret with %s', (_, secret) => {
      expect(() => webhookHandoff({ url, secret })).toThrow(/secret/);
    });

    it('rejects headers that would replace the signature or carry a line break', () => {
      expect(() =>
        webhookHandoff({ url, secret: SECRET, headers: { 'Webhook-Signature': 'v1,x' } }),
      ).toThrow(/can't set/);
      expect(() =>
        webhookHandoff({ url, secret: SECRET, headers: { 'x-key': 'a\r\nx-evil: 1' } }),
      ).toThrow(/line break/);
    });

    it.each([0, 9001, 1.5])('rejects timeoutMs %s', (timeoutMs) => {
      expect(() => webhookHandoff({ url, secret: SECRET, timeoutMs })).toThrow(/timeoutMs/);
    });
  });
});
