import type { MessageEndReason } from '../protocol/events';
import type { VisitorIdentity } from '../security/identity';

/** One source of an answer, as the visitor saw it under the answer. */
export interface ChatTranscriptCitation {
  /** The 1-based marker shown in the answer's text as `[n]`. */
  readonly index: number;
  readonly title: string;
  readonly url?: string | undefined;
}

/**
 * One finished turn, as `onTranscript` receives it (ADR-0016): what the visitor sent and the
 * answer they saw. It is the only report that carries message content, so treat all of it as
 * personal data.
 */
export interface ChatTranscriptReport {
  readonly bot: string;
  /**
   * A pseudonym (HMAC) of the signed-in user's ID, or of the visitor's: the same value `onUsage`
   * and `onFeedback` report.
   */
  readonly visitor: string;
  /** The signed-in user, verified (ADR-0009); absent for anonymous visitors. */
  readonly identity?: VisitorIdentity | undefined;
  /** The conversation in your conversation store, as `onFeedback` gets it. Never sent to the browser. */
  readonly conversationId: string;
  /**
   * The answer's ID in the conversation: the `itemId` `onFeedback` gets when the visitor rates
   * it. Absent for a replaced or withheld answer, and when the store reported none.
   */
  readonly itemId?: string | undefined;
  /** When the turn started, in epoch milliseconds: the same value `onUsage` reports for it. */
  readonly startedAt: number;
  /**
   * What the visitor sent, as the model received it: after `onInput` redacted it. Empty when
   * they sent only files.
   */
  readonly input: string;
  /** How many files the visitor attached. Their names and contents are not included. */
  readonly attachments: number;
  /**
   * The answer the visitor saw: the replacement when output checks replaced it, undefined when
   * they withheld it. Reply options and tool cards are not included.
   */
  readonly answer: string | undefined;
  /** The sources shown with the answer; empty for a withheld one. */
  readonly citations: readonly ChatTranscriptCitation[];
  /** What output checks decided (ADR-0022); absent for bots without them. */
  readonly check?: 'allowed' | 'replaced' | 'withheld' | undefined;
  /** Why the answer ended. */
  readonly reason: MessageEndReason;
}
