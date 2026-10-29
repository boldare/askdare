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

export interface ChatdockErrorOptions {
  /** Shown to end users, so it must never contain internals. Defaults to a generic message. */
  readonly message?: string;
  readonly retryAfterMs?: number;
  /** Internal detail for server-side logs only. */
  readonly cause?: unknown;
}

/** An error with a stable, client-safe code. Anything else that escapes becomes `internal_error`. */
export class ChatdockError extends Error {
  override readonly name: 'ChatdockError' = 'ChatdockError';
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryAfterMs: number | undefined;

  constructor(code: ErrorCode, options: ChatdockErrorOptions = {}) {
    super(options.message ?? DEFAULT_MESSAGES[code], { cause: options.cause });
    this.code = code;
    this.status = HTTP_STATUS[code];
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** The caller's own signal aborted the work (for example, the visitor closed the chat). Not an error to report. */
export class TurnAbortedError extends Error {
  override readonly name: 'TurnAbortedError' = 'TurnAbortedError';
}

/** Normalizes anything thrown into a {@link ChatdockError} without exposing its details. */
export function toChatdockError(error: unknown): ChatdockError {
  return error instanceof ChatdockError
    ? error
    : new ChatdockError('internal_error', { cause: error });
}
