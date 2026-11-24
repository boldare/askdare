import { toResponseInputItem } from 'openai/lib/responses/ResponseInputItems';
import type {
  ResponseInputItem,
  ResponseOutputItem,
  ResponseOutputMessage,
} from 'openai/resources/responses/responses';
import { newItemId } from '../conversations/items';
import type { StoredItem, StoredPart } from '../conversations/port';
import { type CitationContext, textCitations } from './citations';
import { toResponseInput } from './items';

/** The `provider` of native items written by OpenAI models. */
const PROVIDER = 'openai';

/**
 * The family a model's reasoning carries over within: `gpt-5.6-sol`, `gpt-5.6-terra` and
 * `gpt-5.6-luna` reuse each other's reasoning, the GPT-5.6 and GPT-5.5 families don't
 * (https://developers.openai.com/api/docs/guides/reasoning#preserve-reasoning-across-calls).
 * A dated snapshot belongs to its model's family. A wrong guess costs tokens only: the API leaves
 * out reasoning it can't use.
 */
export function modelFamily(model: string): string {
  return model.replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-[a-z]+$/, '');
}

/**
 * A stored item as input for a stateless request (`store: false`), or nothing when the model
 * mustn't see it. Deterministic, so a replayed turn renders the same tokens every time and the
 * prompt cache keeps matching (ADR-0024, decision 3):
 * - assistant messages go back in their output form, with their phase;
 * - native OpenAI items go back as they came, reasoning only to the model family that wrote it;
 * - everything else as `toResponseInput` writes it for an OpenAI conversation.
 */
export function toReplayInput(item: StoredItem, family: string): ResponseInputItem | undefined {
  if (item.type === 'native') {
    if (item.provider !== PROVIDER) return undefined;
    if (item.family !== undefined && item.family !== family) return undefined;
    return item.data as ResponseInputItem;
  }
  if (item.type === 'message' && item.role === 'assistant') {
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
      // The SDK types want the output message's ID, which a stateless request doesn't need.
    } as unknown as ResponseInputItem;
  }
  return toResponseInput(item);
}

/** Stored items as the input of a stateless request, oldest first. */
export function replayInput(items: readonly StoredItem[], family: string): ResponseInputItem[] {
  return items.flatMap((item) => toReplayInput(item, family) ?? []);
}

function messageParts(message: ResponseOutputMessage, context: CitationContext): StoredPart[] {
  return message.content.flatMap((part): StoredPart[] => {
    if (part.type === 'refusal') return [{ type: 'refusal', text: part.refusal }];
    if (part.type !== 'output_text') return [];
    // Titles and URLs are stored with the text, so history needs neither the search nor its
    // results (ADR-0024, decision 8).
    const citations = textCitations(part.text, part.annotations, context);
    return [
      citations.length > 0
        ? { type: 'text', text: part.text, citations }
        : { type: 'text', text: part.text },
    ];
  });
}

/**
 * Output items kept as native state: the model's encrypted reasoning, and the searches it ran with
 * their results, as an OpenAI conversation keeps them. Nothing else is replayed: a type askdare
 * doesn't request can't become input that the model reads with more authority.
 */
const NATIVE: ReadonlySet<string> = new Set(['reasoning', 'file_search_call']);

/**
 * One output item of a stateless response as stored, with a new ID. Messages become assistant
 * messages and function calls calls; reasoning becomes native state tagged with the model family,
 * and searches native state for any OpenAI model. Other items are left out.
 */
export function fromResponseOutput(
  output: ResponseOutputItem,
  family: string,
  context: CitationContext,
): StoredItem | undefined {
  const id = newItemId();
  if (output.type === 'message') {
    return {
      id,
      type: 'message',
      role: 'assistant',
      ...(output.phase ? { phase: output.phase } : {}),
      parts: messageParts(output, context),
    };
  }
  if (output.type === 'function_call') {
    return {
      id,
      type: 'call',
      callId: output.call_id,
      name: output.name,
      arguments: output.arguments,
    };
  }
  if (!NATIVE.has(output.type)) return undefined;
  const data = toResponseInputItem(output);
  if (!data) return undefined;
  return output.type === 'reasoning'
    ? { id, type: 'native', provider: PROVIDER, family, data }
    : { id, type: 'native', provider: PROVIDER, data };
}
