import type { ConversationItem } from 'openai/resources/conversations/items';
import type { ResponseInputContent, ResponseInputItem } from 'openai/resources/responses/responses';
import { newItemId } from '../conversations/items';
import type { StoredCitation, StoredItem, StoredPart } from '../conversations/port';
import { citationSource, type KnowledgeSources } from './citations';
import { PAGE_CONTEXT_MARKER, pageContextPart } from './page-context';

/** What `pageContextPart` puts before the page's description. */
const PAGE_CONTEXT_PREFIX = (pageContextPart('') as { text: string }).text;

function inputContent(part: StoredPart): ResponseInputContent | undefined {
  switch (part.type) {
    case 'text':
    case 'refusal':
      return { type: 'input_text', text: part.text };
    case 'page_context':
      return pageContextPart(part.text);
    case 'file':
      return part.kind === 'image'
        ? { type: 'input_image', file_id: part.fileId, detail: 'auto' }
        : { type: 'input_file', file_id: part.fileId };
    default:
      return undefined;
  }
}

/**
 * A stored item as Responses API input, for appending to an OpenAI conversation. Deterministic:
 * the same item always gives the same JSON. A message of one plain text part is sent as a string,
 * as askdare always has. Another provider's native items have no OpenAI form.
 */
export function toResponseInput(item: StoredItem): ResponseInputItem | undefined {
  switch (item.type) {
    case 'message': {
      const [only, ...rest] = item.parts;
      if (only?.type === 'text' && rest.length === 0 && !only.citations?.length) {
        return { role: item.role, content: only.text };
      }
      if (item.role === 'assistant') {
        // An assistant message replayed as input, as spike S7 sent it; the SDK types want an ID.
        return {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          ...(item.phase ? { phase: item.phase } : {}),
          content: item.parts.flatMap((part): Record<string, unknown>[] =>
            part.type === 'refusal'
              ? [{ type: 'refusal', refusal: part.text }]
              : part.type === 'text'
                ? [{ type: 'output_text', text: part.text, annotations: [] }]
                : [],
          ),
        } as unknown as ResponseInputItem;
      }
      return {
        type: 'message',
        role: item.role,
        content: item.parts.flatMap((part) => inputContent(part) ?? []),
      };
    }
    case 'call':
      return {
        type: 'function_call',
        call_id: item.callId,
        name: item.name,
        arguments: item.arguments,
      };
    case 'call_output':
      return { type: 'function_call_output', call_id: item.callId, output: item.output };
    case 'native':
      return item.provider === 'openai' ? (item.data as ResponseInputItem) : undefined;
    default:
      return undefined;
  }
}

/** The sources a text part's annotations cite, each once, as stored with the text. */
export function citationsOf(
  annotations: readonly unknown[],
  sources: KnowledgeSources,
): StoredCitation[] {
  const citations: StoredCitation[] = [];
  const seen = new Set<string>();
  for (const annotation of annotations) {
    const source = citationSource(annotation, sources);
    if (!source || seen.has(source.key)) continue;
    seen.add(source.key);
    citations.push(source.url ? { title: source.title, url: source.url } : { title: source.title });
  }
  return citations;
}

function storedParts(
  content: Extract<ConversationItem, { type: 'message' }>['content'],
  sources: KnowledgeSources,
): StoredPart[] {
  return content.flatMap((part): StoredPart[] => {
    switch (part.type) {
      case 'input_text':
        if (part.text.startsWith(PAGE_CONTEXT_MARKER)) {
          const text = part.text.startsWith(PAGE_CONTEXT_PREFIX)
            ? part.text.slice(PAGE_CONTEXT_PREFIX.length)
            : part.text.slice(PAGE_CONTEXT_MARKER.length).trimStart();
          return [{ type: 'page_context', text }];
        }
        return [{ type: 'text', text: part.text }];
      case 'output_text': {
        const citations = citationsOf(part.annotations, sources);
        return [
          citations.length > 0
            ? { type: 'text', text: part.text, citations }
            : { type: 'text', text: part.text },
        ];
      }
      case 'refusal':
        return [{ type: 'refusal', text: part.refusal }];
      case 'input_image':
        return part.file_id ? [{ type: 'file', fileId: part.file_id, kind: 'image' }] : [];
      case 'input_file':
        return part.file_id ? [{ type: 'file', fileId: part.file_id, kind: 'pdf' }] : [];
      default:
        // New content types appear in SDK minor releases.
        return [];
    }
  });
}

/**
 * An item of an OpenAI conversation as a stored item. Items askdare doesn't model (reasoning,
 * search calls, and types the SDK adds later) are kept as native OpenAI state.
 */
export function fromConversationItem(
  item: ConversationItem,
  sources: KnowledgeSources = new Map(),
): StoredItem {
  const id = 'id' in item && typeof item.id === 'string' ? item.id : newItemId();
  if (
    item.type === 'message' &&
    (item.role === 'user' || item.role === 'assistant' || item.role === 'developer')
  ) {
    return {
      id,
      type: 'message',
      role: item.role,
      ...(item.phase ? { phase: item.phase } : {}),
      parts: storedParts(item.content, sources),
    };
  }
  if (item.type === 'function_call') {
    return {
      id,
      type: 'call',
      callId: item.call_id,
      name: item.name,
      arguments: item.arguments,
    };
  }
  if (
    item.type === 'function_call_output' &&
    typeof item.output === 'string' &&
    typeof item.call_id === 'string'
  ) {
    return { id, type: 'call_output', callId: item.call_id, output: item.output };
  }
  return { id, type: 'native', provider: 'openai', data: item };
}
