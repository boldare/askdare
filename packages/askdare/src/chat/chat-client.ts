import type { ErrorCode, ProtocolEvent } from '../protocol/events';
import type { HistoryResponse } from '../protocol/history';
import { decodeEvent, SseParser } from '../protocol/sse';
import { parseHistory } from '../protocol/validate';
import { PROTOCOL_HEADER, PROTOCOL_VERSION } from '../protocol/version';
import type { ChatWidget } from './config';
import type { SafeStorage } from './storage';

/** The parts of a widget a language switch replaces, checked before use. */
function isWidget(value: unknown): value is ChatWidget {
  if (typeof value !== 'object' || value === null) return false;
  const widget = value as Record<string, unknown>;
  const texts = widget['texts'];
  return (
    ['locale', 'title', 'greeting', 'placeholder', 'launcherLabel'].every(
      (key) => typeof widget[key] === 'string',
    ) &&
    typeof texts === 'object' &&
    texts !== null &&
    Object.values(texts).every((text) => typeof text === 'string')
  );
}

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
   * none, which keeps the server's message (or, for the client's own errors, shows the key).
   */
  readonly translate?: (
    key: string,
    params?: Readonly<Record<string, string | number>>,
  ) => string | undefined;
  /**
   * For a bot with a human check: a fresh token from its challenge, asked for when a session
   * starts without one to renew. Rejects when the visitor couldn't pass it.
   */
  readonly humanToken?: () => Promise<string>;
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

/** Waits `ms`, or less when the signal aborts. */
const pause = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

type ErrorEvent = Extract<ProtocolEvent, { type: 'error' }>;

/** The server refused a session and said why: a limit, a switched-off bot, a setup problem. */
export class SessionRefused extends Error {
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
  /** The visitor's language, sent with each message; it changes when the page switches it. */
  #locale: string;
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
    this.#locale = options.locale;
  }

  /** The language sent with each message from now on (ADR-0014, step 2). */
  setLocale(locale: string): void {
    this.#locale = locale;
  }

  /**
   * The bot's public widget settings in another language, from `GET /config/<bot>`, with the
   * language its texts are written in; undefined when they can't be read. Never throws.
   */
  async fetchWidget(
    locale: string,
  ): Promise<{ readonly widget: ChatWidget; readonly language: string } | undefined> {
    const query = new URLSearchParams({ lang: locale });
    try {
      const response = await this.#fetch(
        `${this.#options.basePath}/config/${encodeURIComponent(this.#botId)}?${query}`,
      );
      if (!response.ok) return undefined;
      const body = (await response.json()) as { readonly widget?: unknown } | null;
      if (!isWidget(body?.widget)) return undefined;
      const language = response.headers.get('content-language');
      return { widget: body.widget, language: language || body.widget.locale };
    } catch {
      return undefined;
    }
  }

  /**
   * A client-side error with the dictionary text for `key`. The chat's dictionary has every key,
   * so the key itself shows only when a client was made without one.
   */
  #error(code: ErrorCode, key: string): ErrorEvent {
    return { type: 'error', code, key, message: this.#options.translate?.(key) ?? key };
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
    // Signing out with no session: nothing to replace, and a bot with a human check shouldn't
    // challenge before the visitor does anything. The next session carries the sign-out.
    if (
      token === null &&
      this.#options.humanToken &&
      !this.#session &&
      !this.#opening &&
      !this.#renewal &&
      !this.#identityKey
    ) {
      return false;
    }
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

  /**
   * Loads a page of the stored conversation: the latest, or with `before` the page before the one
   * that gave it. The latest is empty when there is no conversation or it is gone. Throws on other
   * failures, with the status as `cause` (400: the server refused `before`; 404 for an older page:
   * the conversation is gone, and is forgotten).
   */
  async loadHistory(signal?: AbortSignal, before?: string): Promise<HistoryResponse> {
    const resumeToken = this.#options.storage.get(this.#resumeKey());
    if (!resumeToken) return { messages: [] };
    const response = await this.#authorized(
      'POST',
      '/history',
      // JSON leaves `before` out when it is undefined: the latest page.
      () => json({ botId: this.#options.botId, resumeToken, before }),
      signal,
    );
    if (response.status === 404) this.reset();
    // Gone while older messages show: the caller must say so, not show an empty start.
    if (response.status === 404 && !before) return { messages: [] };
    if (!response.ok) {
      throw new Error(`History request failed with ${response.status}`, {
        cause: response.status,
      });
    }
    return parseHistory(await response.json()) ?? { messages: [] };
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

  /** This browser's ratings of answers, by feedback key (ADR-0012: askdare stores none). */
  ratings(): Readonly<Record<string, 'up' | 'down'>> {
    try {
      const stored: unknown = JSON.parse(this.#options.storage.get(this.#ratingsKey()) ?? '{}');
      if (typeof stored !== 'object' || stored === null) return {};
      return Object.fromEntries(
        Object.entries(stored).filter(
          (entry): entry is [string, 'up' | 'down'] => entry[1] === 'up' || entry[1] === 'down',
        ),
      );
    } catch {
      return {};
    }
  }

  /** Remembers a rating, or forgets it with null. Only the latest hundred are kept. */
  rememberRating(key: string, rating: 'up' | 'down' | null): void {
    const { [key]: _previous, ...others } = this.ratings();
    const entries = Object.entries(rating ? { ...others, [key]: rating } : others).slice(-100);
    this.#options.storage.set(this.#ratingsKey(), JSON.stringify(Object.fromEntries(entries)));
  }

  #ratingsKey(): string {
    return `askdare:${this.#botId}:ratings`;
  }

  /**
   * Sends a rating of one answer (null takes it back) with an optional comment; `handle` comes
   * with the answer. Resolves to what went wrong, in the visitor's language, or undefined.
   */
  async rate(
    handle: string,
    rating: 'up' | 'down' | null,
    comment?: string,
  ): Promise<string | undefined> {
    try {
      const response = await this.#authorized('POST', '/feedback', () =>
        json({
          botId: this.#options.botId,
          feedback: handle,
          rating,
          ...(comment ? { comment } : {}),
        }),
      );
      return response.ok ? undefined : (await this.#errorFromResponse(response, false)).message;
    } catch (error) {
      return this.#failure(error, 'upstream_error').message;
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
          message: this.#error('upstream_error', 'error.uploadFailed').message,
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
            message: this.#error('upstream_error', 'error.transcriptionFailed').message,
          };
    } catch (error) {
      return { ok: false, message: this.#failure(error, 'upstream_error').message };
    }
  }

  /**
   * Sends a message and reports its answer's events. A stream that ends before the answer does is
   * resumed after its last event (ADR-0027): up to three attempts in a row that bring nothing new,
   * with backoff, and `onRetry` called before each. Resolves to the error to show when the answer
   * was lost on the way, which the caller may still find in the history; other problems arrive as
   * `error` events.
   */
  async send(
    message: OutgoingMessage,
    onEvent: (event: ProtocolEvent) => void,
    signal?: AbortSignal,
    onRetry?: () => void,
  ): Promise<ErrorEvent | undefined> {
    const context = message.context !== this.#sentContext ? message.context : undefined;
    const { botId } = this.#options;
    /** The answer's ID once it starts, and the sequence number of the last event received. */
    let answer: string | undefined;
    let seq = 0;
    let ended = false;
    let lost = this.#connectionError('upstream_error');
    let path = '/messages';
    let request = (): RequestBody => {
      const resumeToken = this.#options.storage.get(this.#resumeKey());
      return json({
        botId,
        text: message.text,
        locale: this.#locale,
        ...(message.attachments?.length ? { attachments: message.attachments } : {}),
        ...(context ? { context } : {}),
        ...(resumeToken ? { resumeToken } : {}),
      });
    };
    // `tries` counts the attempts in a row that brought nothing new; `resumes` all of them, so a
    // connection that keeps dropping can't run into the server's limit of resumes.
    for (let tries = 0, resumes = 0; ; ) {
      const from = seq;
      try {
        const response = await this.#authorized('POST', path, request, signal);
        // A resume the server can't serve (404: the answer's events are gone): try the history.
        if (answer && !response.ok) return lost;
        if (!response.ok || !response.body) {
          onEvent(await this.#errorFromResponse(response));
          return;
        }
        if (response.headers.get(PROTOCOL_HEADER) !== String(PROTOCOL_VERSION)) {
          onEvent(this.#error('bot_unavailable', 'error.updated'));
          return;
        }
        const stalled = await this.#readStream(
          response.body,
          (event, id) => {
            // Each event has its number in the turn: one seen before came again on a resume.
            if (id > 0) {
              if (id <= seq) return;
              seq = id;
            }
            if (event.type === 'message.start') {
              answer = event.messageId;
              // The turn reached the model, so the conversation now holds this context.
              if (context) this.#sentContext = context;
            }
            ended ||= event.type === 'message.end' || event.type === 'error';
            onEvent(event);
          },
          signal,
        );
        if (ended || signal?.aborted) return;
        if (stalled) {
          lost = this.#error('timeout', 'error.stalled');
        }
      } catch (error) {
        if (signal?.aborted) return;
        if (error instanceof SessionRefused) {
          onEvent(error.event);
          return;
        }
      }
      if (seq > from) tries = 0;
      // Without the answer's ID nothing can be resumed.
      if (!answer || ++tries > 3 || ++resumes > 10) return lost;
      onRetry?.();
      await pause(500 * 4 ** (tries - 1), signal);
      if (signal?.aborted) return;
      const messageId = answer;
      path = '/resume';
      request = () =>
        json({
          botId,
          resumeToken: this.#options.storage.get(this.#resumeKey()),
          messageId,
          after: seq,
        });
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
  async #openSession(stale?: string): Promise<Session> {
    const resumeToken = this.#options.storage.get(this.#resumeKey());
    // The previous access token keeps the same visitor, so files uploaded before a renewal stay theirs.
    const accessToken = stale ?? this.#session?.accessToken ?? this.#renewal;
    const identityToken = this.#identity;
    const sentFrom = this.#resumeKey();
    // A renewal needs no human check; a new session, or one the server won't renew, does (ADR-0023).
    const humanToken = accessToken && !stale ? undefined : await this.#humanToken();
    const response = await this.#fetch(`${this.#options.basePath}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        botId: this.#options.botId,
        ...(resumeToken ? { resumeToken } : {}),
        ...(accessToken ? { accessToken } : {}),
        ...(identityToken === undefined ? {} : { identityToken }),
        ...(humanToken ? { humanToken } : {}),
      }),
    });
    if (response.status === 401 && accessToken && !stale && this.#options.humanToken) {
      // The server won't renew this session without a new human check (too old, or the check
      // too long ago). Drop the token now, so no later attempt sends it again, and check once,
      // still with it, so the server can keep the visitor.
      this.#session = undefined;
      this.#renewal = undefined;
      return this.#openSession(accessToken);
    }
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

  /** A token from the bot's human check, or undefined for a bot without one. */
  async #humanToken(): Promise<string | undefined> {
    if (!this.#options.humanToken) return undefined;
    try {
      return await this.#options.humanToken();
    } catch {
      throw new SessionRefused(this.#error('unauthorized', 'error.humanCheck'));
    }
  }

  /** What to show for a request that threw: the server's reason for refusing a session, if any. */
  #failure(error: unknown, code: ErrorCode): ErrorEvent {
    return error instanceof SessionRefused ? error.event : this.#connectionError(code);
  }

  #connectionError(code: ErrorCode): ErrorEvent {
    return this.#error(code, 'error.connection');
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
      : this.#error('upstream_error', 'error.upstream_error');
  }

  async #readStream(
    body: ReadableStream<Uint8Array>,
    onEvent: (event: ProtocolEvent, id: number) => void,
    signal: AbortSignal | undefined,
  ): Promise<boolean> {
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
          onEvent(
            result.event.type === 'error' ? this.#localize(result.event) : result.event,
            Number(raw.id),
          );
        }
      }
      return stalled;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}
