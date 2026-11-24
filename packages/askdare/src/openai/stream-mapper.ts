import type { ResponseOutputItem, ResponseStreamEvent } from 'openai/resources/responses/responses';
import { MarkerMerger } from '../citation-markers';
import { AskdareError } from '../errors';
import type { TokenUsage } from '../gateway';
import type { ProtocolEvent } from '../protocol/events';
import { ZERO_USAGE } from '../usage';
import { addSources, citationSource, type KnowledgeSources } from './citations';

export interface FunctionCall {
  readonly callId: string;
  readonly name: string;
  readonly arguments: string;
}

export interface StepOutcome {
  readonly status: 'completed' | 'incomplete';
  readonly incompleteReason: string | undefined;
  /** The model that answered, as the response reports it. */
  readonly model: string | undefined;
  /** The provider's ID of the step's last visible answer message, the one visitors rate. */
  readonly answerItemId: string | undefined;
  /** The provider's ID of the step's last message of any phase, commentary included. */
  readonly textItemId: string | undefined;
  readonly usage: TokenUsage;
  readonly functionCalls: readonly FunctionCall[];
  /** Every output item of the step, in order, as a stateless turn stores them. */
  readonly output: readonly ResponseOutputItem[];
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

  /** Whether `[index]` is the marker of a source registered in this turn. */
  has(index: number): boolean {
    return Number.isInteger(index) && index >= 1 && index <= this.#indices.size;
  }
}

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
  /** Finished output items by position, for servers whose terminal event leaves them out. */
  readonly #done: ResponseOutputItem[] = [];
  readonly #markers: MarkerMerger;
  #answerItemId: string | undefined;
  #textItemId: string | undefined;
  #outcome: StepOutcome | undefined;

  constructor(
    messageId: string,
    emit: (event: ProtocolEvent) => void,
    citations: CitationRegistry,
  ) {
    this.#messageId = messageId;
    this.#emit = emit;
    this.#citations = citations;
    this.#markers = new MarkerMerger((index) => citations.has(index));
  }

  handle(event: ResponseStreamEvent): void {
    switch (event.type) {
      case 'response.output_text.delta':
      case 'response.refusal.delta':
        this.#emitText(this.#markers.push(event.delta));
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
        } else if (event.item.type === 'message') {
          this.#textItemId = event.item.id;
          if (event.item.phase !== 'commentary') this.#answerItemId = event.item.id;
        }
        return;
      case 'response.output_item.done':
        this.#done[event.output_index] = event.item;
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
      case 'response.incomplete': {
        this.#emitText(this.#markers.flush());
        // Optional chains: servers other than OpenAI may leave the details out (spike S6b).
        const usage = event.response.usage;
        this.#outcome = {
          status: event.type === 'response.completed' ? 'completed' : 'incomplete',
          incompleteReason: event.response.incomplete_details?.reason,
          model: event.response.model || undefined,
          answerItemId: this.#answerItemId,
          textItemId: this.#textItemId,
          usage: usage
            ? {
                inputTokens: usage.input_tokens,
                cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? 0,
                cacheWriteTokens: usage.input_tokens_details?.cache_write_tokens ?? 0,
                outputTokens: usage.output_tokens,
                reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
              }
            : ZERO_USAGE,
          functionCalls: this.#functionCalls,
          output:
            event.response.output?.length > 0
              ? event.response.output
              : this.#done.filter((item) => item !== undefined),
        };
        return;
      }
      case 'response.failed':
        throw new AskdareError('upstream_error', { cause: event.response.error });
      case 'error':
        throw new AskdareError('upstream_error', {
          cause: { code: event.code, message: event.message },
        });
      default:
        return;
    }
  }

  /** Result of the step. Throws when the stream ended without a terminal event. */
  outcome(): StepOutcome {
    if (!this.#outcome) {
      throw new AskdareError('upstream_error', {
        cause: 'Stream ended without a terminal event.',
      });
    }
    return this.#outcome;
  }

  #emitText(delta: string): void {
    if (delta !== '') this.#emit({ type: 'text.delta', messageId: this.#messageId, delta });
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
