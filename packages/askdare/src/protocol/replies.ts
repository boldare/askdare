/*
 * Reply options (ADR-0015): clickable answers under the latest reply. The server cleans them up
 * with `normalizeReplies`; both sides check what goes over the wire with `isReplyList`.
 */

export const MAX_REPLIES = 4;
export const MAX_REPLY_LENGTH = 80;

/**
 * A URL or something a browser or a chat app would turn into a link: a scheme (`https://`,
 * `mailto:`, `javascript:` …), `www.`, an IP address or a domain name such as `example.com`.
 * Strict on purpose: a few odd names (`Node.js`) are dropped with them.
 */
const LINK =
  /[a-z][a-z\d+.-]*:\/\/|\b(?:mailto|tel|sms|javascript|vbscript|data|file):|\bwww\.|\b\d{1,3}(?:\.\d{1,3}){3}\b|[\p{L}\d-]\.[a-z]{2,}(?![\p{L}\d])/iu;

/**
 * Characters the visitor can't see or read: line breaks and other control characters, format
 * characters (bidirectional overrides that reorder text, zero-width characters, tag characters
 * that can spell hidden words), private-use and unassigned code points. A click sends the option
 * as the visitor's own message, so it must say exactly what they read. The zero-width joiner stays
 * for emoji built from several, such as "woman technologist".
 */
const CONTROL = /[\p{Cc}\p{Co}\p{Cn}\u2028\u2029]|(?!\u200d)\p{Cf}/u;

/** One option as it goes over the wire: trimmed, 1 to 80 characters, one line, no links. */
export function isReplyText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_REPLY_LENGTH &&
    value === value.trim() &&
    !CONTROL.test(value) &&
    !LINK.test(value)
  );
}

/** A list of options as it goes over the wire: 1 to 4 valid options, no duplicates. */
export function isReplyList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_REPLIES &&
    value.every(isReplyText) &&
    new Set(value).size === value.length
  );
}

/**
 * The options worth sending from what a source proposed: whitespace collapsed and trimmed, then
 * empty, too long, linked and repeated ones dropped, at most four. Undefined when none is left,
 * so no event is sent.
 */
export function normalizeReplies(values: readonly unknown[]): readonly string[] | undefined {
  const replies: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const reply = value.replace(/\s+/gu, ' ').trim();
    if (isReplyText(reply) && !replies.includes(reply)) replies.push(reply);
    if (replies.length === MAX_REPLIES) break;
  }
  return replies.length > 0 ? replies : undefined;
}
