import type { ErrorCode, ProtocolEvent } from '../protocol/events';
import type { HistoryMessage } from '../protocol/history';
import { decodeEvent, SseParser } from '../protocol/sse';
import { parseHistory } from '../protocol/validate';
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
  /**
   * Looks up a dictionary text (the visitor's language) for an error key; undefined when there is
   * none, which keeps the English message.
   */
  readonly translate?: (
    key: string,
    params?: Readonly<Record<string, string | number>>,
  ) => string | undefined;
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
  /** What the host page says about itself (askdare('configure')); untrusted on the server. */
  readonly context?: string | undefined;
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

type ErrorEvent = Extract<ProtocolEvent, { type: 'error' }>;

/** The server refused a session and said why: a limit, a switched-off bot, a setup problem. */
class SessionRefused extends Error {
  constructor(readonly event: ErrorEvent) {
    super(event.message);
  }
}

/**
 * Talks to the askdare API from the iframe: keeps the access token in memory, the resume token
 * in best-effort storage, and turns each send into a stream of protocol events. Network and
 * protocol problems are reported as `error` events, never thrown.
 */
export class ChatClient {
  readonly #options: ChatClientOptions;
  readonly #fetch: typeof fetch;
  readonly #botId: string;
  #session: Session | undefined;
  /** The page context the current conversation already has, so it is sent only when it changes. */
  #sentContext: string | undefined;
  /** Shared by concurrent callers, so parallel uploads end up with one visitor. */
  #opening: Promise<Session> | undefined;
  /**
   * The page's latest askdare('identify'): a token, or null when signed out (ADR-0009). Sent with
   * every session request, so the server re-checks it and the identity ends with the token.
   */
  #identity: string | null | undefined;
  /** Set when the identity changed: no request may use the previous user's session any more. */
  #identityChanged = false;
  /** Tokens already reported as refused, so a renewal doesn't warn again. */
  #refused: string | undefined;
  /** The signed-in user, as an opaque key from the server; undefined while anonymous. */
  #identityKey: string | undefined;
  /** The previous user's access token while their identity is replaced: renews the visitor only. */
  #renewal: string | undefined;

  constructor(options: ChatClientOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#botId = options.botId;
  }

  /** A client-side error: the dictionary text for `key`, else the English message. */
  #error(code: ErrorCode, key: string, english: string): ErrorEvent {
    return { type: 'error', code, key, message: this.#options.translate?.(key) ?? english };
  }

  /** A server error in the visitor's language when it carries a known key. */
  #localize(event: ErrorEvent): ErrorEvent {
    const text = event.key ? this.#options.translate?.(event.key, event.params) : undefined;
    return text ? { ...event, message: text } : event;
  }

  /**
   * Signs the visitor in (a token from the site's backend) or out (null) right away. Resolves to
   * true when the stored conversation belonged to someone else and is gone from this browser.
   */
  async identify(token: string | null): Promise<boolean> {
    // Single-page apps may repeat it on every route change: only a change costs a request.
    if (token === this.#identity) return false;
    this.#identity = token;
    this.#identityChanged = true;
    await this.#opening?.catch(() => undefined);
    const before = this.#resumeKey();
    // Fail closed: nothing goes out with the previous user's session from here on. If this request
    // fails, the next one opens a session with the new identity instead.
    this.#renewal = this.#session?.accessToken ?? this.#renewal;
    this.#session = undefined;
    try {
      await this.#ensureSession(false);
    } catch {
      // The next request tries again, with the identity still pending.
    }
    return this.#resumeKey() !== before;
  }

  /**
   * Where this browser keeps the conversation: one place per signed-in user and one for anonymous
   * visits, so signing out or in never hands a conversation to someone else, nor loses it.
   */
  #resumeKey(): string {
    const base = `askdare:${this.#botId}:resume`;
    return this.#identityKey ? `${base}:${this.#identityKey}` : base;
  }

  /** Forgets the stored conversation so the next message starts a new one. */
  reset(): void {
    this.#sentContext = undefined;
    this.#options.storage.remove(this.#resumeKey());
  }

  /** True when this browser holds a conversation to resume. */
  hasConversation(): boolean {
    return this.#options.storage.get(this.#resumeKey()) !== undefined;
  }

  /** Loads the visible part of the stored conversation; empty when there is none or it is gone. */
  async loadHistory(signal?: AbortSignal): Promise<readonly HistoryMessage[]> {
    const resumeToken = this.#options.storage.get(this.#resumeKey());
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
    return parseHistory(await response.json())?.messages ?? [];
  }

  /** Deletes the conversation on the server (best effort) and forgets it in this browser. */
  async deleteConversation(): Promise<void> {
    const resumeToken = this.#options.storage.get(this.#resumeKey());
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
            'x-askdare-bot': this.#options.botId,
            'x-askdare-filename': encodeURIComponent(name),
          },
        }),
        signal,
      );
      if (!response.ok) {
        const event = await this.#errorFromResponse(response);
        return { ok: false, message: event.message };
      }
      const body = (await response.json()) as { attachment?: Partial<UploadedFile> };
      const uploaded = body.attachment;
      if (
        typeof uploaded?.id !== 'string' ||
        (uploaded.kind !== 'image' && uploaded.kind !== 'pdf') ||
        typeof uploaded.name !== 'string'
      ) {
        return {
          ok: false,
          message: this.#error(
            'upstream_error',
            'error.uploadFailed',
            'The file could not be uploaded.',
          ).message,
        };
      }
      return { ok: true, file: { id: uploaded.id, kind: uploaded.kind, name: uploaded.name } };
    } catch (error) {
      return { ok: false, message: this.#failure(error, 'upstream_error').message };
    }
  }

  /** Turns a dictation into text. `languages` are hints such as the browser's and the page's language. */
  async transcribe(audio: Blob, languages: readonly string[]): Promise<TranscriptionResult> {
    try {
      const response = await this.#authorized('POST', '/transcriptions', () => ({
        contentType: 'application/octet-stream',
        body: audio,
        headers: {
          'x-askdare-bot': this.#options.botId,
          'x-askdare-languages': languages.join(','),
        },
      }));
      if (!response.ok) {
        const event = await this.#errorFromResponse(response);
        return { ok: false, message: event.message };
      }
      const body = (await response.json()) as { text?: unknown };
      return typeof body.text === 'string'
        ? { ok: true, text: body.text }
        : {
            ok: false,
            message: this.#error(
              'upstream_error',
              'error.transcriptionFailed',
              'The recording could not be transcribed.',
            ).message,
          };
    } catch (error) {
      return { ok: false, message: this.#failure(error, 'upstream_error').message };
    }
  }

  async send(
    message: OutgoingMessage,
    onEvent: (event: ProtocolEvent) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const context = message.context !== this.#sentContext ? message.context : undefined;
    try {
      const response = await this.#authorized(
        'POST',
        '/messages',
        () => {
          const resumeToken = this.#options.storage.get(this.#resumeKey());
          return json({
            botId: this.#options.botId,
            text: message.text,
            locale: this.#options.locale,
            ...(message.attachments?.length ? { attachments: message.attachments } : {}),
            ...(context ? { context } : {}),
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
          this.#error(
            'bot_unavailable',
            'error.updated',
            'The assistant was updated. Please reload the page.',
          ),
        );
        return;
      }
      await this.#readStream(
        response.body,
        (event) => {
          // The turn reached the model, so the conversation now holds this context.
          if (event.type === 'message.start' && context) this.#sentContext = context;
          onEvent(event);
        },
        signal,
      );
    } catch (error) {
      if (signal?.aborted) return;
      onEvent(
        this.#failure(
          error,
          error instanceof DOMException && error.name === 'TimeoutError'
            ? 'timeout'
            : 'upstream_error',
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
    if (
      !renew &&
      !this.#identityChanged &&
      this.#session &&
      this.#session.expiresAt - RENEW_MARGIN_SECONDS > now
    ) {
      return this.#session;
    }
    this.#opening ??= this.#openSession().finally(() => {
      this.#opening = undefined;
    });
    return this.#opening;
  }

  /** Not tied to one caller's signal, because other callers may be waiting for the same session. */
  async #openSession(): Promise<Session> {
    const resumeToken = this.#options.storage.get(this.#resumeKey());
    // The previous access token keeps the same visitor, so files uploaded before a renewal stay theirs.
    const accessToken = this.#session?.accessToken ?? this.#renewal;
    const identityToken = this.#identity;
    const sentFrom = this.#resumeKey();
    const response = await this.#fetch(`${this.#options.basePath}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        botId: this.#options.botId,
        ...(resumeToken ? { resumeToken } : {}),
        ...(accessToken ? { accessToken } : {}),
        ...(identityToken === undefined ? {} : { identityToken }),
      }),
    });
    // A refused session says nothing about the stored conversation: keep it.
    if (!response.ok) throw new SessionRefused(await this.#errorFromResponse(response, false));
    const body = (await response.json()) as {
      accessToken: string;
      expiresAt: number;
      resumable: boolean;
      resumeToken?: string;
      identified?: boolean;
      identityKey?: string;
      identityProblem?: string;
    };
    if (this.#identity === identityToken) this.#identityChanged = false;
    this.#renewal = undefined;
    this.#identityKey = body.identified ? body.identityKey : undefined;
    if (identityToken && !body.identified && this.#refused !== identityToken) {
      this.#refused = identityToken;
      console.warn(
        `[askdare] askdare('identify') was refused (${body.identityProblem ?? 'unknown'}); the chat continues anonymously.`,
      );
    }
    if (body.resumeToken) {
      // Signed in during an anonymous conversation: it is now this user's, kept in their place.
      this.#options.storage.set(this.#resumeKey(), body.resumeToken);
      if (sentFrom !== this.#resumeKey()) this.#options.storage.remove(sentFrom);
    } else if (!body.resumable && resumeToken && sentFrom === this.#resumeKey()) {
      // Gone from the server.
      this.reset();
    }
    this.#session = { accessToken: body.accessToken, expiresAt: body.expiresAt };
    return this.#session;
  }

  /** What to show for a request that threw: the server's reason for refusing a session, if any. */
  #failure(error: unknown, code: ErrorCode): ErrorEvent {
    return error instanceof SessionRefused ? error.event : this.#connectionError(code);
  }

  #connectionError(code: ErrorCode): ErrorEvent {
    return this.#error(code, 'error.connection', 'Connection problem. Please try again.');
  }

  async #errorFromResponse(response: Response, forgetMissing = true): Promise<ErrorEvent> {
    let body: ErrorBody = {};
    try {
      body = (await response.json()) as ErrorBody;
    } catch {
      // Not JSON: fall through to a generic error.
    }
    if (forgetMissing && response.status === 404 && body.error?.code === 'not_found') this.reset();
    const result = decodeEvent({
      event: 'error',
      data: JSON.stringify({ type: 'error', ...body.error }),
    });
    return result.ok && result.event.type === 'error'
      ? this.#localize(result.event)
      : this.#error(
          'upstream_error',
          'error.upstream_error',
          'The assistant is temporarily unavailable. Please try again.',
        );
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
            this.#options.storage.set(this.#resumeKey(), result.event.resumeToken);
          } else if (result.event.type === 'message.end' && result.event.resumeToken) {
            this.#options.storage.set(this.#resumeKey(), result.event.resumeToken);
          } else if (result.event.type === 'error' && result.event.code === 'not_found') {
            this.reset(); // the conversation is gone (e.g. deleted by retention): start a new one
          }
          onEvent(result.event.type === 'error' ? this.#localize(result.event) : result.event);
        }
      }
      if (stalled) {
        onEvent(
          this.#error('timeout', 'error.stalled', 'The connection stalled. Please try again.'),
        );
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}
