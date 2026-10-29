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

export interface TurnRequest {
  readonly bot: Bot;
  readonly conversationId: string;
  readonly text: string;
  readonly context: BotContext;
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
  deleteConversation(conversationId: string): Promise<void>;
  /** Visible messages of a conversation, oldest first. */
  listMessages(conversationId: string, signal?: AbortSignal): Promise<readonly HistoryMessage[]>;
  runTurn(request: TurnRequest): Promise<TurnResult>;
}
