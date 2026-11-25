import type { ErrorCode, MessageEndReason } from '../protocol/events';

/** Tokens one turn used, summed over its model calls, as OpenAI reports them. */
export interface ChatTokenUsage {
  readonly inputTokens: number;
  /** Input tokens read from the prompt cache; part of `inputTokens`. */
  readonly cachedInputTokens: number;
  /** Input tokens written to the prompt cache; part of `inputTokens`. */
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
  /** Output tokens spent on reasoning; part of `outputTokens`. */
  readonly reasoningTokens: number;
}

/** One function call of a turn. Its arguments and result are never reported. */
export interface ChatToolCallReport {
  readonly name: string;
  /** Epoch milliseconds. */
  readonly startedAt: number;
  readonly durationMs: number;
  readonly outcome: 'ok' | 'error' | 'timeout';
}

/**
 * The compaction after a turn (ADR-0029), when one was due: the turn's last model call read at
 * least `limits.compactAt` input tokens in a conversation store that keeps the items. Its usage is
 * apart from the turn's own.
 */
export interface ChatCompactionReport {
  /**
   * - `compacted`: the summary was stored, and the next turns replay from it;
   * - `conflict`: the visitor wrote again before it was stored, so it was dropped; a later turn
   *   compacts again;
   * - `skipped`: no request was made: a budget couldn't cover it, or the conversation stopped
   *   compacting because each summary left too large a floor;
   * - `failed`: the request failed or returned no summary; a later turn tries again.
   */
  readonly outcome: 'compacted' | 'conflict' | 'skipped' | 'failed';
  /** What the compaction request used, as OpenAI reported it; zero when none finished. */
  readonly usage: ChatTokenUsage;
  readonly durationMs: number;
}

/**
 * One chat turn, as `onUsage` receives it (ADR-0012). It carries counters, timings and
 * pseudonyms only: never message text, tool arguments or results, IP addresses or raw IDs.
 */
export interface ChatUsageReport {
  readonly bot: string;
  /** The model that answered, as OpenAI reports it; the configured model if none answered. */
  readonly model: string;
  /** A pseudonym (HMAC) of the conversation; undefined when none was created. */
  readonly conversation: string | undefined;
  /**
   * A pseudonym (HMAC) of the signed-in user's ID, or of the visitor's when nobody is signed in:
   * the same value OpenAI gets as `safety_identifier`.
   */
  readonly visitor: string;
  /** Epoch milliseconds. */
  readonly startedAt: number;
  readonly durationMs: number;
  /** `stopped` when the turn was aborted before it could answer. */
  readonly outcome: 'completed' | 'stopped' | 'failed';
  /** Why the answer ended, when it did. */
  readonly finishReason?: MessageEndReason | undefined;
  /** The stable error code, when the turn failed. */
  readonly errorCode?: ErrorCode | undefined;
  /** What OpenAI reported for the model calls that finished; less than billed if one broke off. */
  readonly usage: ChatTokenUsage;
  /** Model calls in the turn: one, plus one after each round of tool calls. */
  readonly steps: number;
  readonly tools: readonly ChatToolCallReport[];
  /**
   * The compaction after the turn, when one was due (`limits.compactAt`). The report then comes
   * once it has ended, up to a minute and a half after the turn.
   */
  readonly compaction?: ChatCompactionReport | undefined;
}
