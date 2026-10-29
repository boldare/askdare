import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  NotFoundError,
} from 'openai';
import { ChatdockError, TurnAbortedError } from '../errors';

function retryAfterMs(headers: Headers | undefined): number | undefined {
  const ms = Number(headers?.get('retry-after-ms'));
  if (Number.isFinite(ms) && ms > 0) return Math.round(ms);
  const seconds = Number(headers?.get('retry-after'));
  if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 1000);
  return undefined;
}

/**
 * Maps SDK failures to client-safe errors. The SDK error is kept as `cause` for server logs only.
 * `deadlineExceeded` tells a server-side timeout apart from the visitor disconnecting.
 */
export function fromOpenAIError(error: unknown, deadlineExceeded: boolean): Error {
  if (error instanceof ChatdockError || error instanceof TurnAbortedError) return error;
  const isAbort =
    error instanceof APIUserAbortError ||
    (error instanceof DOMException &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')) ||
    (error instanceof Error && error.name === 'AbortError');
  if (isAbort) {
    return deadlineExceeded
      ? new ChatdockError('timeout', { cause: error })
      : new TurnAbortedError('Turn aborted by the caller.', { cause: error });
  }
  if (error instanceof APIConnectionTimeoutError)
    return new ChatdockError('timeout', { cause: error });
  if (error instanceof APIConnectionError)
    return new ChatdockError('upstream_error', { cause: error });
  if (error instanceof NotFoundError) {
    // Verified live (spike S1): a misconfigured model answers 404 `model_not_found`, a deleted
    // conversation answers 404 "Conversation with id '…' not found". Only the latter resets the chat.
    if (error.code === 'model_not_found')
      return new ChatdockError('bot_unavailable', { cause: error });
    if (/conversation/i.test(error.message)) {
      return new ChatdockError('not_found', {
        message: 'This conversation is no longer available.',
        key: 'error.conversationGone',
        cause: error,
      });
    }
    return new ChatdockError('upstream_error', { cause: error });
  }
  if (error instanceof APIError) {
    if (error.status === 401 || error.status === 403) {
      return new ChatdockError('bot_unavailable', { cause: error });
    }
    const retry = error.status === 429 ? retryAfterMs(error.headers) : undefined;
    return new ChatdockError('upstream_error', {
      cause: error,
      ...(retry === undefined ? {} : { retryAfterMs: retry }),
    });
  }
  return new ChatdockError('internal_error', { cause: error });
}
