// A chat route in memory for tests of the store and the React layer: no network, no OpenAI.
import { textsFor } from '../../i18n/texts';
import type { ProtocolEvent } from '../../protocol/events';
import type { HistoryMessage } from '../../protocol/history';
import { encodeComment, encodeEvent } from '../../protocol/sse';
import { PRESETS } from '../../theme/presets';
import { ChatClient } from '../chat-client';
import type { ChatConfig } from '../config';
import { memoryStorage, type SafeStorage } from '../storage';

export interface FakeRequest {
  readonly path: string;
  readonly method: string;
  readonly body: Record<string, unknown>;
}

export interface FakeServerOptions {
  /** Events streamed back for each message; by default an echo of the text. */
  readonly answer?: (text: string) => readonly ProtocolEvent[];
  readonly history?: readonly HistoryMessage[];
  /** Holds every `/history` response until `release()`. */
  readonly holdHistory?: boolean;
  readonly transcript?: string;
  readonly identityKey?: (token: string) => string;
}

export interface FakeServer {
  readonly fetch: typeof fetch;
  readonly requests: FakeRequest[];
  release(): void;
}

const encoder = new TextEncoder();

export const echo = (text: string): readonly ProtocolEvent[] => [
  { type: 'conversation.created', resumeToken: 'resume-1' },
  { type: 'message.start', messageId: 'msg_1' },
  { type: 'text.delta', messageId: 'msg_1', delta: `You said: ${text}` },
  { type: 'message.end', messageId: 'msg_1', reason: 'completed' },
];

export function fakeServer(options: FakeServerOptions = {}): FakeServer {
  const requests: FakeRequest[] = [];
  let release = (): void => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const path = String(input).replace('/api/chat', '');
    const method = init?.method ?? 'GET';
    const text = typeof init?.body === 'string' ? init.body : '{}';
    const body = JSON.parse(text) as Record<string, unknown>;
    requests.push({ path, method, body });
    switch (path) {
      case '/session': {
        const token = typeof body['identityToken'] === 'string' ? body['identityToken'] : undefined;
        return Response.json({
          accessToken: `access-${requests.length}`,
          expiresAt: Date.now() / 1000 + 900,
          resumable: body['resumeToken'] !== undefined,
          ...(token && options.identityKey
            ? { identified: true, identityKey: options.identityKey(token) }
            : {}),
        });
      }
      case '/history':
        if (options.holdHistory) await held;
        if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        return Response.json({ messages: options.history ?? [] });
      case '/messages': {
        const events = (options.answer ?? echo)(String(body['text']));
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(encodeComment('ok')));
            for (const event of events) controller.enqueue(encoder.encode(encodeEvent(event)));
            controller.close();
          },
        });
        return new Response(stream, {
          headers: { 'content-type': 'text/event-stream', 'x-askdare-protocol': '1' },
        });
      }
      case '/conversation':
        return new Response(null, { status: 204 });
      case '/transcriptions':
        return Response.json({ text: options.transcript ?? 'Dictated text' });
      case '/attachments':
        return Response.json({ attachment: { id: 'file-handle', kind: 'pdf', name: 'doc.pdf' } });
      default:
        return Response.json({ error: { code: 'not_found' } }, { status: 404 });
    }
  };
  return { fetch: impl as typeof fetch, requests, release: () => release() };
}

export function testConfig(change: Partial<ChatConfig> = {}): ChatConfig {
  const texts = textsFor('en', {});
  return {
    protocolVersion: 1,
    basePath: '/api/chat',
    botId: 'support',
    pageContext: false,
    feedback: false,
    widget: {
      title: 'Brightloop assistant',
      subtitle: '',
      greeting: 'Hi! How can I help?',
      placeholder: 'Ask anything',
      locale: 'en',
      starters: ['What does the Business plan include?'],
      avatar: undefined,
      launcherLabel: 'Ask',
      disclosure: { privacyUrl: undefined },
      preset: 'aura',
      variants: PRESETS.aura.variants,
      colorScheme: 'auto',
      texts,
    },
    ...change,
  };
}

export function testClient(server: FakeServer, storage: SafeStorage = memoryStorage()): ChatClient {
  return new ChatClient({
    basePath: '/api/chat',
    botId: 'support',
    locale: 'en',
    storage,
    fetch: server.fetch,
  });
}
