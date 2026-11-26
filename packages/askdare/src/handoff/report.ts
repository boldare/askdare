import type { VisitorIdentity } from '../security/identity';

/** The reasons the `handoff` tool's schema allows (ADR-0030); a visitor's button is `visitor_asked`. */
export const HANDOFF_REASONS: readonly ChatHandoffReport['reason'][] = [
  'visitor_asked',
  'cannot_help',
  'complaint',
  'sensitive',
  'sales',
];

/** How long `onHandoff` has, in milliseconds, before the handoff counts as failed (ADR-0030). */
export const HANDOFF_DEADLINE_MS = 10_000;

/** One visible message of the conversation, in a report with `content: 'transcript'`. */
export interface ChatHandoffMessage {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

/**
 * One request for a person, as `onHandoff` receives it (ADR-0030). Contact details are always
 * included; conversation content only as the bot's `content` option allows. Treat it as
 * personal data.
 */
export interface ChatHandoffReport {
  /** A random ID for this handoff, the same on every retry: drop duplicates by it. */
  readonly id: string;
  readonly bot: string;
  readonly locale: string;
  /** When the handoff was accepted, in epoch milliseconds. */
  readonly createdAt: number;
  /** `model` when the bot called the `handoff` tool, `visitor` for the "Talk to a person" button. */
  readonly trigger: 'model' | 'visitor';
  /** Why: the `handoff` tool's enum. A visitor's button is always `visitor_asked`. */
  readonly reason: 'visitor_asked' | 'cannot_help' | 'complaint' | 'sensitive' | 'sales';
  /**
   * A pseudonym (HMAC) of the signed-in user's ID, or of the visitor's: the same value
   * `onUsage`, `onFeedback` and `onTranscript` report.
   */
  readonly visitor: string;
  /** The signed-in user, verified (ADR-0009); absent for anonymous visitors. */
  readonly identity?: VisitorIdentity | undefined;
  /** The conversation in your conversation store, as `onFeedback` gets it. Never sent to the browser. */
  readonly conversationId: string;
  /**
   * `false` for a message left while nobody was available, which reaches `onHandoff` only when
   * the app set no `onLead`.
   */
  readonly available: boolean;
  /**
   * The validated values of the bot's handoff form, or `{ email }` from a signed-in visitor's
   * identity. Absent when there was neither.
   */
  readonly contact?: Readonly<Record<string, string | boolean>> | undefined;
  /** The model's short note for the person, with `content: 'summary'` or `'transcript'`. */
  readonly summary?: string | undefined;
  /**
   * The visible messages of the conversation's latest history page, oldest first, with
   * `content: 'transcript'` only.
   */
  readonly transcript?: readonly ChatHandoffMessage[] | undefined;
}
