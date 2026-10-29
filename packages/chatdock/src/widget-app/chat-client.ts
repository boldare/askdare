import type { ErrorCode, ProtocolEvent } from '../protocol/events';
import { type HistoryMessage, historyResponseSchema } from '../protocol/history';
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

export interface OutgoingMessage {
  readonly text: string;
  /** Handles returned by {@link ChatClient.upload}. */
  readonly attachments?: readonly string[];
}

export interface UploadedFile {
  /** Opaque handle to send with the message. */
  readonly id: string;
  readonly kind: 'image' | 'pdf';
  readonly name: string;
}

export type TranscriptionResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly message: string };

export type UploadResult =
  | { readonly ok: true; readonly file: UploadedFile }
  | { readonly ok: false; readonly message: string };

interface RequestBody {
  readonly contentType: string;
  readonly body: BodyInit;
  readonly headers?: Record<string, string>;
}

const json = (value: unknown): RequestBody => ({
  contentType: 'application/json',
  body: JSON.stringify(value),
});

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
  /** Shared by concurrent callers, so parallel uploads end up with one visitor. */
  #opening: Promise<Session> | undefined;

  constructor(options: ChatClientOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#resumeKey = `chatdock:${options.botId}:resume`;
  }

  /** Forgets the stored conversation so the next message starts a new one. */
  reset(): void {
    this.#options.storage.remove(this.#resumeKey);
  }

  /** True when this browser holds a conversation to resume. */
  hasConversation(): boolean {
    return this.#options.storage.get(this.#resumeKey) !== undefined;
  }

  /** Loads the visible part of the stored conversation; empty when there is none or it is gone. */
  async loadHistory(signal?: AbortSignal): Promise<readonly HistoryMessage[]> {
    const resumeToken = this.#options.storage.get(this.#resumeKey);
    if (!resumeToken) return [];
    const response = await this.#authorized(
      'POST',
      '/history',
      () => json({ botId: this.#options.botId, resumeToken }),
      signal,
    );
    if (response.status === 404) {
      this.reset();
      return [];
    }
    if (!response.ok) throw new Error(`History request failed with ${response.status}`);
    const parsed = historyResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.messages : [];
  }

  /** Deletes the conversation on the server (best effort) and forgets it in this browser. */
  async deleteConversation(): Promise<void> {
    const resumeToken = this.#options.storage.get(this.#resumeKey);
    try {
      if (resumeToken) {
        await this.#authorized('DELETE', '/conversation', () =>
          json({ botId: this.#options.botId, resumeToken }),
        );
      }
    } finally {
      this.reset();
    }
  }

  /** Uploads one file for the next message. The server checks its type and size again. */
  async upload(file: Blob, name: string, signal?: AbortSignal): Promise<UploadResult> {
    try {
      const response = await this.#authorized(
        'POST',
        '/attachments',
        () => ({
          contentType: 'application/octet-stream',
          body: file,
          headers: {
            'x-chatdock-bot': this.#options.botId,
            'x-chatdock-filename': encodeURIComponent(name),
          },
        }),
        signal,
      );
      if (!response.ok) {
        const event = await this.#errorFromResponse(response);
        return { ok: false, message: event.type === 'error' ? event.message : 'Upload failed.' };
      }
      const body = (await response.json()) as { attachment?: Partial<UploadedFile> };
      const uploaded = body.attachment;
      if (
        typeof uploaded?.id !== 'string' ||
        (uploaded.kind !== 'image' && uploaded.kind !== 'pdf') ||
        typeof uploaded.name !== 'string'
      ) {
        return { ok: false, message: 'Upload failed.' };
      }
      return { ok: true, file: { id: uploaded.id, kind: uploaded.kind, name: uploaded.name } };
    } catch {
      return { ok: false, message: 'Connection problem. Please try again.' };
    }
  }

  /** Turns a dictation into text. `languages` are hints such as the browser's and the page's language. */
  async transcribe(audio: Blob, languages: readonly string[]): Promise<TranscriptionResult> {
    try {
      const response = await this.#authorized('POST', '/transcriptions', () => ({
        contentType: 'application/octet-stream',
        body: audio,
        headers: {
          'x-chatdock-bot': this.#options.botId,
          'x-chatdock-languages': languages.join(','),
        },
      }));
      if (!response.ok) {
        const event = await this.#errorFromResponse(response);
        return {
          ok: false,
          message: event.type === 'error' ? event.message : 'Transcription failed.',
        };
      }
      const body = (await response.json()) as { text?: unknown };
      return typeof body.text === 'string'
        ? { ok: true, text: body.text }
        : { ok: false, message: 'Transcription failed.' };
    } catch {
      return { ok: false, message: 'Connection problem. Please try again.' };
    }
  }

  async send(
    message: OutgoingMessage,
    onEvent: (event: ProtocolEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      const response = await this.#authorized(
        'POST',
        '/messages',
        () => {
          const resumeToken = this.#options.storage.get(this.#resumeKey);
          return json({
            botId: this.#options.botId,
            text: message.text,
            locale: this.#options.locale,
            ...(message.attachments?.length ? { attachments: message.attachments } : {}),
            ...(resumeToken ? { resumeToken } : {}),
          });
        },
        signal,
      );
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

  /** Sends an authenticated request, renewing an expired session once. */
  async #authorized(
    method: 'POST' | 'DELETE',
    path: string,
    request: () => RequestBody,
    signal?: AbortSignal,
  ): Promise<Response> {
    const attempt = async (renew: boolean): Promise<Response> => {
      const session = await this.#ensureSession(renew);
      const { contentType, body, headers } = request();
      return this.#fetch(`${this.#options.basePath}${path}`, {
        method,
        headers: {
          ...headers,
          'content-type': contentType,
          authorization: `Bearer ${session.accessToken}`,
        },
        body,
        ...(signal ? { signal } : {}),
      });
    };
    const first = await attempt(false);
    return first.status === 401 ? attempt(true) : first;
  }

  async #ensureSession(renew: boolean): Promise<Session> {
    const now = Date.now() / 1000;
    if (!renew && this.#session && this.#session.expiresAt - RENEW_MARGIN_SECONDS > now) {
      return this.#session;
    }
    this.#opening ??= this.#openSession().finally(() => {
      this.#opening = undefined;
    });
    return this.#opening;
  }

  /** Not tied to one caller's signal, because other callers may be waiting for the same session. */
  async #openSession(): Promise<Session> {
    const resumeToken = this.#options.storage.get(this.#resumeKey);
    // The previous access token keeps the same visitor, so files uploaded before a renewal stay theirs.
    const accessToken = this.#session?.accessToken;
    const response = await this.#fetch(`${this.#options.basePath}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        botId: this.#options.botId,
        ...(resumeToken ? { resumeToken } : {}),
        ...(accessToken ? { accessToken } : {}),
      }),
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
