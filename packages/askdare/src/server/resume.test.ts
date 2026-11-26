import { SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBot } from '../bot/define-bot';
import { fakeConversations } from '../conversations/testing/fake-store';
import type { ModelGateway, TurnRequest } from '../gateway';
import { createLimits } from '../limits/limits';
import { memoryStore } from '../limits/store';
import type { ProtocolEvent } from '../protocol/events';
import { decodeEvent, SseParser } from '../protocol/sse';
import { memoryTurnLog } from '../resume/memory-turn-log';
import { RESUME_GRACE_MS } from '../resume/turn-key';
import type { TurnEventLog } from '../resume/turn-log';
import { createIdentityVerifier } from '../security/identity';
import { createTokenService, type TokenService } from '../security/tokens';
import type { EmbedAssets } from './embed-page';
import { createRequestHandler, type RequestHandler } from './handler';

const APP = 'https://app.example.com';
const BASE = `${APP}/api/chat`;
const TURN_TIMEOUT_MS = 5_000;
const IDENTITY_SECRET = 'cmVzdW1lLWlkZW50aXR5LXNlY3JldC0xMjM0NTY3ODkw';
const identityVerifier = createIdentityVerifier({ secret: IDENTITY_SECRET });

const assets: EmbedAssets = {
  loaderJs: '',
  widgetJs: '',
  widgetCss: '',
  widgetJsFile: 'widget.js',
  widgetCssFile: 'widget.css',
  fontsCss: '',
  fontsCssFile: 'fonts.css',
  fontFiles: {},
  skinCss: '',
  skinCssFile: 'skin.css',
};

const bot = createBot({
  id: 'support',
  model: 'test-model',
  instructions: 'Be brief.',
  limits: { turnTimeoutMs: TURN_TIMEOUT_MS },
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A gate the next turn waits at, halfway through its answer, until the test opens it. */
let gate: { promise: Promise<void>; open: () => void } | undefined;
const holdNextTurn = (): (() => void) => {
  let open = (): void => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  gate = { promise, open };
  return open;
};

const gateway: ModelGateway = {
  deleteFiles: async () => {},
  transcribe: async () => ({ text: '', seconds: 0 }),
  uploadFile: async () => 'file-1',
  diagnose: async () => [],
  runTurn: async (request: TurnRequest) => {
    const held = gate;
    gate = undefined;
    request.emit({ type: 'text.delta', messageId: request.messageId, delta: 'one ' });
    request.emit({ type: 'text.delta', messageId: request.messageId, delta: 'two ' });
    await held?.promise;
    request.emit({ type: 'text.delta', messageId: request.messageId, delta: 'three ' });
    request.emit({ type: 'text.delta', messageId: request.messageId, delta: 'four' });
    return {
      reason: 'completed',
      usage: {
        inputTokens: 1,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 1,
        reasoningTokens: 0,
      },
    };
  },
};

let tokens: TokenService;
let clock = 0;
let turnLog: TurnEventLog;
let handler: RequestHandler;
let conversationCount = 0;

/** A handler with its own limits, so the rate-limit test doesn't share counters. */
const handlerWith = (resume: TurnEventLog | undefined): RequestHandler =>
  createRequestHandler({
    bots: [bot],
    basePath: '/api/chat',
    assets,
    gateway: () => gateway,
    conversations: fakeConversations({ id: () => `conv_${++conversationCount}` }),
    tokens: async () => tokens,
    limits: createLimits({ store: memoryStore() }),
    clientIp: () => 'test',
    onError: () => {},
    identity: () => identityVerifier,
    resume,
  });

beforeAll(async () => {
  tokens = await createTokenService({ secret: 'cmVzdW1lLXRlc3RzLXNlY3JldC0xMjM0NTY3ODkwYWI' });
  // Real time, except that the expiry test moves this clock ahead.
  turnLog = memoryTurnLog({ now: () => Date.now() + clock });
  handler = handlerWith(turnLog);
});

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Request {
  return new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: APP,
      host: 'app.example.com',
      ...headers,
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
}

async function accessToken(on: RequestHandler = handler): Promise<string> {
  const response = await on(post('/session', { botId: 'support' }));
  return ((await response.json()) as { accessToken: string }).accessToken;
}

interface Frame {
  readonly id: number;
  readonly event: ProtocolEvent;
}

/** Reads a stream's frames, until `until` says stop (then drops the connection) or it ends. */
async function frames(
  response: Response,
  until: (frame: Frame) => boolean = () => false,
  drop?: AbortController,
): Promise<Frame[]> {
  expect(response.status).toBe(200);
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  const read: Frame[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return read;
    for (const raw of parser.push(decoder.decode(value, { stream: true }))) {
      const result = decodeEvent(raw);
      if (!result.ok) continue;
      const frame = { id: Number(raw.id), event: result.event };
      read.push(frame);
      if (until(frame)) {
        drop?.abort();
        await reader.cancel();
        return read;
      }
    }
  }
}

const textOf = (list: readonly Frame[]): string =>
  list.map(({ event }) => (event.type === 'text.delta' ? event.delta : '')).join('');

/** Starts a turn and reads it until `until`; the turn's handles come from its frames. */
async function startTurn(
  auth: Record<string, string>,
  until?: (frame: Frame) => boolean,
): Promise<{ seen: Frame[]; resumeToken: string; messageId: string }> {
  const drop = new AbortController();
  const response = await handler(
    post('/messages', { botId: 'support', text: 'Count to four' }, auth, drop.signal),
  );
  const seen = await frames(response, until, drop);
  const created = seen.find(({ event }) => event.type === 'conversation.created')?.event;
  const started = seen.find(({ event }) => event.type === 'message.start')?.event;
  if (created?.type !== 'conversation.created' || started?.type !== 'message.start') {
    throw new Error('the turn did not start');
  }
  return { seen, resumeToken: created.resumeToken, messageId: started.messageId };
}

const resume = (
  auth: Record<string, string>,
  body: { resumeToken: string; messageId: string; after: number },
  on: RequestHandler = handler,
): Promise<Response> => on(post('/resume', { botId: 'support', ...body }, auth));

describe('POST /resume', () => {
  it('numbers every frame of a turn in order', async () => {
    const auth = { authorization: `Bearer ${await accessToken()}` };
    const { seen } = await startTurn(auth);
    expect(seen.map(({ id }) => id)).toEqual(seen.map((_, index) => index + 1));
    expect(seen.map(({ event }) => event.type)).toEqual([
      'conversation.created',
      'user.ack',
      'message.start',
      'text.delta',
      'text.delta',
      'text.delta',
      'text.delta',
      'message.end',
    ]);
  });

  it('continues an answer dropped midway with exactly the events missed, then the live ones', async () => {
    const auth = { authorization: `Bearer ${await accessToken()}` };
    const open = holdNextTurn();
    const { seen, resumeToken, messageId } = await startTurn(
      auth,
      ({ event }) => event.type === 'text.delta',
    );
    const last = seen.at(-1)?.id ?? 0;
    // The turn goes on without the visitor; its first batch reaches the log.
    await sleep(150);

    const response = await resume(auth, { resumeToken, messageId, after: last });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('x-askdare-protocol')).toBe('1');
    const reading = frames(response);
    await sleep(50);
    open();
    const resumed = await reading;

    expect(resumed[0]?.id).toBe(last + 1);
    const all = [...seen, ...resumed];
    // No event twice, none missing, in order.
    expect(all.map(({ id }) => id)).toEqual(all.map((_, index) => index + 1));
    expect(textOf(all)).toBe('one two three four');
    expect(resumed.at(-1)?.event).toMatchObject({ type: 'message.end', reason: 'completed' });
  });

  it('answers the rest after the answer ended, and nothing once the client saw the end', async () => {
    const auth = { authorization: `Bearer ${await accessToken()}` };
    const { seen, resumeToken, messageId } = await startTurn(auth);
    const end = seen.at(-1) as Frame;
    expect(end.event.type).toBe('message.end');

    const rest = await frames(await resume(auth, { resumeToken, messageId, after: end.id - 2 }));
    expect(rest).toEqual(seen.slice(-2));

    // From the start: the same events, with a handle issued for this request in place of the logged one.
    const all = await frames(await resume(auth, { resumeToken, messageId, after: 0 }));
    const withoutHandles = (list: readonly Frame[]) =>
      list.map(({ id, event }) =>
        event.type === 'conversation.created'
          ? { id, event: { ...event, resumeToken: '' } }
          : { id, event },
      );
    expect(withoutHandles(all)).toEqual(withoutHandles(seen));

    const started = Date.now();
    expect(await frames(await resume(auth, { resumeToken, messageId, after: end.id }))).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('hands a visitor who signed in during the answer their own handle, never the anonymous one', async () => {
    const sign = (sub: string): Promise<string> =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(sub)
        .setAudience('support')
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(new TextEncoder().encode(IDENTITY_SECRET));
    const session = async (body: Record<string, unknown>) =>
      (await (await handler(post('/session', { botId: 'support', ...body }))).json()) as {
        accessToken: string;
        resumable: boolean;
        resumeToken?: string;
      };

    // An anonymous visitor's conversation; its next answer is the one they sign in during.
    const anonymous = await session({});
    const first = await startTurn({ authorization: `Bearer ${anonymous.accessToken}` });
    const open = holdNextTurn();
    const drop = new AbortController();
    const seen = await frames(
      await handler(
        post(
          '/messages',
          { botId: 'support', text: 'Count to four', resumeToken: first.resumeToken },
          { authorization: `Bearer ${anonymous.accessToken}` },
          drop.signal,
        ),
      ),
      ({ event }) => event.type === 'text.delta',
      drop,
    );
    const started = seen.find(({ event }) => event.type === 'message.start')?.event;
    if (started?.type !== 'message.start') throw new Error('the turn did not start');
    await sleep(150);

    // They sign in while it streams: the conversation is adopted. Then the stream drops.
    const signedIn = await session({
      accessToken: anonymous.accessToken,
      resumeToken: first.resumeToken,
      identityToken: await sign('ada'),
    });
    expect(signedIn.resumeToken).toBeDefined();
    const response = await resume(
      { authorization: `Bearer ${signedIn.accessToken}` },
      {
        resumeToken: signedIn.resumeToken as string,
        messageId: started.messageId,
        after: seen.at(-1)?.id ?? 0,
      },
    );
    const reading = frames(response);
    await sleep(50);
    open();
    const end = (await reading).at(-1)?.event;
    if (end?.type !== 'message.end' || !end.resumeToken) throw new Error('no handle at the end');

    // The handle the answer ended with is the user's: it leaves with them at sign-out.
    expect((await tokens.verifyResume(end.resumeToken, 'support')).identityKey).toBeDefined();
    const signedOut = await session({
      accessToken: signedIn.accessToken,
      resumeToken: end.resumeToken,
      identityToken: null,
    });
    expect(signedOut.resumable).toBe(false);
  });

  it('answers 404 for another visitor’s conversation and for an answer of another conversation', async () => {
    const owner = { authorization: `Bearer ${await accessToken()}` };
    const { resumeToken, messageId } = await startTurn(owner);
    const stranger = { authorization: `Bearer ${await accessToken()}` };
    const theirs = await resume(stranger, { resumeToken, messageId, after: 0 });
    expect(theirs.status).toBe(404);
    expect(await theirs.json()).toMatchObject({ error: { code: 'not_found' } });

    // The stranger's own conversation doesn't reach the owner's answer either.
    const own = await startTurn(stranger);
    const crossed = await resume(stranger, {
      resumeToken: own.resumeToken,
      messageId,
      after: 0,
    });
    expect(crossed.status).toBe(404);
    expect((await resume(owner, { resumeToken, messageId: 'msg_unknown', after: 0 })).status).toBe(
      404,
    );
  });

  it('answers 404 once the answer’s events have expired', async () => {
    const auth = { authorization: `Bearer ${await accessToken()}` };
    const { resumeToken, messageId } = await startTurn(auth);
    expect((await resume(auth, { resumeToken, messageId, after: 0 })).status).toBe(200);
    clock += TURN_TIMEOUT_MS + RESUME_GRACE_MS + 1;
    try {
      const expired = await resume(auth, { resumeToken, messageId, after: 0 });
      expect(expired.status).toBe(404);
      expect(await expired.json()).toMatchObject({ error: { code: 'not_found' } });
    } finally {
      clock = 0;
    }
  });

  it('answers 404 without a turn log', async () => {
    const plain = handlerWith(undefined);
    const auth = { authorization: `Bearer ${await accessToken(plain)}` };
    const response = await plain(post('/messages', { botId: 'support', text: 'Hi' }, auth));
    const seen = await frames(response);
    // Frames are numbered all the same.
    expect(seen.map(({ id }) => id)).toEqual(seen.map((_, index) => index + 1));
    const created = seen[0]?.event;
    const started = seen[2]?.event;
    if (created?.type !== 'conversation.created' || started?.type !== 'message.start') {
      throw new Error('the turn did not start');
    }
    const resumed = await resume(
      auth,
      { resumeToken: created.resumeToken, messageId: started.messageId, after: 0 },
      plain,
    );
    expect(resumed.status).toBe(404);
  });

  it('refuses cross-site requests, invalid input, forged handles and requests without a session', async () => {
    const auth = { authorization: `Bearer ${await accessToken()}` };
    const { resumeToken, messageId } = await startTurn(auth);
    const body = { botId: 'support', resumeToken, messageId, after: 0 };
    expect(
      (await handler(post('/resume', body, { ...auth, origin: 'https://evil.example' }))).status,
    ).toBe(401);
    expect((await handler(post('/resume', body))).status).toBe(401);
    for (const invalid of [
      { ...body, after: -1 },
      { ...body, after: 1.5 },
      { ...body, messageId: '' },
      { ...body, messageId: 'm'.repeat(129) },
      { botId: 'support', resumeToken, after: 0 },
    ]) {
      expect((await handler(post('/resume', invalid, auth))).status).toBe(400);
    }
    // A forged handle is answered like an unknown conversation.
    expect((await handler(post('/resume', { ...body, resumeToken: 'forged' }, auth))).status).toBe(
      404,
    );
  });

  it('limits how often a visitor resumes', async () => {
    const limited = handlerWith(turnLog);
    const auth = { authorization: `Bearer ${await accessToken(limited)}` };
    const response = await limited(post('/messages', { botId: 'support', text: 'Hi' }, auth));
    const seen = await frames(response);
    const created = seen[0]?.event;
    const started = seen[2]?.event;
    if (created?.type !== 'conversation.created' || started?.type !== 'message.start') {
      throw new Error('the turn did not start');
    }
    const body = { resumeToken: created.resumeToken, messageId: started.messageId, after: 0 };
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const ok = await resume(auth, body, limited);
      expect(ok.status).toBe(200);
      await ok.body?.cancel();
    }
    const refused = await resume(auth, body, limited);
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: { code: 'rate_limited' } });
  });
});
