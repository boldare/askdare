/**
 * Maps between the provider-free `StoredItem` and Responses API items. In the library this would
 * live in `src/openai/` (the only place that may import `openai`).
 */
import { randomBytes } from 'node:crypto';
import type { ConversationItem } from 'openai/resources/conversations/items';
import type {
  ResponseInputContent,
  ResponseInputItem,
  ResponseOutputItem,
} from 'openai/resources/responses/responses';
import { toResponseInputItem } from 'openai/lib/responses/ResponseInputItems';
import type { StoredItem, StoredPart } from './port.ts';

export const itemId = (): string => `itm_${randomBytes(9).toString('base64url')}`;

/** Reasoning carries over within a model family only (reasoning guide). `gpt-6.1-terra` → `gpt-6.1`. */
export const modelFamily = (model: string): string => model.replace(/-[a-z]+(-\d{4}-\d{2}-\d{2})?$/, '');

function inputParts(parts: readonly StoredPart[]): ResponseInputContent[] {
  return parts.flatMap((part): ResponseInputContent[] => {
    switch (part.type) {
      case 'text':
      case 'page_context':
        return [{ type: 'input_text', text: part.text }];
      case 'file':
        return [part.kind === 'image' ? { type: 'input_image', file_id: part.fileId, detail: 'auto' } : { type: 'input_file', file_id: part.fileId }];
      case 'refusal':
        return [{ type: 'input_text', text: part.text }];
    }
  });
}

/**
 * A stored item as model input. Deterministic, so a replayed turn renders the same tokens every
 * time and the prompt cache keeps matching. Native items replay only to the same family.
 */
export function toInput(item: StoredItem, family: string): ResponseInputItem | undefined {
  switch (item.type) {
    case 'message':
      if (item.role === 'assistant') {
        return {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          ...(item.phase ? { phase: item.phase } : {}),
          content: item.parts.map((part) =>
            part.type === 'refusal'
              ? { type: 'refusal' as const, refusal: part.text }
              : { type: 'output_text' as const, text: part.type === 'text' ? part.text : '', annotations: [] },
          ),
        } as ResponseInputItem;
      }
      return { type: 'message', role: item.role, content: inputParts(item.parts) };
    case 'call':
      return { type: 'function_call', call_id: item.callId, name: item.name, arguments: item.arguments };
    case 'call_output':
      return { type: 'function_call_output', call_id: item.callId, output: item.output };
    case 'native':
      return item.provider === 'openai' && item.family === family ? (item.data as ResponseInputItem) : undefined;
  }
}

/** Removes the `id` the SDK sets on output messages; with `keepIds` false, from every item. */
function withoutId<T extends object>(value: T): T {
  const { id: _id, ...rest } = value as T & { id?: unknown };
  return rest as T;
}

export function replay(items: readonly StoredItem[], family: string, options: { keepReasoningIds?: boolean } = {}): ResponseInputItem[] {
  return items.flatMap((item) => {
    const input = toInput(item, family);
    if (!input) return [];
    if (item.type === 'native' && options.keepReasoningIds === false) return [withoutId(input)];
    // The assistant mapping above sets no id; drop the undefined key so JSON stays clean.
    return [JSON.parse(JSON.stringify(input)) as ResponseInputItem];
  });
}

/** One output item of a stateless response, as stored. Unknown types are kept as native state. */
export function fromOutput(output: ResponseOutputItem, family: string): StoredItem | undefined {
  const id = itemId();
  switch (output.type) {
    case 'message':
      return {
        id,
        type: 'message',
        role: 'assistant',
        ...(output.phase ? { phase: output.phase } : {}),
        parts: output.content.map((part): StoredPart =>
          part.type === 'output_text' ? { type: 'text', text: part.text } : { type: 'refusal', text: part.refusal },
        ),
      };
    case 'function_call':
      return { id, type: 'call', callId: output.call_id, name: output.name, arguments: output.arguments };
    default: {
      const data = toResponseInputItem(output);
      return data ? { id, type: 'native', provider: 'openai', family, data } : undefined;
    }
  }
}

/** A Conversations API item as a StoredItem (for the `openaiConversations()` store's `page`). */
export function fromConversationItem(item: ConversationItem): StoredItem {
  if (item.type === 'message' && (item.role === 'user' || item.role === 'assistant' || item.role === 'developer')) {
    const parts = item.content.flatMap((part): StoredPart[] => {
      switch (part.type) {
        case 'input_text':
        case 'output_text':
          return [{ type: 'text', text: part.text }];
        case 'refusal':
          return [{ type: 'refusal', text: part.refusal }];
        case 'input_image':
          return part.file_id ? [{ type: 'file', fileId: part.file_id, kind: 'image' }] : [];
        case 'input_file':
          return part.file_id ? [{ type: 'file', fileId: part.file_id, kind: 'pdf' }] : [];
        default:
          return [];
      }
    });
    return { id: item.id, type: 'message', role: item.role, ...(item.phase ? { phase: item.phase } : {}), parts };
  }
  if (item.type === 'function_call') return { id: item.id ?? item.call_id, type: 'call', callId: item.call_id, name: item.name, arguments: item.arguments };
  if (item.type === 'function_call_output' && typeof item.output === 'string') {
    return { id: (item.id as string | undefined) ?? itemId(), type: 'call_output', callId: item.call_id ?? '', output: item.output };
  }
  return { id: 'id' in item && typeof item.id === 'string' ? item.id : itemId(), type: 'native', provider: 'openai', data: item };
}
