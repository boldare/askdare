import {
  ERROR_CODES,
  type ErrorCode,
  type FeedbackHandle,
  MESSAGE_END_REASONS,
  type MessageEndReason,
  type ProtocolEvent,
} from './events';
import {
  type ChatForm,
  type ChatFormField,
  FORM_ERROR_KEY,
  FORM_FIELD_MAX_LENGTH,
  FORM_FIELD_NAME,
  FORM_NAME,
  FORM_PURPOSES,
  FORM_STATES,
  type FormFieldErrors,
  type FormResponse,
  type HistoryForm,
  MAX_FORM_DONE,
  MAX_FORM_FIELDS,
  MAX_FORM_HANDLE,
  MAX_FORM_LABEL,
  MAX_FORM_OPTION_VALUE,
  MAX_FORM_OPTIONS,
  MAX_FORMS,
  MAX_MESSAGE_FORMS,
  MIN_FORM_OPTIONS,
} from './forms';
import { HANDOFF_STATES, type HandoffResponse, type HandoffState } from './handoff';
import {
  HISTORY_CURSOR_MAX,
  type HistoryCitation,
  type HistoryMessage,
  type HistoryResponse,
} from './history';
import { isReplyList } from './replies';
import { isToolUi, isToolUiList } from './tool-ui';

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
const handoffState = (value: unknown): value is HandoffState => oneOf(value, HANDOFF_STATES);
const formName = (value: unknown): value is string =>
  typeof value === 'string' && FORM_NAME.test(value);
const formHandle = (value: unknown): value is string => text(value, 1, MAX_FORM_HANDLE);
const fieldName = (value: unknown): value is string =>
  typeof value === 'string' && FORM_FIELD_NAME.test(value);
/** Form texts count characters (code points), as the server does: an emoji is one. */
const chars = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max * 2 &&
  [...value].length <= max;
const label = (value: unknown): value is string => chars(value, MAX_FORM_LABEL);

/** Each item mapped, or undefined when one is invalid, the count is off or a key repeats. */
function listOf<T>(
  value: unknown,
  min: number,
  max: number,
  item: (value: unknown) => T | undefined,
  key: (item: T) => unknown,
): T[] | undefined {
  if (!Array.isArray(value) || value.length < min || value.length > max) return undefined;
  const items: T[] = [];
  for (const entry of value) {
    const parsed = item(entry);
    if (parsed === undefined) return undefined;
    items.push(parsed);
  }
  return new Set(items.map(key)).size === items.length ? items : undefined;
}

/** A rating handle, or undefined when the value breaks the protocol. */
function feedbackOf(value: unknown): FeedbackHandle | undefined {
  return record(value) &&
    text(value['handle'], 1, 4096) &&
    typeof value['key'] === 'string' &&
    /^[0-9a-f]{16,64}$/.test(value['key'])
    ? { handle: value['handle'], key: value['key'] }
    : undefined;
}

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

/** One field of a form's description; fields that don't belong to its type are dropped. */
function formFieldOf(value: unknown): ChatFormField | undefined {
  if (!record(value)) return undefined;
  const { name, type, required, placeholder, maxLength } = value;
  if (!fieldName(name) || !label(value['label']) || typeof required !== 'boolean') return undefined;
  const field = { name, label: value['label'], required };
  if (type === 'consent') return { ...field, type };
  if (type === 'select') {
    const options = listOf(
      value['options'],
      MIN_FORM_OPTIONS,
      MAX_FORM_OPTIONS,
      (option) =>
        record(option) && chars(option['value'], MAX_FORM_OPTION_VALUE) && label(option['label'])
          ? { value: option['value'], label: option['label'] }
          : undefined,
      (option) => option.value,
    );
    return options ? { ...field, type, options } : undefined;
  }
  if (!oneOf(type, ['text', 'email', 'phone', 'textarea'] as const)) return undefined;
  if (placeholder !== undefined && !label(placeholder)) return undefined;
  if (
    maxLength !== undefined &&
    !(integer(maxLength, 1) && maxLength <= FORM_FIELD_MAX_LENGTH[type])
  ) {
    return undefined;
  }
  return {
    ...field,
    type,
    ...(placeholder === undefined ? {} : { placeholder }),
    ...(maxLength === undefined ? {} : { maxLength }),
  };
}

function formOf(value: unknown): ChatForm | undefined {
  if (!record(value) || !formName(value['name']) || !label(value['title'])) {
    return undefined;
  }
  const { submit, done } = value;
  if (submit !== undefined && !label(submit)) return undefined;
  if (done !== undefined && !chars(done, MAX_FORM_DONE)) return undefined;
  const fields = listOf(value['fields'], 1, MAX_FORM_FIELDS, formFieldOf, (field) => field.name);
  return fields
    ? {
        name: value['name'],
        title: value['title'],
        fields,
        ...(submit === undefined ? {} : { submit }),
        ...(done === undefined ? {} : { done }),
      }
    : undefined;
}

/** The `forms` of a bot's public configuration, or undefined when they break the protocol. */
export function parseForms(value: unknown): readonly ChatForm[] | undefined {
  return listOf(value, 1, MAX_FORMS, formOf, (form) => form.name);
}

function handoffOf(value: unknown): { state: HandoffState } | undefined {
  return record(value) && handoffState(value['state']) ? { state: value['state'] } : undefined;
}

function historyFormOf(value: unknown): HistoryForm | undefined {
  if (
    !record(value) ||
    !text(value['callId'], 1, 128) ||
    !formName(value['name']) ||
    !oneOf(value['purpose'], FORM_PURPOSES) ||
    !oneOf(value['state'], FORM_STATES)
  ) {
    return undefined;
  }
  const { handle } = value;
  if (handle !== undefined && !formHandle(handle)) return undefined;
  return {
    callId: value['callId'],
    name: value['name'],
    purpose: value['purpose'],
    state: value['state'],
    ...(handle === undefined ? {} : { handle }),
  };
}

/** The answer of `POST /handoff`, or undefined when it breaks the protocol. */
export function parseHandoffResponse(value: unknown): HandoffResponse | undefined {
  if (!record(value) || !handoffState(value['state'])) return undefined;
  const { state, form } = value;
  if (form === undefined) return { state };
  return state === 'requested' &&
    record(form) &&
    formName(form['name']) &&
    formHandle(form['handle']) &&
    oneOf(form['purpose'], ['handoff', 'message'] as const)
    ? { state, form: { name: form['name'], handle: form['handle'], purpose: form['purpose'] } }
    : undefined;
}

/** The answer of `POST /forms` when the form was sent, or undefined when it breaks the protocol. */
export function parseFormResponse(value: unknown): FormResponse | undefined {
  if (!record(value) || value['state'] !== 'sent') return undefined;
  const { handoff } = value;
  if (handoff === undefined) return { state: 'sent' };
  return handoffState(handoff) && handoff !== 'requested' ? { state: 'sent', handoff } : undefined;
}

/** `fields` of a refused `POST /forms`, or undefined when they break the protocol. */
export function parseFormFieldErrors(value: unknown): FormFieldErrors | undefined {
  if (!record(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > MAX_FORM_FIELDS) return undefined;
  const fields: Record<string, string> = {};
  for (const [name, key] of entries) {
    if (!fieldName(name) || typeof key !== 'string' || !FORM_ERROR_KEY.test(key)) return undefined;
    fields[name] = key;
  }
  return fields;
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
    case 'tool.ui':
      // isToolUi checks the call ID, the name and the data's limits.
      return messageId(id) && isToolUi(value)
        ? {
            type: 'tool.ui',
            messageId: id,
            callId: value['callId'] as string,
            name: value['name'] as string,
            data: value['data'],
          }
        : undefined;
    case 'replies':
      return messageId(id) && isReplyList(value['items'])
        ? { type: 'replies', messageId: id, items: [...value['items']] }
        : undefined;
    case 'handoff':
      return messageId(id) && handoffState(value['state'])
        ? { type: 'handoff', messageId: id, state: value['state'] }
        : undefined;
    case 'form':
      return messageId(id) &&
        text(value['callId'], 1, 128) &&
        formName(value['name']) &&
        formHandle(value['handle']) &&
        oneOf(value['purpose'], FORM_PURPOSES)
        ? {
            type: 'form',
            messageId: id,
            callId: value['callId'],
            name: value['name'],
            handle: value['handle'],
            purpose: value['purpose'],
          }
        : undefined;
    case 'message.end': {
      const { resumeToken } = value;
      if (!messageId(id) || !oneOf<MessageEndReason>(value['reason'], MESSAGE_END_REASONS)) {
        return undefined;
      }
      if (resumeToken !== undefined && !text(resumeToken, 1)) return undefined;
      const feedback = value['feedback'] === undefined ? undefined : feedbackOf(value['feedback']);
      if (value['feedback'] !== undefined && !feedback) return undefined;
      return {
        type: 'message.end',
        messageId: id,
        reason: value['reason'],
        ...(typeof resumeToken === 'string' ? { resumeToken } : {}),
        ...(feedback ? { feedback } : {}),
      };
    }
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
  const feedback = value['feedback'] === undefined ? undefined : feedbackOf(value['feedback']);
  if (value['feedback'] !== undefined && !feedback) return undefined;
  const { replies } = value;
  if (replies !== undefined && !isReplyList(replies)) return undefined;
  const { ui } = value;
  if (ui !== undefined && !isToolUiList(ui)) return undefined;
  const handoff = value['handoff'] === undefined ? undefined : handoffOf(value['handoff']);
  if (value['handoff'] !== undefined && !handoff) return undefined;
  const forms =
    value['forms'] === undefined
      ? undefined
      : listOf(value['forms'], 1, MAX_MESSAGE_FORMS, historyFormOf, (form) => form.callId);
  if (value['forms'] !== undefined && !forms) return undefined;
  return {
    id: value['id'],
    role: value['role'],
    text: value['text'],
    citations: citations as HistoryCitation[],
    attachments: value['attachments'],
    ...(feedback ? { feedback } : {}),
    ...(replies === undefined ? {} : { replies: [...replies] }),
    ...(ui === undefined
      ? {}
      : { ui: ui.map(({ callId, name, data }) => ({ callId, name, data })) }),
    ...(handoff ? { handoff } : {}),
    ...(forms ? { forms } : {}),
  };
}

/** The answer of `POST /history`, or undefined when it breaks the protocol. */
export function parseHistory(value: unknown): HistoryResponse | undefined {
  if (!record(value) || !Array.isArray(value['messages'])) return undefined;
  const before = value['before'];
  if (before !== undefined && !text(before, 1, HISTORY_CURSOR_MAX)) return undefined;
  const messages = value['messages'].map(historyMessageOf);
  if (messages.some((message) => message === undefined)) return undefined;
  return {
    messages: messages as HistoryMessage[],
    ...(before === undefined ? {} : { before }),
  };
}
