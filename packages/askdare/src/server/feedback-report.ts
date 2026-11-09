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
  /** The OpenAI conversation, for your own review of it. Never sent to the browser. */
  readonly conversationId: string;
  /** The OpenAI ID of the rated answer within the conversation. */
  readonly itemId: string;
}
