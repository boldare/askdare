import {
  ERROR_CODES,
  type ErrorCode,
  MESSAGE_END_REASONS,
  type MessageEndReason,
  type ProtocolEvent,
} from './events';
import type { HistoryCitation, HistoryMessage, HistoryResponse } from './history';

/*
 * The browser's protocol check: the rules of ./schemas.ts (zod, for the server and tests), at a
 * fraction of the size in the widget bundle, and never more lenient. validate.test.ts checks it.
 * Each function returns a fresh object with the known fields only, or undefined.
 */

type Fields = Record<string, unknown>;

const record = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, min = 0, max = Number.POSITIVE_INFINITY): value is string =>
  typeof value === 'string' && value.length >= min && value.length <= max;
const integer = (value: unknown, min: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
const oneOf = <T extends string>(value: unknown, options: readonly T[]): value is T =>
  options.includes(value as T);
const messageId = (value: unknown): value is string => text(value, 1, 128);

/** An absolute http(s) URL as the server sends it; stricter than a browser's lenient parsing. */
function httpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !/^https?:\/\/[^\s/?#]+[^\s]*$/i.test(value)) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function citationOf(value: unknown): HistoryCitation | undefined {
  if (!record(value) || !integer(value['index'], 1) || !text(value['title'], 1)) return undefined;
  if (value['url'] !== undefined && !httpUrl(value['url'])) return undefined;
  return {
    index: value['index'],
    title: value['title'],
    ...(value['url'] === undefined ? {} : { url: value['url'] }),
  };
}

function paramsOf(value: unknown): Record<string, string | number> | undefined {
  if (!record(value)) return undefined;
  const params: Record<string, string | number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      key.length > 32 ||
      !(text(item, 0, 200) || (typeof item === 'number' && Number.isFinite(item)))
    )
      return undefined;
    params[key] = item;
  }
  return params;
}

/** A protocol event received over the wire, or undefined when it breaks the protocol. */
export function parseEvent(value: unknown): ProtocolEvent | undefined {
  if (!record(value)) return undefined;
  const id = value['messageId'];
  switch (value['type']) {
    case 'conversation.created':
      return text(value['resumeToken'], 1)
        ? { type: 'conversation.created', resumeToken: value['resumeToken'] }
        : undefined;
    case 'user.ack':
    case 'message.start':
      return messageId(id) ? { type: value['type'], messageId: id } : undefined;
    case 'reasoning':
      return messageId(id) && oneOf(value['state'], ['started', 'done'] as const)
        ? { type: 'reasoning', messageId: id, state: value['state'] }
        : undefined;
    case 'text.delta':
      return messageId(id) && text(value['delta'])
        ? { type: 'text.delta', messageId: id, delta: value['delta'] }
        : undefined;
    case 'citation': {
      const citation = citationOf(value);
      return messageId(id) && citation
        ? { type: 'citation', messageId: id, ...citation }
        : undefined;
    }
    case 'tool.status':
      return messageId(id) &&
        text(value['callId'], 1, 128) &&
        text(value['name'], 1, 64) &&
        oneOf(value['state'], ['running', 'done', 'error'] as const)
        ? {
            type: 'tool.status',
            messageId: id,
            callId: value['callId'],
            name: value['name'],
            state: value['state'],
          }
        : undefined;
    case 'message.end':
      return messageId(id) && oneOf<MessageEndReason>(value['reason'], MESSAGE_END_REASONS)
        ? { type: 'message.end', messageId: id, reason: value['reason'] }
        : undefined;
    case 'error': {
      const { code, message, retryAfterMs, key, params } = value;
      if (!oneOf<ErrorCode>(code, ERROR_CODES) || !text(message, 0, 500)) return undefined;
      if (retryAfterMs !== undefined && !integer(retryAfterMs, 0)) return undefined;
      if (key !== undefined && !text(key, 0, 64)) return undefined;
      const checked = params === undefined ? undefined : paramsOf(params);
      if (params !== undefined && !checked) return undefined;
      return {
        type: 'error',
        code,
        message,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        ...(key === undefined ? {} : { key }),
        ...(checked ? { params: checked } : {}),
      };
    }
    default:
      return undefined;
  }
}

function historyMessageOf(value: unknown): HistoryMessage | undefined {
  if (
    !record(value) ||
    !text(value['id'], 1, 256) ||
    !oneOf(value['role'], ['user', 'assistant'] as const) ||
    !text(value['text']) ||
    !Array.isArray(value['citations']) ||
    !integer(value['attachments'], 0)
  ) {
    return undefined;
  }
  const citations = value['citations'].map(citationOf);
  if (citations.some((citation) => citation === undefined)) return undefined;
  return {
    id: value['id'],
    role: value['role'],
    text: value['text'],
    citations: citations as HistoryCitation[],
    attachments: value['attachments'],
  };
}

/** The answer of `POST /history`, or undefined when it breaks the protocol. */
export function parseHistory(value: unknown): HistoryResponse | undefined {
  if (!record(value) || !Array.isArray(value['messages'])) return undefined;
  const messages = value['messages'].map(historyMessageOf);
  return messages.some((message) => message === undefined)
    ? undefined
    : { messages: messages as HistoryMessage[] };
}
