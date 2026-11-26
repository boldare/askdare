import type { VisitorIdentity } from '../security/identity';

/** One rating, as `onFeedback` receives it (ADR-0012). */
export interface ChatFeedbackReport {
  readonly bot: string;
  /** `null` when the visitor took their rating back. */
  readonly rating: 'up' | 'down' | null;
  /** What the visitor wrote, up to 500 characters. Treat it as personal data. */
  readonly comment?: string | undefined;
  /**
   * A pseudonym (HMAC) of the signed-in user's ID, or of the visitor's: the same value
   * `onUsage` reports, so ratings and costs line up.
   */
  readonly visitor: string;
  /** The signed-in user, verified (ADR-0009); absent for anonymous visitors. */
  readonly identity?: VisitorIdentity | undefined;
  /** The conversation in your conversation store, for your review. Never sent to the browser. */
  readonly conversationId: string;
  /**
   * The rated answer's ID within the conversation: OpenAI's `msg_…` ID with
   * `openaiConversations()`, the store's `itm_…` ID with a store that keeps the items.
   */
  readonly itemId: string;
}
