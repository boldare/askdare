import type { FormPurpose } from './forms';

/*
 * Handoff to a human (ADR-0030) on the wire: the states the chat shows, and `POST /handoff`.
 */

/**
 * Where a handoff stands. `requested` while it runs or while its form waits; the others are final:
 * `sent` (delivered), `saved` (the form's values went to `onLead` instead), `unavailable` (nobody
 * was available and there was no form), `failed` (the delivery failed and nothing saved it) and
 * `limited` (a handoff limit refused it).
 */
export const HANDOFF_STATES = [
  'requested',
  'sent',
  'saved',
  'unavailable',
  'failed',
  'limited',
] as const;

export type HandoffState = (typeof HANDOFF_STATES)[number];

/** The body of `POST /handoff`: the visitor's button. Nothing in it chooses what happens. */
export interface HandoffRequest {
  readonly botId: string;
  readonly resumeToken: string;
}

/** A form the visitor fills in before the handoff goes on (ADR-0031). */
export interface HandoffForm {
  /** Picks the form's description from the bot's public configuration. */
  readonly name: string;
  /** Opaque; sent back to `POST /forms` as `form`. */
  readonly handle: string;
  /** `handoff` for contact details, `message` for a message left while nobody is available. */
  readonly purpose: Extract<FormPurpose, 'handoff' | 'message'>;
}

/** The answer of `POST /handoff`. */
export interface HandoffResponse {
  /** The final state, or `requested` with `form` when the visitor has to fill one in first. */
  readonly state: HandoffState;
  /** Only with `requested`. */
  readonly form?: HandoffForm | undefined;
}
