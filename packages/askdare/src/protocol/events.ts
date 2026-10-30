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
  /**
   * A fresh handle for a resumed conversation, so an active conversation stays reachable for 30
   * days after its last message rather than its first.
   */
  readonly resumeToken?: string | undefined;
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
