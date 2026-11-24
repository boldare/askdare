import { AskdareError } from '../errors';
import { type ConversationInfo, type ConversationStore, VersionConflictError } from './port';

/** An anonymous visitor's owner string, as `ownerOf` writes it. */
const VISITOR_OWNER = /^visitor:v_[0-9a-f]{32}$/;

/** The `owner` of a new conversation (ADR-0009): the signed-in user's key, else the visitor. */
export function ownerOf(visitorId: string, identityKey: string | undefined): string {
  return identityKey === undefined ? `visitor:${visitorId}` : `user:${identityKey}`;
}

/**
 * Whether a stored conversation belongs to the bot and to the session a resume token names
 * (ADR-0024, decision 5).
 *
 * - An anonymous token matches its own visitor only.
 * - A signed-in user's token matches that user, and also a visitor's conversation: one they
 *   adopted when they signed in (ADR-0009), or one a signed-in user started before 0.6, which
 *   OpenAI stored under its visitor. Such a conversation keeps its visitor as owner, while the
 *   token follows the user through new visitor IDs (an expired session), so the visitor can't be
 *   compared. Only the server issues a user's token for a conversation, after it passed this check
 *   or adopted it, and a conversation of another user never matches.
 */
export function ownsConversation(
  info: ConversationInfo | undefined,
  botId: string,
  grant: { readonly visitorId: string; readonly identityKey?: string | undefined },
): boolean {
  if (!info || info.botId !== botId) return false;
  if (grant.identityKey === undefined) return info.owner === ownerOf(grant.visitorId, undefined);
  return (
    info.owner === ownerOf(grant.visitorId, grant.identityKey) || VISITOR_OWNER.test(info.owner)
  );
}

/** How the server answers an unknown conversation, and one that belongs to someone else. */
export function conversationGone(cause?: unknown): AskdareError {
  return new AskdareError('not_found', {
    message: 'This conversation is no longer available.',
    key: 'error.conversationGone',
    ...(cause === undefined ? {} : { cause }),
  });
}

/**
 * How a turn ends when another turn wrote to its conversation first (ADR-0024, decision 3): as
 * when output checks hold the conversation (ADR-0022), the visitor waits and sends again.
 */
export function conversationBusy(cause?: unknown): AskdareError {
  return new AskdareError('rate_limited', {
    retryAfterMs: 5_000,
    message: 'The previous answer in this conversation is still on its way. Please wait a moment.',
    key: 'error.rate_limited',
    ...(cause === undefined ? {} : { cause }),
  });
}

/**
 * What a store's failure on a conversation means for the visitor. A conversation deleted between
 * the ownership check and a later read or append (in another tab, or by a sweep) answers as an
 * unknown one, so the chat resets instead of failing with `internal_error`. Stores signal a missing
 * conversation each in their own way (ADR-0024 only says they throw), so this asks `info()` again
 * rather than trusting the error's type. Any other failure is returned as it was.
 */
export async function storeFailure(
  store: ConversationStore,
  conversationId: string,
  error: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  if (error instanceof VersionConflictError) return error;
  try {
    if ((await store.info(conversationId, signal)) === undefined) return conversationGone(error);
  } catch {
    // The store can't tell either: the original failure says more.
  }
  return error;
}
