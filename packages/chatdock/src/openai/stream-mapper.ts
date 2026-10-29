import type { ResponseStreamEvent } from 'openai/resources/responses/responses';
import { ChatdockError } from '../errors';
import type { TokenUsage } from '../gateway';
import type { ProtocolEvent } from '../protocol/events';
import { addSources, citationSource, type KnowledgeSources } from './citations';

export interface FunctionCall {
  readonly callId: string;
  readonly name: string;
  readonly arguments: string;
}

export interface StepOutcome {
  readonly status: 'completed' | 'incomplete';
  readonly incompleteReason: string | undefined;
  readonly usage: TokenUsage;
  readonly functionCalls: readonly FunctionCall[];
}

/** Assigns stable [n] markers to sources across all steps of one turn. */
export class CitationRegistry {
  readonly #indices = new Map<string, number>();
  /** Files returned by this turn's searches, so citations can link to their pages. */
  readonly sources: KnowledgeSources = new Map();

  /** Returns the marker for a source and whether it is new. */
  register(key: string): { readonly index: number; readonly isNew: boolean } {
    const existing = this.#indices.get(key);
    if (existing !== undefined) return { index: existing, isNew: false };
    const index = this.#indices.size + 1;
    this.#indices.set(key, index);
    return { index, isNew: true };
  }
}

const ZERO_USAGE: TokenUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };

/**
 * Translates one Responses API stream into protocol events. Only text, refusals, citations and
 * reasoning *status* reach the client; tool arguments, reasoning content and everything else stay
 * on the server. Unknown event types are ignored because the SDK adds them in minor releases.
 */
export class ResponseStreamMapper {
  readonly #messageId: string;
  readonly #emit: (event: ProtocolEvent) => void;
  readonly #citations: CitationRegistry;
  readonly #functionCalls: FunctionCall[] = [];
  #outcome: StepOutcome | undefined;

  constructor(
    messageId: string,
    emit: (event: ProtocolEvent) => void,
    citations: CitationRegistry,
  ) {
    this.#messageId = messageId;
    this.#emit = emit;
    this.#citations = citations;
  }

  handle(event: ResponseStreamEvent): void {
    switch (event.type) {
      case 'response.output_text.delta':
      case 'response.refusal.delta':
        if (event.delta !== '') {
          this.#emit({ type: 'text.delta', messageId: this.#messageId, delta: event.delta });
        }
        return;
      case 'response.output_text.annotation.added':
        this.#handleAnnotation(event.annotation);
        return;
      case 'response.file_search_call.in_progress':
      case 'response.file_search_call.completed':
        this.#emit({
          type: 'tool.status',
          messageId: this.#messageId,
          callId: event.item_id.slice(0, 128),
          name: 'file_search',
          state: event.type === 'response.file_search_call.completed' ? 'done' : 'running',
        });
        return;
      case 'response.output_item.added':
        if (event.item.type === 'reasoning') {
          this.#emit({ type: 'reasoning', messageId: this.#messageId, state: 'started' });
        }
        return;
      case 'response.output_item.done':
        if (event.item.type === 'reasoning') {
          this.#emit({ type: 'reasoning', messageId: this.#messageId, state: 'done' });
        } else if (event.item.type === 'file_search_call') {
          addSources(event.item, this.#citations.sources);
        } else if (event.item.type === 'function_call') {
          this.#functionCalls.push({
            callId: event.item.call_id,
            name: event.item.name,
            arguments: event.item.arguments,
          });
        }
        return;
      case 'response.completed':
      case 'response.incomplete':
        this.#outcome = {
          status: event.type === 'response.completed' ? 'completed' : 'incomplete',
          incompleteReason: event.response.incomplete_details?.reason,
          usage: event.response.usage
            ? {
                inputTokens: event.response.usage.input_tokens,
                cachedInputTokens: event.response.usage.input_tokens_details.cached_tokens,
                outputTokens: event.response.usage.output_tokens,
              }
            : ZERO_USAGE,
          functionCalls: this.#functionCalls,
        };
        return;
      case 'response.failed':
        throw new ChatdockError('upstream_error', { cause: event.response.error });
      case 'error':
        throw new ChatdockError('upstream_error', {
          cause: { code: event.code, message: event.message },
        });
      default:
        return;
    }
  }

  /** Result of the step. Throws when the stream ended without a terminal event. */
  outcome(): StepOutcome {
    if (!this.#outcome) {
      throw new ChatdockError('upstream_error', {
        cause: 'Stream ended without a terminal event.',
      });
    }
    return this.#outcome;
  }

  #handleAnnotation(annotation: unknown): void {
    const source = citationSource(annotation, this.#citations.sources);
    if (!source) return;
    const { index, isNew } = this.#citations.register(source.key);
    if (isNew) {
      this.#emit({
        type: 'citation',
        messageId: this.#messageId,
        index,
        title: source.title,
        url: source.url,
      });
    }
  }
}
