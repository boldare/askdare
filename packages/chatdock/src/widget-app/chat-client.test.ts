import { describe, expect, it } from 'vitest';
import type { ProtocolEvent } from '../protocol/events';
import { encodeComment, encodeEvent } from '../protocol/sse';
import { ChatClient } from './chat-client';
import { memoryStorage, type SafeStorage } from './storage';

const encoder = new TextEncoder();

function sse(
  events: readonly ProtocolEvent[],
  options: { hang?: boolean } = {},
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(encodeComment('ok')));
      for (const event of events) controller.enqueue(encoder.encode(encodeEvent(event)));
      if (!options.hang) controller.close();
    },
  });
}

interface Call {
  readonly url: string;
  readonly body: Record<string, unknown>;
  readonly auth: string | null;
}

function fakeFetch(handlers: {
  session?: () => Response;
  messages: (call: Call, attempt: number) => Response;
}): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  let messageAttempts = 0;
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const call: Call = {
      url,
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      auth: new Headers(init?.headers).get('authorization'),
    };
    calls.push(call);
    if (url.endsWith('/session')) {
      return (
        handlers.session?.() ??
        Response.json({
          accessToken: `token-${calls.length}`,
          expiresAt: Date.now() / 1000 + 900,
          resumable: false,
        })
      );
    }
    messageAttempts += 1;
    return handlers.messages(call, messageAttempts);
  };
  return { fetch: impl as typeof fetch, calls };
}

const streamHeaders = { 'content-type': 'text/event-stream', 'x-chatdock-protocol': '1' };

function client(
  fetchImpl: typeof fetch,
  storage: SafeStorage = memoryStorage(),
  watchdogMs?: number,
): ChatClient {
  return new ChatClient({
    basePath: '/api/chat',
    botId: 'support',
    locale: 'pl',
    storage,
    fetch: fetchImpl,
    ...(watchdogMs ? { watchdogMs } : {}),
  });
}

describe('ChatClient', () => {
  it('opens a session, streams events and stores the resume token', async () => {
    const storage = memoryStorage();
    const { fetch, calls } = fakeFetch({
      messages: () =>
        new Response(
          sse([
            { type: 'conversation.created', resumeToken: 'resume-1' },
            { type: 'message.start', messageId: 'm1' },
            { type: 'text.delta', messageId: 'm1', delta: 'Hej' },
            { type: 'message.end', messageId: 'm1', reason: 'completed' },
          ]),
          { headers: streamHeaders },
        ),
    });
    const events: ProtocolEvent[] = [];
    await client(fetch, storage).send('Hello', (event) => events.push(event));

    expect(calls.map((call) => call.url)).toEqual(['/api/chat/session', '/api/chat/messages']);
    expect(calls[1]?.auth).toBe('Bearer token-1');
    expect(calls[1]?.body).toEqual({ botId: 'support', text: 'Hello', locale: 'pl' });
    expect(events.map((event) => event.type)).toEqual([
      'conversation.created',
      'message.start',
      'text.delta',
      'message.end',
    ]);
    expect(storage.get('chatdock:support:resume')).toBe('resume-1');
  });

  it('sends the stored resume token with later messages', async () => {
    const storage = memoryStorage();
    storage.set('chatdock:support:resume', 'resume-1');
    const { fetch, calls } = fakeFetch({
      session: () =>
        Response.json({ accessToken: 't', expiresAt: Date.now() / 1000 + 900, resumable: true }),
      messages: () => new Response(sse([]), { headers: streamHeaders }),
    });
    await client(fetch, storage).send('Again', () => {});
    expect(calls[0]?.body).toMatchObject({ resumeToken: 'resume-1' });
    expect(calls[1]?.body).toMatchObject({ resumeToken: 'resume-1' });
  });

  it('renews the session once when the access token is rejected', async () => {
    const { fetch, calls } = fakeFetch({
      messages: (_call, attempt) =>
        attempt === 1
          ? Response.json(
              { error: { code: 'session_expired', message: 'Expired.' } },
              { status: 401 },
            )
          : new Response(sse([]), { headers: streamHeaders }),
    });
    const events: ProtocolEvent[] = [];
    await client(fetch).send('Hi', (event) => events.push(event));
    expect(calls.map((call) => call.url.split('/').at(-1))).toEqual([
      'session',
      'messages',
      'session',
      'messages',
    ]);
    expect(events.some((event) => event.type === 'error')).toBe(false);
  });

  it('turns API errors into error events and forgets a conversation that no longer exists', async () => {
    const storage = memoryStorage();
    storage.set('chatdock:support:resume', 'stale');
    const { fetch } = fakeFetch({
      session: () =>
        Response.json({ accessToken: 't', expiresAt: Date.now() / 1000 + 900, resumable: true }),
      messages: () =>
        Response.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 }),
    });
    const events: ProtocolEvent[] = [];
    await client(fetch, storage).send('Hi', (event) => events.push(event));
    expect(events).toEqual([{ type: 'error', code: 'not_found', message: 'Not found.' }]);
    expect(storage.get('chatdock:support:resume')).toBeUndefined();
  });

  it('asks for a reload when the server speaks another protocol version', async () => {
    const { fetch } = fakeFetch({
      messages: () =>
        new Response(sse([]), { headers: { ...streamHeaders, 'x-chatdock-protocol': '2' } }),
    });
    const events: ProtocolEvent[] = [];
    await client(fetch).send('Hi', (event) => events.push(event));
    expect(events).toMatchObject([{ type: 'error', code: 'bot_unavailable' }]);
  });

  it('gives up on a stalled stream', async () => {
    const { fetch } = fakeFetch({
      messages: () => new Response(sse([], { hang: true }), { headers: streamHeaders }),
    });
    const events: ProtocolEvent[] = [];
    await client(fetch, memoryStorage(), 30).send('Hi', (event) => events.push(event));
    expect(events).toMatchObject([{ type: 'error', code: 'timeout' }]);
  });

  it('reports network failures without throwing', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const events: ProtocolEvent[] = [];
    await client(failing).send('Hi', (event) => events.push(event));
    expect(events).toMatchObject([{ type: 'error', code: 'upstream_error' }]);
  });
});
