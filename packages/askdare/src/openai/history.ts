import type OpenAI from 'openai';
import type { ConversationItem } from 'openai/resources/conversations/items';
import { historyFromItems, pageOfTurns, type RawPage } from '../conversations/history';
import type { HistoryPage, HistoryRequest } from '../conversations/provider-history';
import { citedSourceIds } from '../knowledge/markers';
import { PassageLookup } from '../knowledge/passages';
import type { KnowledgeIndex } from '../knowledge/port';
import { addSources, type KnowledgeSources } from './citations';
import { fromConversationItem } from './items';

/** Distinct passages one history read looks up: about two per answer of a full page. */
const HISTORY_LOOKUPS = 200;

/**
 * The passages the answers cite, looked up in the bot's index: OpenAI stores the model's `[id]`
 * markers but no citations for them (ADR-0025, decision 5). A passage removed by a later sync no
 * longer resolves, and its marker is dropped.
 */
async function citedPassages(
  index: KnowledgeIndex,
  items: readonly ConversationItem[],
  signal: AbortSignal | undefined,
): Promise<PassageLookup> {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.type !== 'message' || item.role !== 'assistant') continue;
    for (const part of item.content) {
      if (part.type === 'output_text') for (const id of citedSourceIds(part.text)) ids.add(id);
    }
  }
  const passages = new PassageLookup(index, HISTORY_LOOKUPS);
  if (ids.size > 0) await passages.resolve([...ids], signal);
  return passages;
}

/** The Conversations API returns at most this many items per page. */
const LIST_LIMIT = 100;

const startsTurn = (item: ConversationItem): boolean =>
  item.type === 'message' && item.role === 'user';

/**
 * Reads one page of whole turns of the visible conversation, oldest first. Spike S1 measured about
 * 2 s per call, so clients load the latest page once when the widget opens, not on every turn, and
 * older pages only when the visitor scrolls back. The items are mapped to stored items, with
 * citations from the search results OpenAI stored, and read like any item store's.
 */
export async function listHistory(
  client: OpenAI,
  conversationId: string,
  { signal, before, replies, ui, checked = false, knowledge }: HistoryRequest = {},
): Promise<HistoryPage> {
  const { items, next } = await pageOfTurns(
    async (cursor, limit): Promise<RawPage<ConversationItem>> => {
      const page = await client.conversations.items.list(
        conversationId,
        {
          order: 'desc',
          limit: Math.min(limit, LIST_LIMIT),
          // Search results carry the titles and URLs that file citations link to.
          include: ['file_search_call.results'],
          ...(cursor === undefined ? {} : { after: cursor }),
        },
        signal ? { signal } : undefined,
      );
      const oldest = page.data.at(-1);
      const more = page.has_more && oldest && 'id' in oldest && typeof oldest.id === 'string';
      return { items: page.data.toReversed(), before: more ? oldest.id : undefined };
    },
    startsTurn,
    before,
  );
  const sources: KnowledgeSources = new Map();
  // Oldest first, so the newest search results win when a file was retagged in between. A turn's
  // searches and its answer are always on the same page.
  for (const item of items) {
    if (item.type === 'file_search_call') addSources(item, sources);
  }
  const passages = knowledge ? await citedPassages(knowledge, items, signal) : undefined;
  const messages = historyFromItems(
    items.map((item) => fromConversationItem(item, { sources, passages })),
    // Options belong to the latest answer, which only the latest page has.
    { replies: before ? undefined : replies, ui, checked, knowledge },
  );
  return next ? { messages, next } : { messages };
}
