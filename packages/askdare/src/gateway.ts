import type { AttachmentKind } from './attachments/files';
import type { Bot, BotContext } from './bot/define-bot';
import type { ConversationStore } from './conversations/port';
import type { KnowledgeIndex } from './knowledge/port';
import type { DoctorCheck } from './protocol/doctor';
import type { MessageEndReason, ProtocolEvent } from './protocol/events';
import type { ToolUi } from './protocol/tool-ui';

export interface TokenUsage {
  readonly inputTokens: number;
  /** Input tokens read from the prompt cache; part of `inputTokens`. */
  readonly cachedInputTokens: number;
  /** Input tokens written to the prompt cache; part of `inputTokens`. */
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
  /** Output tokens spent on reasoning; part of `outputTokens`. */
  readonly reasoningTokens: number;
}

/** One model call of a turn, reported as it ends. */
export interface StepRecord {
  /** The model that answered, as the provider reports it. */
  readonly model: string | undefined;
  readonly usage: TokenUsage;
}

/** One function call of a turn, reported as it ends. */
export interface ToolCallRecord {
  readonly name: string;
  /** Epoch milliseconds. */
  readonly startedAt: number;
  readonly durationMs: number;
  readonly outcome: 'ok' | 'error' | 'timeout';
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
  /**
   * Where the conversation lives. A provider store records the model's items itself, and the turn
   * appends only what the server writes; an item store gets every item and is replayed statelessly
   * (ADR-0024).
   */
  readonly conversations: ConversationStore;
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
  /** Called after each model call, so a turn that fails later still reports what it spent. */
  readonly onStep?: ((step: StepRecord) => void) | undefined;
  /** Called after each function call. */
  readonly onToolCall?: ((call: ToolCallRecord) => void) | undefined;
}

export interface TurnResult {
  readonly reason: MessageEndReason;
  readonly usage: TokenUsage;
  /**
   * The ID of the answer visitors see, for rating it: the stored item's in an item store, the
   * provider's otherwise. Absent if there was none.
   */
  readonly answerItemId?: string | undefined;
  /**
   * Options proposed for the visitor's next message (ADR-0015), as the source gave them; the
   * server cleans them up before sending.
   */
  readonly replies?: readonly string[] | undefined;
  /**
   * The conversation's version after the turn's last append, in an item store; absent when the
   * provider keeps the conversation. A compaction after the turn expects it (ADR-0029).
   */
  readonly version?: number | undefined;
}

/** Compacts a conversation in an item store after a turn (ADR-0029). */
export interface CompactionRequest {
  readonly bot: Bot;
  readonly conversationId: string;
  readonly conversations: ConversationStore;
  /** The turn's context, for the bot's instructions: the same prompt prefix, so the cache holds. */
  readonly context: BotContext;
  /** The turn's `safety_identifier`. */
  readonly safetyIdentifier: string;
  /**
   * The conversation's version after the turn. When anything was written since, nothing is
   * compacted, and the compaction item is appended only at this version.
   */
  readonly version: number;
  readonly signal: AbortSignal;
}

export interface CompactionResult {
  /**
   * - `compacted`: the compaction item was stored, and the next turn replays from it;
   * - `conflict`: the conversation changed first, so nothing was stored; the next turn may try again;
   * - `skipped`: no request was made: the store keeps no items, or the conversation stopped
   *   compacting (ADR-0029, decision 7);
   * - `failed`: the model returned no compaction item.
   */
  readonly outcome: 'compacted' | 'conflict' | 'skipped' | 'failed';
  /** What the compaction request used; zero when none was made. */
  readonly usage: TokenUsage;
}

/**
 * A function call of a stored turn, with its output when it was answered and didn't fail while
 * running.
 */
export interface StoredCall {
  /** Opaque; tells a turn's payloads apart. */
  readonly callId?: string | undefined;
  readonly name: string;
  /** JSON, as the model wrote it. */
  readonly arguments: string;
  readonly output: string | undefined;
}

/**
 * Finds the options the latest answer offered among its turn's calls, oldest first, so they come
 * back after a reload (ADR-0015). The server cleans them up as it does for a live turn.
 */
export type RepliesReader = (calls: readonly StoredCall[]) => readonly string[] | undefined;

/**
 * Finds the UI payloads among one turn's calls, oldest first, so an answer's cards come back after
 * a reload (ADR-0017). Read for every answer in the history, not only the latest.
 */
export type UiReader = (calls: readonly StoredCall[]) => readonly ToolUi[];

/** Texts to classify with the provider's moderation model (ADR-0019). */
export interface ModerationRequest {
  readonly model: string;
  readonly input: readonly string[];
  readonly signal?: AbortSignal;
}

export interface ModerationResult {
  /** Whether the model flagged any of the texts in any category. */
  readonly flagged: boolean;
  /** The categories flagged for any of the texts. */
  readonly categories: readonly string[];
}

/** What output checks decided about an answer, as stored in its conversation. */
export type AnswerVerdict =
  | { readonly action: 'allowed' }
  | { readonly action: 'withheld' }
  | { readonly action: 'replaced'; readonly text: string };

/** What `askdare doctor` checks for one bot: the features it uses, with the server's key. */
export interface DiagnoseRequest {
  readonly model: string;
  readonly vectorStoreId?: string | undefined;
  /** The bot's own index (ADR-0025): its `diagnose()` checks join the report. */
  readonly knowledgeIndex?: KnowledgeIndex | undefined;
  readonly transcriptionModel?: string | undefined;
  readonly attachments: boolean;
}

/**
 * Everything the server needs from the model provider. The OpenAI implementation lives in
 * `src/openai/`; nothing else may depend on the `openai` package (ADR-0002). Conversations live
 * in a `ConversationStore` (ADR-0024).
 */
export interface ModelGateway {
  /** Stores a visitor's file as model input and returns its ID. Files expire after 30 days. */
  uploadFile(upload: UploadRequest): Promise<string>;
  /** Deletes visitors' files, such as those of a deleted conversation. Best effort. */
  deleteFiles(fileIds: readonly string[]): Promise<void>;
  /** Turns recorded speech into text. Nothing is stored. */
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
  runTurn(request: TurnRequest): Promise<TurnResult>;
  /**
   * Summarises a conversation in an item store into one compaction item, after a turn and off the
   * visitor's path (ADR-0029). Absent: conversations are never compacted.
   */
  compact?(request: CompactionRequest): Promise<CompactionResult>;
  /** Classifies texts for `moderation` (ADR-0019). Absent: moderation is unavailable and skipped. */
  moderate?(request: ModerationRequest): Promise<ModerationResult>;
  /** Small live requests that show whether the key, model and stores work (`askdare doctor`). */
  diagnose(request: DiagnoseRequest): Promise<readonly DoctorCheck[]>;
}
