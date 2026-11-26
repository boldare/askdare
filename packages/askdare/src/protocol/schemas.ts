import { z } from 'zod';
import { ERROR_CODES, MESSAGE_END_REASONS, type ProtocolEvent } from './events';
import {
  type ChatForm,
  FORM_ERROR_KEY,
  FORM_FIELD_MAX_LENGTH,
  FORM_FIELD_NAME,
  FORM_NAME,
  FORM_PURPOSES,
  FORM_STATES,
  type FormFieldErrors,
  type FormRequest,
  type FormResponse,
  MAX_FORM_DONE,
  MAX_FORM_FIELDS,
  MAX_FORM_HANDLE,
  MAX_FORM_LABEL,
  MAX_FORM_OPTION_VALUE,
  MAX_FORM_OPTIONS,
  MAX_FORM_VALUE,
  MAX_FORMS,
  MAX_MESSAGE_FORMS,
  MIN_FORM_OPTIONS,
} from './forms';
import { HANDOFF_STATES, type HandoffRequest, type HandoffResponse } from './handoff';
import { HISTORY_CURSOR_MAX, type HistoryResponse } from './history';
import { isReplyList } from './replies';
import { isToolUi, isToolUiList, TOOL_NAME } from './tool-ui';

const feedback = z
  .object({ handle: z.string().min(1).max(4096), key: z.string().regex(/^[0-9a-f]{16,64}$/) })
  .optional();

/*
 * The protocol in zod, for the server and the tests. Browsers validate with ./validate.ts, which
 * is far smaller; validate.test.ts keeps the two in agreement.
 */

const messageId = z.string().min(1).max(128);

/** Reply options (ADR-0015); the rules live in ./replies.ts, shared with the browser. */
const replies = z
  .array(z.string())
  .refine(isReplyList, 'one to four distinct options of up to 80 characters, without links');

const callId = z.string().min(1).max(128);

/** A tool UI payload (ADR-0017); the rules live in ./tool-ui.ts, shared with the browser. */
const toolUiFields = {
  callId,
  name: z.string().regex(TOOL_NAME),
  data: z.unknown(),
};
const TOOL_UI_RULE = 'plain JSON of at most 8 KB and 8 levels, never null';
const toolUi = z.object(toolUiFields).refine(isToolUi, TOOL_UI_RULE);

/** Handoff (ADR-0030) and forms (ADR-0031). */
const handoffState = z.enum(HANDOFF_STATES);
const formName = z.string().regex(FORM_NAME);
/**
 * Text of 1 to `max` UTF-16 code units, as JavaScript's `length` and the browser's check count
 * them (zod's own `max` counts differently). A form text one side refuses would drop every form.
 */
const units = (max: number) =>
  z.string().refine((value) => value.length > 0 && value.length <= max, `1 to ${max} characters`);
const formHandle = units(MAX_FORM_HANDLE);
const formPurpose = z.enum(FORM_PURPOSES);
/** Whether no two items have the same value at `key`. */
const distinct =
  (key: string) =>
  (items: readonly Readonly<Record<string, unknown>>[]): boolean =>
    new Set(items.map((item) => item[key])).size === items.length;

/** The fields of a form's description, by type; fields of another type are dropped. */
const fieldName = z.string().regex(FORM_FIELD_NAME);
const formLabel = units(MAX_FORM_LABEL);
const textField = (type: keyof typeof FORM_FIELD_MAX_LENGTH) =>
  z.object({
    name: fieldName,
    type: z.literal(type),
    label: formLabel,
    required: z.boolean(),
    placeholder: formLabel.optional(),
    maxLength: z.number().int().min(1).max(FORM_FIELD_MAX_LENGTH[type]).optional(),
  });
const formField = z.discriminatedUnion('type', [
  textField('text'),
  textField('email'),
  textField('phone'),
  textField('textarea'),
  z.object({
    name: fieldName,
    type: z.literal('select'),
    label: formLabel,
    required: z.boolean(),
    options: z
      .array(
        z.object({
          value: units(MAX_FORM_OPTION_VALUE),
          label: formLabel,
        }),
      )
      .min(MIN_FORM_OPTIONS)
      .max(MAX_FORM_OPTIONS)
      .refine(distinct('value'), 'distinct option values'),
  }),
  z.object({
    name: fieldName,
    type: z.literal('consent'),
    label: formLabel,
    required: z.boolean(),
  }),
]);

/** The forms of the bot's public configuration, in the visitor's language (ADR-0031). */
export const chatFormsSchema: z.ZodType<readonly ChatForm[]> = z
  .array(
    z.object({
      name: formName,
      title: formLabel,
      fields: z
        .array(formField)
        .min(1)
        .max(MAX_FORM_FIELDS)
        .refine(distinct('name'), 'distinct field names'),
      submit: formLabel,
      done: units(MAX_FORM_DONE),
    }),
  )
  .min(1)
  .max(MAX_FORMS)
  .refine(distinct('name'), 'distinct form names');

/** Every protocol event, as the server promises it. */
export const protocolEventSchema: z.ZodType<ProtocolEvent> = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('conversation.created'),
    resumeToken: z.string().min(1),
  }),
  z.object({ type: z.literal('user.ack'), messageId }),
  z.object({ type: z.literal('message.start'), messageId }),
  z.object({
    type: z.literal('reasoning'),
    messageId,
    state: z.enum(['started', 'done']),
  }),
  z.object({ type: z.literal('text.delta'), messageId, delta: z.string() }),
  z.object({
    type: z.literal('citation'),
    messageId,
    index: z.number().int().min(1),
    title: z.string().min(1),
    url: z.url({ protocol: /^https?$/ }).optional(),
  }),
  z.object({
    type: z.literal('tool.status'),
    messageId,
    callId,
    name: z.string().min(1).max(64),
    state: z.enum(['running', 'done', 'error']),
  }),
  z
    .object({ type: z.literal('tool.ui'), messageId, ...toolUiFields })
    .refine(isToolUi, TOOL_UI_RULE),
  z.object({ type: z.literal('replies'), messageId, items: replies }),
  z.object({ type: z.literal('handoff'), messageId, state: handoffState }),
  z.object({
    type: z.literal('form'),
    messageId,
    callId,
    name: formName,
    handle: formHandle,
    purpose: formPurpose,
  }),
  z.object({
    type: z.literal('message.end'),
    messageId,
    reason: z.enum(MESSAGE_END_REASONS),
    resumeToken: z.string().min(1).optional(),
    feedback,
  }),
  z.object({
    type: z.literal('error'),
    code: z.enum(ERROR_CODES),
    message: z.string().max(500),
    retryAfterMs: z.number().int().min(0).optional(),
    key: z.string().max(64).optional(),
    params: z.record(z.string().max(32), z.union([z.string().max(200), z.number()])).optional(),
  }),
]);

/** The history response, as the server promises it. */
export const historyResponseSchema: z.ZodType<HistoryResponse> = z.object({
  messages: z.array(
    z.object({
      id: z.string().min(1).max(256),
      role: z.enum(['user', 'assistant']),
      text: z.string(),
      citations: z.array(
        z.object({
          index: z.number().int().min(1),
          title: z.string().min(1),
          url: z.url({ protocol: /^https?$/ }).optional(),
        }),
      ),
      attachments: z.number().int().min(0),
      feedback,
      replies: replies.optional(),
      ui: z.array(toolUi).refine(isToolUiList, 'one to four payloads, no call twice').optional(),
      handoff: z.object({ state: handoffState }).optional(),
      forms: z
        .array(
          z.object({
            callId,
            name: formName,
            purpose: formPurpose,
            state: z.enum(FORM_STATES),
            handle: formHandle.optional(),
          }),
        )
        .min(1)
        .max(MAX_MESSAGE_FORMS)
        .refine(distinct('callId'), 'no call twice')
        .optional(),
    }),
  ),
  before: z.string().min(1).max(HISTORY_CURSOR_MAX).optional(),
});

/** The body of `POST /handoff` (ADR-0030). */
export const handoffRequestSchema: z.ZodType<HandoffRequest> = z.object({
  botId: z.string().max(64),
  resumeToken: z.string().min(1).max(4096),
});

/** The answer of `POST /handoff`: a form only while the handoff waits for it. */
export const handoffResponseSchema: z.ZodType<HandoffResponse> = z
  .object({
    state: handoffState,
    form: z
      .object({ name: formName, handle: formHandle, purpose: z.enum(['handoff', 'message']) })
      .optional(),
  })
  .refine((answer) => answer.form === undefined || answer.state === 'requested', {
    message: 'a form only with the state requested',
  });

/** The body of `POST /forms` (ADR-0031). The form's own validation checks each value. */
export const formRequestSchema: z.ZodType<FormRequest> = z.object({
  botId: z.string().max(64),
  resumeToken: z.string().min(1).max(4096),
  form: formHandle,
  values: z
    .record(fieldName, z.union([z.string().max(MAX_FORM_VALUE), z.boolean()]))
    .refine((values) => Object.keys(values).length <= MAX_FORM_FIELDS, 'at most 8 values'),
});

/** The answer of `POST /forms` when the form was sent; a handoff's state is final. */
export const formResponseSchema: z.ZodType<FormResponse> = z.object({
  state: z.literal('sent'),
  handoff: handoffState.exclude(['requested']).optional(),
});

/** `fields` of a refused `POST /forms`: one error key per refused field, never a value. */
export const formFieldErrorsSchema: z.ZodType<FormFieldErrors> = z
  .record(fieldName, z.string().regex(FORM_ERROR_KEY))
  .refine((fields) => {
    const count = Object.keys(fields).length;
    return count > 0 && count <= MAX_FORM_FIELDS;
  }, 'one to eight fields');
