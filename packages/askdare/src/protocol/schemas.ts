import { z } from 'zod';
import { ERROR_CODES, MESSAGE_END_REASONS, type ProtocolEvent } from './events';
import type { HistoryResponse } from './history';

/*
 * The protocol in zod, for the server and the tests. Browsers validate with ./validate.ts, which
 * is far smaller; validate.test.ts keeps the two in agreement.
 */

const messageId = z.string().min(1).max(128);

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
    callId: z.string().min(1).max(128),
    name: z.string().min(1).max(64),
    state: z.enum(['running', 'done', 'error']),
  }),
  z.object({
    type: z.literal('message.end'),
    messageId,
    reason: z.enum(MESSAGE_END_REASONS),
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
    }),
  ),
});
