import type OpenAI from 'openai';
import type { ConversationItem } from 'openai/resources/conversations/items';
import type { HistoryCitation, HistoryMessage } from '../protocol/history';

/** Most recent items fetched per history request; older ones are not shown. */
const ITEM_LIMIT = 100;

function citationsOf(annotations: readonly unknown[]): HistoryCitation[] {
  const citations: HistoryCitation[] = [];
  const seen = new Set<string>();
  for (const annotation of annotations) {
    if (typeof annotation !== 'object' || annotation === null || !('type' in annotation)) continue;
    let key: string | undefined;
    let title: string | undefined;
    let url: string | undefined;
    if (
      annotation.type === 'url_citation' &&
      'url' in annotation &&
      typeof annotation.url === 'string'
    ) {
      if (!/^https?:\/\//i.test(annotation.url)) continue;
      key = `url:${annotation.url}`;
      url = annotation.url;
      title =
        'title' in annotation && typeof annotation.title === 'string' && annotation.title
          ? annotation.title
          : url;
    } else if (
      annotation.type === 'file_citation' &&
      'file_id' in annotation &&
      typeof annotation.file_id === 'string'
    ) {
      key = `file:${annotation.file_id}`;
      title =
        'filename' in annotation && typeof annotation.filename === 'string' && annotation.filename
          ? annotation.filename
          : 'Document';
    }
    if (!key || !title || seen.has(key)) continue;
    seen.add(key);
    citations.push({ index: citations.length + 1, title, url });
  }
  return citations;
}

/** Maps one stored item to a visible message; tool calls, reasoning and unknown items are skipped. */
export function toHistoryMessage(item: ConversationItem): HistoryMessage | undefined {
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
  return { id: item.id, role: item.role, text, citations: citationsOf(annotations), attachments };
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
    { order: 'desc', limit: ITEM_LIMIT },
    signal ? { signal } : undefined,
  );
  return page.data.flatMap((item) => toHistoryMessage(item) ?? []).reverse();
}
