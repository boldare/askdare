import type { ResponseStreamEvent } from 'openai/resources/responses/responses';
import { ChatdockError } from '../errors';
import type { TokenUsage } from '../gateway';
import type { ProtocolEvent } from '../protocol/events';

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
      case 'response.output_item.added':
        if (event.item.type === 'reasoning') {
          this.#emit({ type: 'reasoning', messageId: this.#messageId, state: 'started' });
        }
        return;
      case 'response.output_item.done':
        if (event.item.type === 'reasoning') {
          this.#emit({ type: 'reasoning', messageId: this.#messageId, state: 'done' });
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
    if (typeof annotation !== 'object' || annotation === null || !('type' in annotation)) return;
    let key: string;
    let title: string;
    let url: string | undefined;
    if (
      annotation.type === 'url_citation' &&
      'url' in annotation &&
      typeof annotation.url === 'string'
    ) {
      if (!/^https?:\/\//i.test(annotation.url)) return;
      key = `url:${annotation.url}`;
      url = annotation.url;
      title =
        'title' in annotation && typeof annotation.title === 'string' && annotation.title !== ''
          ? annotation.title
          : annotation.url;
    } else if (
      annotation.type === 'file_citation' &&
      'file_id' in annotation &&
      typeof annotation.file_id === 'string'
    ) {
      key = `file:${annotation.file_id}`;
      title =
        'filename' in annotation &&
        typeof annotation.filename === 'string' &&
        annotation.filename !== ''
          ? annotation.filename
          : 'Document';
    } else {
      return;
    }
    const { index, isNew } = this.#citations.register(key);
    if (isNew) this.#emit({ type: 'citation', messageId: this.#messageId, index, title, url });
  }
}
