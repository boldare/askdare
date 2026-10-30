import type { AttachmentKind } from './attachments/files';
import type { Bot, BotContext } from './bot/define-bot';
import type { DoctorCheck } from './protocol/doctor';
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

export interface TranscriptionRequest {
  readonly bytes: Uint8Array;
  /** Name whose extension matches the detected container. */
  readonly filename: string;
  readonly mime: string;
  readonly model: string;
  /** ISO 639-1 codes the speech is likely in; dropped when the model refuses them. */
  readonly languages: readonly string[];
  readonly signal?: AbortSignal;
}

export interface TranscriptionResult {
  readonly text: string;
  /** Billed duration, when the model reports one. */
  readonly seconds: number | undefined;
}

export interface TurnRequest {
  readonly bot: Bot;
  readonly conversationId: string;
  /** May be empty when the message only carries attachments. */
  readonly text: string;
  readonly attachments?: readonly TurnAttachment[];
  readonly context: BotContext;
  /** What the host page says about itself (askdare('configure')); untrusted. */
  readonly pageContext?: string | undefined;
  /** Server-generated visitor ID, handed to tools as verified context. */
  readonly visitorId: string;
  /** Stable end-user pseudonym for abuse attribution: an HMAC of the visitor's or user's ID. */
  readonly safetyIdentifier: string;
  /** ID of the assistant message that protocol events refer to. */
  readonly messageId: string;
  readonly signal: AbortSignal;
  readonly emit: (event: ProtocolEvent) => void;
  /**
   * Holds the budget for one more model call before a round of tool calls. False when it can't:
   * the step then answers without tools. Absent means every call is covered.
   */
  readonly reserveCall?: (() => Promise<boolean>) | undefined;
}

export interface TurnResult {
  readonly reason: MessageEndReason;
  readonly usage: TokenUsage;
}

/** What `askdare doctor` checks for one bot: the features it uses, with the server's key. */
export interface DiagnoseRequest {
  readonly model: string;
  readonly vectorStoreId?: string | undefined;
  readonly transcriptionModel?: string | undefined;
  readonly attachments: boolean;
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
  /** Turns recorded speech into text. Nothing is stored. */
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
  /** Visible messages of a conversation, oldest first. */
  listMessages(conversationId: string, signal?: AbortSignal): Promise<readonly HistoryMessage[]>;
  runTurn(request: TurnRequest): Promise<TurnResult>;
  /** Small live requests that show whether the key, model and stores work (`askdare doctor`). */
  diagnose(request: DiagnoseRequest): Promise<readonly DoctorCheck[]>;
}
