import { AskdareError } from '../errors';
import type { ConversationInfo } from './port';

/** The `owner` of a new conversation (ADR-0009): the signed-in user's key, else the visitor. */
export function ownerOf(visitorId: string, identityKey: string | undefined): string {
  return identityKey === undefined ? `visitor:${visitorId}` : `user:${identityKey}`;
}

/**
 * Whether a stored conversation belongs to the bot and to the session a resume token names
 * (ADR-0024, decision 5). A conversation started anonymously stays its visitor's after they sign
 * in: the token then carries both, and either one matches.
 */
export function ownsConversation(
  info: ConversationInfo | undefined,
  botId: string,
  grant: { readonly visitorId: string; readonly identityKey?: string | undefined },
): boolean {
  if (!info || info.botId !== botId) return false;
  return (
    info.owner === ownerOf(grant.visitorId, undefined) ||
    (grant.identityKey !== undefined && info.owner === ownerOf(grant.visitorId, grant.identityKey))
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
