import type OpenAI from 'openai';
import type { ConversationItem } from 'openai/resources/conversations/items';
import { HISTORY_ITEMS, historyFromItems } from '../conversations/history';
import type { HistoryRequest } from '../conversations/provider-history';
import { citedSourceIds } from '../knowledge/markers';
import { PassageLookup } from '../knowledge/passages';
import type { KnowledgeIndex } from '../knowledge/port';
import type { HistoryMessage } from '../protocol/history';
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

/**
 * Reads the visible part of a conversation, oldest first. Spike S1 measured about 2 s per call,
 * so clients load it once when the widget opens, not on every turn. The items are mapped to stored
 * items, with citations from the search results OpenAI stored, and read like any item store's.
 */
export async function listHistory(
  client: OpenAI,
  conversationId: string,
  { signal, replies, ui, checked = false, knowledge }: HistoryRequest = {},
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
  const passages = knowledge ? await citedPassages(knowledge, oldestFirst, signal) : undefined;
  return historyFromItems(
    oldestFirst.map((item) => fromConversationItem(item, { sources, passages })),
    { replies, ui, checked, knowledge },
  );
}
