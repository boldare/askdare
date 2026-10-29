import type { ErrorCode, ProtocolEvent } from '../protocol/events';
import { decodeEvent, SseParser } from '../protocol/sse';
import { PROTOCOL_HEADER, PROTOCOL_VERSION } from '../protocol/version';
import type { SafeStorage } from './storage';

export interface ChatClientOptions {
  readonly basePath: string;
  readonly botId: string;
  readonly locale: string;
  readonly storage: SafeStorage;
  readonly fetch?: typeof fetch;
  /** Abort a stream after this long without any bytes (events or heartbeats). Default 45 s. */
  readonly watchdogMs?: number;
}

interface Session {
  readonly accessToken: string;
  /** Unix time in seconds. */
  readonly expiresAt: number;
}

interface ErrorBody {
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
    readonly retryAfterMs?: number;
  };
}

const RENEW_MARGIN_SECONDS = 30;

function errorEvent(code: ErrorCode, message: string, retryAfterMs?: number): ProtocolEvent {
  return { type: 'error', code, message, retryAfterMs };
}

/**
 * Talks to the chatdock API from the iframe: keeps the access token in memory, the resume token
 * in best-effort storage, and turns each send into a stream of protocol events. Network and
 * protocol problems are reported as `error` events, never thrown.
 */
export class ChatClient {
  readonly #options: ChatClientOptions;
  readonly #fetch: typeof fetch;
  readonly #resumeKey: string;
  #session: Session | undefined;

  constructor(options: ChatClientOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#resumeKey = `chatdock:${options.botId}:resume`;
  }

  /** Forgets the stored conversation so the next message starts a new one. */
  reset(): void {
    this.#options.storage.remove(this.#resumeKey);
  }

  async send(
    text: string,
    onEvent: (event: ProtocolEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      let response = await this.#postMessage(text, signal, false);
      if (response.status === 401) response = await this.#postMessage(text, signal, true);
      if (!response.ok || !response.body) {
        onEvent(await this.#errorFromResponse(response));
        return;
      }
      if (response.headers.get(PROTOCOL_HEADER) !== String(PROTOCOL_VERSION)) {
        onEvent(
          errorEvent('bot_unavailable', 'The assistant was updated. Please reload the page.'),
        );
        return;
      }
      await this.#readStream(response.body, onEvent, signal);
    } catch (error) {
      if (signal?.aborted) return;
      onEvent(
        errorEvent(
          error instanceof DOMException && error.name === 'TimeoutError'
            ? 'timeout'
            : 'upstream_error',
          'Connection problem. Please try again.',
        ),
      );
    }
  }

  async #postMessage(
    text: string,
    signal: AbortSignal | undefined,
    renew: boolean,
  ): Promise<Response> {
    const session = await this.#ensureSession(renew, signal);
    const resumeToken = this.#options.storage.get(this.#resumeKey);
    return this.#fetch(`${this.#options.basePath}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({
        botId: this.#options.botId,
        text,
        locale: this.#options.locale,
        ...(resumeToken ? { resumeToken } : {}),
      }),
      ...(signal ? { signal } : {}),
    });
  }

  async #ensureSession(renew: boolean, signal: AbortSignal | undefined): Promise<Session> {
    const now = Date.now() / 1000;
    if (!renew && this.#session && this.#session.expiresAt - RENEW_MARGIN_SECONDS > now) {
      return this.#session;
    }
    const resumeToken = this.#options.storage.get(this.#resumeKey);
    const response = await this.#fetch(`${this.#options.basePath}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ botId: this.#options.botId, ...(resumeToken ? { resumeToken } : {}) }),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error(`Session request failed with ${response.status}`);
    const body = (await response.json()) as {
      accessToken: string;
      expiresAt: number;
      resumable: boolean;
    };
    if (!body.resumable && resumeToken) this.reset();
    this.#session = { accessToken: body.accessToken, expiresAt: body.expiresAt };
    return this.#session;
  }

  async #errorFromResponse(response: Response): Promise<ProtocolEvent> {
    let body: ErrorBody = {};
    try {
      body = (await response.json()) as ErrorBody;
    } catch {
      // Not JSON: fall through to a generic error.
    }
    if (response.status === 404 && body.error?.code === 'not_found') this.reset();
    const result = decodeEvent({
      event: 'error',
      data: JSON.stringify({ type: 'error', ...body.error }),
    });
    return result.ok
      ? result.event
      : errorEvent('upstream_error', 'The assistant is temporarily unavailable. Please try again.');
  }

  async #readStream(
    body: ReadableStream<Uint8Array>,
    onEvent: (event: ProtocolEvent) => void,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    const watchdogMs = this.#options.watchdogMs ?? 45_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stalled = false;
    const arm = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        stalled = true;
        void reader.cancel();
      }, watchdogMs);
    };
    const onAbort = (): void => void reader.cancel();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      arm();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        arm();
        for (const raw of parser.push(decoder.decode(value, { stream: true }))) {
          const result = decodeEvent(raw);
          if (!result.ok) continue;
          if (result.event.type === 'conversation.created') {
            this.#options.storage.set(this.#resumeKey, result.event.resumeToken);
          } else if (result.event.type === 'error' && result.event.code === 'not_found') {
            this.reset(); // the conversation is gone (e.g. deleted by retention): start a new one
          }
          onEvent(result.event);
        }
      }
      if (stalled) onEvent(errorEvent('timeout', 'The connection stalled. Please try again.'));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}
