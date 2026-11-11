import type OpenAI from 'openai';
import type { ConversationItem } from 'openai/resources/conversations/items';
import type { RepliesReader, StoredCall } from '../gateway';
import type { HistoryCitation, HistoryMessage } from '../protocol/history';
import { normalizeReplies } from '../protocol/replies';
import { addSources, citationSource, type KnowledgeSources } from './citations';
import { PAGE_CONTEXT_MARKER } from './page-context';

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
        // The page's description travels in the visitor's turn but is not something they wrote.
        if (part.type === 'input_text' && part.text.startsWith(PAGE_CONTEXT_MARKER)) break;
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
 * The function calls of the latest turn, oldest first, with their outputs: what came after the
 * visitor's last message. Older turns aren't read (ADR-0015).
 */
function latestTurnCalls(newestFirst: readonly ConversationItem[]): StoredCall[] {
  const outputs = new Map<string, string>();
  const calls: { name: string; arguments: string; callId: string }[] = [];
  for (const item of newestFirst) {
    if (item.type === 'message' && item.role === 'user') break;
    if (item.type === 'function_call_output' && item.call_id && typeof item.output === 'string') {
      outputs.set(item.call_id, item.output);
    } else if (item.type === 'function_call') {
      calls.push({ name: item.name, arguments: item.arguments, callId: item.call_id });
    }
  }
  return calls
    .toReversed()
    .map(({ callId, ...call }) => ({ ...call, output: outputs.get(callId) }));
}

/**
 * Reads the visible part of a conversation, oldest first. Spike S1 measured about 2 s per call,
 * so clients load it once when the widget opens, not on every turn.
 */
export async function listHistory(
  client: OpenAI,
  conversationId: string,
  signal?: AbortSignal,
  replies?: RepliesReader,
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
  const messages = page.data.flatMap((item) => toHistoryMessage(item, sources) ?? []);
  // Only the latest answer offers options, and only while the visitor hasn't replied yet.
  const [latest] = messages;
  if (replies && latest?.role === 'assistant') {
    let items: readonly string[] | undefined;
    try {
      items = replies(latestTurnCalls(page.data));
    } catch {
      // A source that can't read its call loses the options, never the conversation.
      items = undefined;
    }
    const offered = items && normalizeReplies(items);
    if (offered) messages[0] = { ...latest, replies: offered };
  }
  return messages.reverse();
}
