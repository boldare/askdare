/**
 * The challenge the chat shows before a new session starts. Public: it is sent to browsers, so it
 * holds the site key and never the secret.
 */
export interface HumanChallenge {
  /** Which widget the chat renders. Cloudflare Turnstile is the only one in 0.5. */
  readonly provider: 'turnstile';
  /** The widget's public site key. */
  readonly siteKey: string;
}

/** What a verifier gets with each token. */
export interface HumanCheckContext {
  /** The bot the session is for. */
  readonly botId: string;
  /** Aborts when the check takes too long or the visitor goes away; pass it to `fetch`. */
  readonly signal: AbortSignal;
}

/**
 * Checks that a new session comes from a person (ADR-0004, ADR-0019). The chat renders
 * `challenge`, and `/session` passes the token it got to `verify`. Renewals of a live session
 * aren't checked again. Build one with `turnstile()`, or implement it to check the token some
 * other way.
 */
export interface HumanVerifier {
  readonly challenge: HumanChallenge;
  /**
   * Resolves true when the token proves a person, false when it doesn't (invalid, expired or
   * already used): the visitor is asked to try again. Throw when the check itself can't run, such
   * as a missing secret or an outage: the session is refused and `onError` hears about it.
   */
  verify(token: string, context: HumanCheckContext): Promise<boolean>;
}

/** Where Cloudflare serves Turnstile's script and frame; the iframe's CSP allows it for such bots. */
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

/** Loaded on demand by the chat, with explicit rendering. */
export const TURNSTILE_SCRIPT: string = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`;

/** Longest token Turnstile issues. */
export const HUMAN_TOKEN_MAX_LENGTH = 2048;

/** The origins a challenge's script and frame come from, for the iframe's CSP. */
export const CHALLENGE_ORIGINS: Readonly<Record<HumanChallenge['provider'], string>> = {
  turnstile: TURNSTILE_ORIGIN,
};
