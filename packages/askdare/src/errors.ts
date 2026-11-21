import type { TextKey } from './i18n/texts';
import type { ErrorCode } from './protocol/events';

const HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
  invalid_input: 400,
  unauthorized: 401,
  session_expired: 401,
  not_found: 404,
  content_blocked: 422,
  rate_limited: 429,
  budget_exceeded: 429,
  internal_error: 500,
  upstream_error: 502,
  bot_unavailable: 503,
  timeout: 504,
};

const DEFAULT_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  invalid_input: 'The request was invalid.',
  unauthorized: 'Authentication is required.',
  session_expired: 'Your session has expired. Please try again.',
  not_found: 'Not found.',
  content_blocked: 'This message cannot be processed.',
  rate_limited: 'Too many messages. Please wait a moment.',
  budget_exceeded: 'The assistant is unavailable for the rest of the day.',
  internal_error: 'Something went wrong. Please try again.',
  upstream_error: 'The assistant is temporarily unavailable. Please try again.',
  bot_unavailable: 'The assistant is currently unavailable.',
  timeout: 'The assistant took too long to respond. Please try again.',
};

export interface AskdareErrorOptions {
  /** Shown to end users, so it must never contain internals. Defaults to a generic message. */
  readonly message?: string;
  /**
   * Dictionary key the widget shows instead of `message`, in the visitor's language. Defaults to
   * `error.<code>` when there is no custom message; developer-facing messages have none.
   */
  readonly key?: TextKey;
  readonly params?: Readonly<Record<string, string | number>>;
  readonly retryAfterMs?: number;
  /** Internal detail for server-side logs only. */
  readonly cause?: unknown;
}

/** An error with a stable, client-safe code. Anything else that escapes becomes `internal_error`. */
export class AskdareError extends Error {
  override readonly name: 'AskdareError' = 'AskdareError';
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryAfterMs: number | undefined;
  readonly key: TextKey | undefined;
  readonly params: Readonly<Record<string, string | number>> | undefined;

  constructor(code: ErrorCode, options: AskdareErrorOptions = {}) {
    super(options.message ?? DEFAULT_MESSAGES[code], { cause: options.cause });
    this.code = code;
    this.status = HTTP_STATUS[code];
    this.retryAfterMs = options.retryAfterMs;
    this.key = options.key ?? (options.message === undefined ? `error.${code}` : undefined);
    this.params = options.params;
  }
}

/** The caller's own signal aborted the work (for example, the visitor closed the chat). Not an error to report. */
export class TurnAbortedError extends Error {
  override readonly name: 'TurnAbortedError' = 'TurnAbortedError';
}

/** Normalizes anything thrown into a {@link AskdareError} without exposing its details. */
export function toAskdareError(error: unknown): AskdareError {
  return error instanceof AskdareError
    ? error
    : new AskdareError('internal_error', { cause: error });
}

/** API keys never reach a log line, a report or the chat: `sk-proj-abc…` keeps only its prefix. */
export function scrub(text: string): string {
  return text.replace(/\b(sk|rk)-[A-Za-z0-9_-]{6,}/g, (key) => `${key.slice(0, 3)}…`);
}

/** Longer quoted values in an error message may be the visitor's text, not configuration. */
const LONG_QUOTE = /(['"`])[^'"`]{33,}\1/g;
const MAX_MESSAGE = 300;

/**
 * An error message fit for a log line: API keys cut down to their prefix (a 401 quotes part of the
 * key), quoted values longer than 32 characters replaced (a 400 can quote the value it rejected,
 * which may be what the visitor wrote), and the whole capped. Model names, parameters and IDs stay.
 */
export function loggableMessage(message: string): string {
  const text = scrub(message).replace(LONG_QUOTE, (_, quote: string) => `${quote}[…]${quote}`);
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}…` : text;
}

/**
 * The cause of an error as the server logs it when no `onError` is set (ADR-0004: no content in
 * logs): an `Error` keeps its name, stack frames and status, code and request ID, with its message
 * passed through {@link loggableMessage}; a string is cleaned the same way; anything else is
 * logged as its type only.
 */
export function forLog(cause: unknown): unknown {
  if (cause === undefined) return undefined;
  if (typeof cause === 'string') return loggableMessage(cause);
  if (!(cause instanceof Error)) return `[${typeof cause}]`;
  const copy = new Error(loggableMessage(cause.message));
  copy.name = cause.name;
  const frames = (cause.stack ?? '').split('\n').filter((line) => /^\s+at /.test(line));
  copy.stack = [`${copy.name}: ${copy.message}`, ...frames].join('\n');
  const { status, code, requestId } = cause as Error & Record<string, unknown>;
  return Object.assign(copy, {
    ...(status === undefined ? {} : { status }),
    ...(code === undefined ? {} : { code }),
    ...(requestId === undefined ? {} : { requestId }),
  });
}
