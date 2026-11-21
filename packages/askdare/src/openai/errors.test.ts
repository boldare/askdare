import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  NotFoundError,
} from 'openai';
import { describe, expect, it } from 'vitest';
import { AskdareError, loggableMessage, TurnAbortedError } from '../errors';
import { fromOpenAIError } from './errors';

const apiError = (status: number, body: object, headers: Record<string, string> = {}): APIError =>
  APIError.generate(status, { error: body }, undefined, new Headers(headers));

const asAskdare = (error: Error): AskdareError => {
  expect(error).toBeInstanceOf(AskdareError);
  return error as AskdareError;
};

const causeOf = (error: Error): Error & Record<string, unknown> =>
  (error as Error & { cause: Error & Record<string, unknown> }).cause;

describe('fromOpenAIError', () => {
  it('passes askdare errors and aborted turns through unchanged', () => {
    const own = new AskdareError('rate_limited');
    const aborted = new TurnAbortedError('gone');
    expect(fromOpenAIError(own, false)).toBe(own);
    expect(fromOpenAIError(aborted, true)).toBe(aborted);
  });

  it('tells a server deadline apart from the visitor leaving', () => {
    for (const abort of [
      new APIUserAbortError(),
      new DOMException('stop', 'AbortError'),
      new DOMException('late', 'TimeoutError'),
      Object.assign(new Error('stop'), { name: 'AbortError' }),
    ]) {
      expect(asAskdare(fromOpenAIError(abort, true)).code).toBe('timeout');
      expect(fromOpenAIError(abort, false)).toBeInstanceOf(TurnAbortedError);
    }
  });

  it('maps connection failures, checking timeouts first', () => {
    expect(asAskdare(fromOpenAIError(new APIConnectionTimeoutError(), false)).code).toBe('timeout');
    expect(asAskdare(fromOpenAIError(new APIConnectionError({}), false)).code).toBe(
      'upstream_error',
    );
  });

  it('makes a missing model the operator’s problem and a deleted conversation the visitor’s', () => {
    const model = apiError(404, {
      code: 'model_not_found',
      message: "The model 'x' does not exist",
    });
    expect(model).toBeInstanceOf(NotFoundError);
    expect(asAskdare(fromOpenAIError(model, false)).code).toBe('bot_unavailable');

    const gone = asAskdare(
      fromOpenAIError(
        apiError(404, { message: "Conversation with id 'conv_1' not found." }),
        false,
      ),
    );
    expect(gone.code).toBe('not_found');
    expect(gone.key).toBe('error.conversationGone');

    const other = apiError(404, { message: 'Vector store not found.' });
    expect(asAskdare(fromOpenAIError(other, false)).code).toBe('upstream_error');
  });

  it('treats a rejected key as the bot being unavailable', () => {
    for (const status of [401, 403]) {
      const error = apiError(status, {
        message: 'Incorrect API key provided: sk-proj-abcdef123456.',
      });
      const mapped = asAskdare(fromOpenAIError(error, false));
      expect(mapped.code).toBe('bot_unavailable');
      expect(causeOf(mapped).message).not.toContain('abcdef123456');
    }
  });

  it('passes on how long to wait after a rate limit', () => {
    const ms = asAskdare(fromOpenAIError(apiError(429, {}, { 'retry-after-ms': '1500' }), false));
    expect(ms.code).toBe('upstream_error');
    expect(ms.retryAfterMs).toBe(1500);
    const seconds = fromOpenAIError(apiError(429, {}, { 'retry-after': '2' }), false);
    expect(asAskdare(seconds).retryAfterMs).toBe(2000);
    const none = fromOpenAIError(apiError(429, {}, { 'retry-after': 'soon' }), false);
    expect(asAskdare(none).retryAfterMs).toBeUndefined();
  });

  it('keeps status, code and request ID in the cause, never the SDK error itself', () => {
    const error = apiError(
      500,
      { code: 'server_error', message: 'The server had an error.' },
      { 'x-request-id': 'req_123' },
    );
    const cause = causeOf(fromOpenAIError(error, false));
    expect(cause).not.toBe(error);
    expect(cause).toMatchObject({ status: 500, code: 'server_error', requestId: 'req_123' });
    expect(cause).not.toHaveProperty('headers');
    expect(cause).not.toHaveProperty('error');
  });

  it('does not log the visitor’s text when a 400 quotes it', () => {
    const secret = 'my card number is 4111 1111 1111 1111 and my address is';
    const error = apiError(400, {
      message: `Invalid value for 'input': '${secret}'.`,
      param: 'input',
    });
    const cause = causeOf(fromOpenAIError(error, false));
    expect(cause.message).not.toContain('4111');
    expect(cause.message).toContain("'input'");
  });

  it('turns anything else into an internal error', () => {
    expect(asAskdare(fromOpenAIError(new Error('boom'), false)).code).toBe('internal_error');
    expect(asAskdare(fromOpenAIError('boom', false)).code).toBe('internal_error');
  });
});

describe('loggableMessage', () => {
  it('keeps short quoted values such as model and parameter names', () => {
    expect(loggableMessage("Unsupported parameter: 'temperature' for model 'gpt-x'.")).toBe(
      "Unsupported parameter: 'temperature' for model 'gpt-x'.",
    );
  });

  it('cuts keys, long quoted values and very long messages', () => {
    expect(loggableMessage('Incorrect API key provided: sk-proj-abcdef123456')).toBe(
      'Incorrect API key provided: sk-…',
    );
    expect(loggableMessage(`Bad "${'a'.repeat(40)}"`)).toBe('Bad "[…]"');
    expect(loggableMessage('x'.repeat(400))).toHaveLength(301);
  });
});
