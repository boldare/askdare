import type { VisitorIdentity } from '../security/identity';

/**
 * One sent form, as `onLead` receives it (ADR-0031). `values` are what the visitor typed, validated
 * and normalized: treat the report as personal data. askdare keeps none of it.
 */
export interface ChatLeadReport {
  /** A random ID for this submission: drop duplicates by it. */
  readonly id: string;
  readonly bot: string;
  /** The form's name. */
  readonly form: string;
  readonly locale: string;
  /** When the form was sent, in epoch milliseconds. */
  readonly createdAt: number;
  /** Every field of the form by name: text, or `true`/`false` for `consent`; `''` when left empty. */
  readonly values: Readonly<Record<string, string | boolean>>;
  /** The same pseudonym (HMAC) `onUsage`, `onFeedback` and `onHandoff` report. */
  readonly visitor: string;
  /** The signed-in user, verified (ADR-0009); absent for anonymous visitors. */
  readonly identity?: VisitorIdentity | undefined;
  /** The conversation in your conversation store. Never sent to the browser. */
  readonly conversationId: string;
  /**
   * `model` for a form the model showed; `handoff` for a message left through a handoff's form,
   * because nobody was available or the request could not be delivered.
   */
  readonly source:
    | { readonly kind: 'model' }
    | {
        readonly kind: 'handoff';
        readonly reason: 'visitor_asked' | 'cannot_help' | 'complaint' | 'sensitive' | 'sales';
        readonly trigger: 'model' | 'visitor';
        readonly delivered: false;
        readonly why: 'unavailable' | 'failed';
      };
}
