import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  NotFoundError,
} from 'openai';
import { AskdareError, scrub, TurnAbortedError } from '../errors';

/**
 * What OpenAI said, for logs and the developer: status, code and request ID, with any API key in
 * the message cut down to its prefix (a 401 quotes part of the key).
 */
function redacted(error: APIError): Error {
  const copy = new Error(scrub(error.message));
  copy.name = error.name;
  return Object.assign(copy, {
    status: error.status,
    code: error.code,
    requestId: error.requestID,
  });
}

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
  if (error instanceof AskdareError || error instanceof TurnAbortedError) return error;
  const isAbort =
    error instanceof APIUserAbortError ||
    (error instanceof DOMException &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')) ||
    (error instanceof Error && error.name === 'AbortError');
  if (isAbort) {
    return deadlineExceeded
      ? new AskdareError('timeout', { cause: error })
      : new TurnAbortedError('Turn aborted by the caller.', { cause: error });
  }
  if (error instanceof APIConnectionTimeoutError)
    return new AskdareError('timeout', { cause: error });
  if (error instanceof APIConnectionError)
    return new AskdareError('upstream_error', { cause: error });
  if (error instanceof NotFoundError) {
    // Verified live (spike S1): a misconfigured model answers 404 `model_not_found`, a deleted
    // conversation answers 404 "Conversation with id '…' not found". Only the latter resets the chat.
    if (error.code === 'model_not_found')
      return new AskdareError('bot_unavailable', { cause: redacted(error) });
    if (/conversation/i.test(error.message)) {
      return new AskdareError('not_found', {
        message: 'This conversation is no longer available.',
        key: 'error.conversationGone',
        cause: redacted(error),
      });
    }
    return new AskdareError('upstream_error', { cause: redacted(error) });
  }
  if (error instanceof APIError) {
    if (error.status === 401 || error.status === 403) {
      return new AskdareError('bot_unavailable', { cause: redacted(error) });
    }
    const retry = error.status === 429 ? retryAfterMs(error.headers) : undefined;
    return new AskdareError('upstream_error', {
      cause: redacted(error),
      ...(retry === undefined ? {} : { retryAfterMs: retry }),
    });
  }
  return new AskdareError('internal_error', { cause: error });
}
