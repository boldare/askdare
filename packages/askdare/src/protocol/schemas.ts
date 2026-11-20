import { z } from 'zod';
import { ERROR_CODES, MESSAGE_END_REASONS, type ProtocolEvent } from './events';
import type { HistoryResponse } from './history';
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
    }),
  ),
});
