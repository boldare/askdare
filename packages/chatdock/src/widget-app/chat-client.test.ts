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

describe('ChatClient.upload', () => {
  function uploadFetch(respond: () => Response): {
    fetch: typeof fetch;
    requests: { url: string; headers: Headers; body: unknown }[];
  } {
    const requests: { url: string; headers: Headers; body: unknown }[] = [];
    const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.endsWith('/session')) {
        return Response.json({ accessToken: 'tok', expiresAt: Date.now() / 1000 + 900 });
      }
      requests.push({ url, headers: new Headers(init?.headers), body: init?.body });
      return respond();
    };
    return { fetch: impl as typeof fetch, requests };
  }

  it('sends the raw file with the bot and the encoded name in headers', async () => {
    const { fetch, requests } = uploadFetch(() =>
      Response.json({ attachment: { id: 'handle', kind: 'image', name: 'Zdjęcie.jpg', size: 3 } }),
    );
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    const result = await client(fetch).upload(blob, 'Zdjęcie.jpg');
    expect(result).toEqual({
      ok: true,
      file: { id: 'handle', kind: 'image', name: 'Zdjęcie.jpg' },
    });
    const [sent] = requests;
    expect(sent?.url).toBe('/api/chat/attachments');
    expect(sent?.body).toBe(blob);
    expect(sent?.headers.get('content-type')).toBe('application/octet-stream');
    expect(sent?.headers.get('authorization')).toBe('Bearer tok');
    expect(sent?.headers.get('x-chatdock-bot')).toBe('support');
    expect(sent?.headers.get('x-chatdock-filename')).toBe(encodeURIComponent('Zdjęcie.jpg'));
  });

  it('opens one session for parallel uploads and renews it as the same visitor', async () => {
    const sessions: Record<string, unknown>[] = [];
    const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (String(input).endsWith('/session')) {
        sessions.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        await new Promise((resolve) => setTimeout(resolve, 5));
        // The first session is about to expire, so the next request renews it.
        const lifetime = sessions.length === 1 ? 10 : 900;
        return Response.json({
          accessToken: `tok-${sessions.length}`,
          expiresAt: Date.now() / 1000 + lifetime,
          resumable: false,
        });
      }
      return Response.json({ attachment: { id: 'h', kind: 'pdf', name: 'a.pdf' } });
    };
    const chat = client(impl as typeof fetch);
    await Promise.all([
      chat.upload(new Blob(['a']), 'a.pdf'),
      chat.upload(new Blob(['b']), 'b.pdf'),
    ]);
    expect(sessions).toHaveLength(1);
    await chat.upload(new Blob(['c']), 'c.pdf');
    expect(sessions).toHaveLength(2);
    expect(sessions[1]).toMatchObject({ accessToken: 'tok-1' });
  });

  it('sends a dictation with the language hints and returns the text', async () => {
    const { fetch, requests } = uploadFetch(() => Response.json({ text: 'Dzień dobry' }));
    const audio = new Blob([new Uint8Array([1])], { type: 'audio/webm' });
    await expect(client(fetch).transcribe(audio, ['pl-PL', 'en'])).resolves.toEqual({
      ok: true,
      text: 'Dzień dobry',
    });
    const [sent] = requests;
    expect(sent?.url).toBe('/api/chat/transcriptions');
    expect(sent?.body).toBe(audio);
    expect(sent?.headers.get('x-chatdock-languages')).toBe('pl-PL,en');
  });

  it("reports the server's message when a file is refused", async () => {
    const { fetch } = uploadFetch(() =>
      Response.json(
        { error: { code: 'invalid_input', message: 'Files can be up to 4 MB.' } },
        { status: 400 },
      ),
    );
    await expect(client(fetch).upload(new Blob(['x']), 'big.pdf')).resolves.toEqual({
      ok: false,
      message: 'Files can be up to 4 MB.',
    });
  });

  it('sends the page context only when it changes within a conversation', async () => {
    const { fetch, calls } = fakeFetch({
      messages: () =>
        new Response(sse([{ type: 'message.start', messageId: 'm' }]), {
          headers: streamHeaders,
        }),
    });
    const chat = client(fetch);
    await chat.send({ text: 'a', context: 'Pricing' }, () => {});
    await chat.send({ text: 'b', context: 'Pricing' }, () => {});
    await chat.send({ text: 'c', context: 'Support' }, () => {});
    chat.reset();
    await chat.send({ text: 'd', context: 'Support' }, () => {});
    const sent = calls.filter((call) => call.url.endsWith('/messages'));
    expect(sent.map((call) => call.body['context'])).toEqual([
      'Pricing',
      undefined,
      'Support',
      'Support',
    ]);
  });

  it('sends attachment handles with the message', async () => {
    const { fetch, calls } = fakeFetch({
      messages: () => new Response(sse([]), { headers: streamHeaders }),
    });
    await client(fetch).send({ text: '', attachments: ['h1', 'h2'] }, () => {});
    expect(calls.at(-1)?.body).toMatchObject({ text: '', attachments: ['h1', 'h2'] });
  });
});

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
    await client(fetch, storage).send({ text: 'Hello' }, (event) => events.push(event));

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
    await client(fetch, storage).send({ text: 'Again' }, () => {});
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
    await client(fetch).send({ text: 'Hi' }, (event) => events.push(event));
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
    await client(fetch, storage).send({ text: 'Hi' }, (event) => events.push(event));
    expect(events).toEqual([{ type: 'error', code: 'not_found', message: 'Not found.' }]);
    expect(storage.get('chatdock:support:resume')).toBeUndefined();
  });

  it('asks for a reload when the server speaks another protocol version', async () => {
    const { fetch } = fakeFetch({
      messages: () =>
        new Response(sse([]), { headers: { ...streamHeaders, 'x-chatdock-protocol': '2' } }),
    });
    const events: ProtocolEvent[] = [];
    await client(fetch).send({ text: 'Hi' }, (event) => events.push(event));
    expect(events).toMatchObject([{ type: 'error', code: 'bot_unavailable' }]);
  });

  it('gives up on a stalled stream', async () => {
    const { fetch } = fakeFetch({
      messages: () => new Response(sse([], { hang: true }), { headers: streamHeaders }),
    });
    const events: ProtocolEvent[] = [];
    await client(fetch, memoryStorage(), 30).send({ text: 'Hi' }, (event) => events.push(event));
    expect(events).toMatchObject([{ type: 'error', code: 'timeout' }]);
  });

  it('reports network failures without throwing', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const events: ProtocolEvent[] = [];
    await client(failing).send({ text: 'Hi' }, (event) => events.push(event));
    expect(events).toMatchObject([{ type: 'error', code: 'upstream_error' }]);
  });
});

describe('conversation history', () => {
  const session = () =>
    Response.json({ accessToken: 't', expiresAt: Date.now() / 1000 + 900, resumable: true });

  function routedFetch(routes: Record<string, (init: RequestInit | undefined) => Response>): {
    fetch: typeof fetch;
    calls: string[];
  } {
    const calls: string[] = [];
    const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const key = `${init?.method ?? 'GET'} ${String(input).replace('/api/chat', '')}`;
      calls.push(key);
      const route = routes[key];
      if (!route) throw new Error(`unexpected ${key}`);
      return route(init);
    };
    return { fetch: impl as typeof fetch, calls };
  }

  it('loads nothing when this browser has no conversation', async () => {
    const { fetch, calls } = routedFetch({});
    expect(await client(fetch).loadHistory()).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('loads and validates the stored conversation', async () => {
    const storage = memoryStorage();
    storage.set('chatdock:support:resume', 'resume-1');
    const { fetch } = routedFetch({
      'POST /session': session,
      'POST /history': (init) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          botId: 'support',
          resumeToken: 'resume-1',
        });
        return Response.json({
          messages: [
            { id: 'a', role: 'user', text: 'Hi', citations: [], attachments: 0 },
            { id: 'b', role: 'assistant', text: 'Hello', citations: [], attachments: 0 },
          ],
        });
      },
    });
    const history = await client(fetch, storage).loadHistory();
    expect(history.map((message) => message.text)).toEqual(['Hi', 'Hello']);
  });

  it('forgets a conversation the server no longer has', async () => {
    const storage = memoryStorage();
    storage.set('chatdock:support:resume', 'stale');
    const { fetch } = routedFetch({
      'POST /session': session,
      'POST /history': () => Response.json({ error: { code: 'not_found' } }, { status: 404 }),
    });
    expect(await client(fetch, storage).loadHistory()).toEqual([]);
    expect(storage.get('chatdock:support:resume')).toBeUndefined();
  });

  it('deletes the conversation on the server and locally', async () => {
    const storage = memoryStorage();
    storage.set('chatdock:support:resume', 'resume-1');
    const { fetch, calls } = routedFetch({
      'POST /session': session,
      'DELETE /conversation': () => new Response(null, { status: 204 }),
    });
    const chat = client(fetch, storage);
    await chat.deleteConversation();
    expect(calls).toContain('DELETE /conversation');
    expect(chat.hasConversation()).toBe(false);
  });
});

describe('ChatClient.identify', () => {
  const session = (fields: Record<string, unknown> = {}) =>
    Response.json({
      accessToken: `access-${Math.random()}`,
      expiresAt: Date.now() / 1000 + 900,
      resumable: true,
      identified: false,
      ...fields,
    });
  const ok = () => new Response(sse([]), { headers: streamHeaders });

  it('sends the identity with every session request, and only a change costs one', async () => {
    let renewals = 0;
    const { fetch, calls } = fakeFetch({
      session: () => session({ identified: true, identityKey: 'k-ada' }),
      // The first message finds the session expired: the renewal carries the identity again.
      messages: () => (renewals++ === 0 ? new Response(null, { status: 401 }) : ok()),
    });
    const chat = client(fetch);
    await chat.identify('ada.jwt.token');
    expect(await chat.identify('ada.jwt.token')).toBe(false);
    await chat.send({ text: 'Hi' }, () => {});
    const sessions = calls.filter((call) => call.url.endsWith('/session'));
    expect(sessions.map((call) => call.body['identityToken'])).toEqual([
      'ada.jwt.token',
      'ada.jwt.token',
    ]);
  });

  it("keeps each user's conversation in its own place, and adopts an anonymous one on sign-in", async () => {
    const storage = memoryStorage();
    storage.set('chatdock:support:resume', 'resume-anonymous');
    let signedIn = true;
    const { fetch } = fakeFetch({
      session: () =>
        signedIn
          ? session({ identified: true, identityKey: 'k-ada', resumeToken: 'resume-adopted' })
          : session(),
      messages: ok,
    });
    const chat = client(fetch, storage);
    expect(await chat.identify('ada.jwt.token')).toBe(true);
    expect(storage.get('chatdock:support:resume:k-ada')).toBe('resume-adopted');
    expect(storage.get('chatdock:support:resume')).toBeUndefined();

    signedIn = false;
    expect(await chat.identify(null)).toBe(true);
    expect(chat.hasConversation()).toBe(false);
    // Still there for Ada, and only for her.
    expect(storage.get('chatdock:support:resume:k-ada')).toBe('resume-adopted');
  });

  it("never sends a request with the previous user's session once they sign out", async () => {
    let failSignOut = false;
    let access = 'access-ada';
    const { fetch, calls } = fakeFetch({
      session: () =>
        failSignOut ? new Response(null, { status: 503 }) : session({ accessToken: access }),
      messages: ok,
    });
    const chat = client(fetch);
    await chat.identify('ada.jwt.token');
    failSignOut = true;
    await chat.identify(null);
    failSignOut = false;
    access = 'access-anonymous';
    await chat.send({ text: 'Hi' }, () => {});
    const message = calls.find((call) => call.url.endsWith('/messages'));
    expect(message?.auth).toBe('Bearer access-anonymous');
    expect(calls.filter((call) => call.url.endsWith('/session')).at(-1)?.body).toMatchObject({
      identityToken: null,
    });
  });
});
