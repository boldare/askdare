import type { AttachmentKind } from './attachments/files';
import type { Bot, BotContext } from './bot/define-bot';
import type { MessageEndReason, ProtocolEvent } from './protocol/events';
import type { HistoryMessage } from './protocol/history';

export interface TokenUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
}

export interface ConversationMetadata {
  readonly botId: string;
  readonly visitorId: string;
}

/** A file from a verified attachment handle, never an ID taken from the client. */
export interface TurnAttachment {
  readonly fileId: string;
  readonly kind: AttachmentKind;
}

export interface UploadRequest {
  readonly bytes: Uint8Array;
  /** Sanitized name whose extension matches the detected type. */
  readonly filename: string;
  readonly mime: string;
  readonly signal?: AbortSignal;
}

export interface TurnRequest {
  readonly bot: Bot;
  readonly conversationId: string;
  /** May be empty when the message only carries attachments. */
  readonly text: string;
  readonly attachments?: readonly TurnAttachment[];
  readonly context: BotContext;
  /** Server-generated visitor ID, handed to tools as verified context. */
  readonly visitorId: string;
  /** Stable, non-reversible end-user identifier for abuse attribution (hash of the visitor ID). */
  readonly safetyIdentifier: string;
  /** ID of the assistant message that protocol events refer to. */
  readonly messageId: string;
  readonly signal: AbortSignal;
  readonly emit: (event: ProtocolEvent) => void;
}

export interface TurnResult {
  readonly reason: MessageEndReason;
  readonly usage: TokenUsage;
}

/**
 * Everything the server needs from the model provider. The OpenAI implementation lives in
 * `src/openai/`; nothing else may depend on the `openai` package (ADR-0002).
 */
export interface ModelGateway {
  createConversation(metadata: ConversationMetadata, signal?: AbortSignal): Promise<string>;
  /** Deletes the conversation and, with `withFiles`, the files its visitor attached. */
  deleteConversation(
    conversationId: string,
    options?: { readonly withFiles?: boolean },
  ): Promise<void>;
  /** Stores a visitor's file as model input and returns its ID. Files expire after 30 days. */
  uploadFile(upload: UploadRequest): Promise<string>;
  /** Visible messages of a conversation, oldest first. */
  listMessages(conversationId: string, signal?: AbortSignal): Promise<readonly HistoryMessage[]>;
  runTurn(request: TurnRequest): Promise<TurnResult>;
}
