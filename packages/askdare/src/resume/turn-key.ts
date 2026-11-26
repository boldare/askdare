/**
 * How long a turn's events stay in the log after its last one, on top of the turn timeout: long
 * enough for a client to retry `POST /resume` a few times after a drop near the end, short enough
 * that answer text doesn't linger (ADR-0027, decision 6).
 */
export const RESUME_GRACE_MS = 60_000;

/** The time to live of a turn's events, refreshed with each batch the turn writes. */
export function turnLogTtl(turnTimeoutMs: number): number {
  return turnTimeoutMs + RESUME_GRACE_MS;
}

/**
 * The log key of one answer: an HMAC of the bot, the conversation and the answer's message ID.
 * The conversation comes from a verified resume token, so a visitor reaches only answers of their
 * own conversations, and the log (a shared Redis, for example) holds no conversation IDs.
 */
export function turnKey(
  pseudonym: (value: string) => Promise<string>,
  botId: string,
  conversationId: string,
  messageId: string,
): Promise<string> {
  // JSON keeps the parts apart whatever characters a message ID holds.
  return pseudonym(`turn:${JSON.stringify([botId, conversationId, messageId])}`);
}
