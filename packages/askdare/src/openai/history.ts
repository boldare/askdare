import type OpenAI from 'openai';
import { HISTORY_ITEMS, historyFromItems } from '../conversations/history';
import type { RepliesReader, UiReader } from '../gateway';
import type { HistoryMessage } from '../protocol/history';
import { addSources, type KnowledgeSources } from './citations';
import { fromConversationItem } from './items';

/**
 * Reads the visible part of a conversation, oldest first. Spike S1 measured about 2 s per call,
 * so clients load it once when the widget opens, not on every turn. The items are mapped to stored
 * items, with citations from the search results OpenAI stored, and read like any item store's.
 */
export async function listHistory(
  client: OpenAI,
  conversationId: string,
  signal?: AbortSignal,
  replies?: RepliesReader,
  ui?: UiReader,
  checked = false,
): Promise<HistoryMessage[]> {
  const page = await client.conversations.items.list(
    conversationId,
    // Search results carry the titles and URLs that file citations link to.
    { order: 'desc', limit: HISTORY_ITEMS, include: ['file_search_call.results'] },
    signal ? { signal } : undefined,
  );
  const oldestFirst = page.data.toReversed();
  const sources: KnowledgeSources = new Map();
  // Oldest first, so the newest search results win when a file was retagged in between.
  for (const item of oldestFirst) {
    if (item.type === 'file_search_call') addSources(item, sources);
  }
  return historyFromItems(
    oldestFirst.map((item) => fromConversationItem(item, sources)),
    { replies, ui, checked },
  );
}
