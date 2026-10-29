import { z } from 'zod';

/** Stable error codes sent to clients. The accompanying message never contains internals. */
export const ERROR_CODES = [
  'invalid_input',
  'unauthorized',
  'session_expired',
  'not_found',
  'rate_limited',
  'budget_exceeded',
  'bot_unavailable',
  'content_blocked',
  'timeout',
  'upstream_error',
  'internal_error',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const MESSAGE_END_REASONS = [
  'completed',
  'max_steps',
  'max_output_tokens',
  'timeout',
  'content_filter',
  'aborted',
] as const;

export type MessageEndReason = (typeof MESSAGE_END_REASONS)[number];

export const PROTOCOL_EVENT_TYPES = [
  'conversation.created',
  'user.ack',
  'message.start',
  'reasoning',
  'text.delta',
  'citation',
  'tool.status',
  'message.end',
  'error',
] as const;

export type ProtocolEventType = (typeof PROTOCOL_EVENT_TYPES)[number];

export interface ConversationCreatedEvent {
  readonly type: 'conversation.created';
  /** Signed handle that lets this visitor resume the conversation. Never a raw OpenAI ID. */
  readonly resumeToken: string;
}

export interface UserAckEvent {
  readonly type: 'user.ack';
  readonly messageId: string;
}

export interface MessageStartEvent {
  readonly type: 'message.start';
  readonly messageId: string;
}

export interface ReasoningEvent {
  readonly type: 'reasoning';
  readonly messageId: string;
  readonly state: 'started' | 'done';
}

export interface TextDeltaEvent {
  readonly type: 'text.delta';
  readonly messageId: string;
  readonly delta: string;
}

export interface CitationEvent {
  readonly type: 'citation';
  readonly messageId: string;
  /** 1-based marker shown in the text as [n]. */
  readonly index: number;
  readonly title: string;
  readonly url?: string | undefined;
}

export interface ToolStatusEvent {
  readonly type: 'tool.status';
  readonly messageId: string;
  readonly callId: string;
  readonly name: string;
  readonly state: 'running' | 'done' | 'error';
}

export interface MessageEndEvent {
  readonly type: 'message.end';
  readonly messageId: string;
  readonly reason: MessageEndReason;
}

export interface ErrorEvent {
  readonly type: 'error';
  readonly code: ErrorCode;
  /** English fallback. */
  readonly message: string;
  readonly retryAfterMs?: number | undefined;
  /** Dictionary key for the visitor's language, with its placeholders. */
  readonly key?: string | undefined;
  readonly params?: Readonly<Record<string, string | number>> | undefined;
}

export type ProtocolEvent =
  | ConversationCreatedEvent
  | UserAckEvent
  | MessageStartEvent
  | ReasoningEvent
  | TextDeltaEvent
  | CitationEvent
  | ToolStatusEvent
  | MessageEndEvent
  | ErrorEvent;

const messageId = z.string().min(1).max(128);

/** Runtime validator for events received over the wire. */
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
