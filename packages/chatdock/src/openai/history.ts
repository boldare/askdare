import type OpenAI from 'openai';
import type { ConversationItem } from 'openai/resources/conversations/items';
import type { HistoryCitation, HistoryMessage } from '../protocol/history';
import { addSources, citationSource, type KnowledgeSources } from './citations';

/** Most recent items fetched per history request; older ones are not shown. */
const ITEM_LIMIT = 100;

function citationsOf(
  annotations: readonly unknown[],
  sources: KnowledgeSources,
): HistoryCitation[] {
  const citations: HistoryCitation[] = [];
  const seen = new Set<string>();
  for (const annotation of annotations) {
    const source = citationSource(annotation, sources);
    if (!source || seen.has(source.key)) continue;
    seen.add(source.key);
    citations.push({ index: citations.length + 1, title: source.title, url: source.url });
  }
  return citations;
}

/** Maps one stored item to a visible message; tool calls, reasoning and unknown items are skipped. */
export function toHistoryMessage(
  item: ConversationItem,
  sources: KnowledgeSources = new Map(),
): HistoryMessage | undefined {
  if (item.type !== 'message' || (item.role !== 'user' && item.role !== 'assistant'))
    return undefined;
  if (item.phase === 'commentary') return undefined;
  let text = '';
  let attachments = 0;
  const annotations: unknown[] = [];
  for (const part of item.content) {
    switch (part.type) {
      case 'input_text':
      case 'output_text':
        text += part.text;
        if (part.type === 'output_text') annotations.push(...part.annotations);
        break;
      case 'refusal':
        text += part.refusal;
        break;
      case 'input_image':
      case 'input_file':
        attachments += 1;
        break;
      default:
        break;
    }
  }
  if (text === '' && attachments === 0) return undefined;
  return {
    id: item.id,
    role: item.role,
    text,
    citations: citationsOf(annotations, sources),
    attachments,
  };
}

/**
 * Reads the visible part of a conversation, oldest first. Spike S1 measured about 2 s per call,
 * so clients load it once when the widget opens, not on every turn.
 */
export async function listHistory(
  client: OpenAI,
  conversationId: string,
  signal?: AbortSignal,
): Promise<HistoryMessage[]> {
  const page = await client.conversations.items.list(
    conversationId,
    // Search results carry the titles and URLs that file citations link to.
    { order: 'desc', limit: ITEM_LIMIT, include: ['file_search_call.results'] },
    signal ? { signal } : undefined,
  );
  const sources: KnowledgeSources = new Map();
  // Oldest first, so the newest search results win when a file was retagged in between.
  for (const item of page.data.toReversed()) {
    if (item.type === 'file_search_call') addSources(item, sources);
  }
  return page.data.flatMap((item) => toHistoryMessage(item, sources) ?? []).reverse();
}
