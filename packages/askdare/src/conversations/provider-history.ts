import type { RepliesReader, UiReader } from '../gateway';
import type { HistoryMessage } from '../protocol/history';
import type { ConversationStore } from './port';

export interface HistoryRequest {
  readonly signal?: AbortSignal | undefined;
  readonly replies?: RepliesReader | undefined;
  readonly ui?: UiReader | undefined;
  /** For bots with output checks: show only answers a note settled (ADR-0022). */
  readonly checked?: boolean | undefined;
}

/** Reads the visible messages of a conversation, oldest first. */
export type HistoryReader = (
  conversationId: string,
  request: HistoryRequest,
) => Promise<readonly HistoryMessage[]>;

const readers = new WeakMap<ConversationStore, HistoryReader>();

/**
 * Marks a provider store and gives it its provider's history reader (OpenAI Conversations reads
 * citations from search results the provider stored). Internal: not part of the public port.
 */
export function withHistory<Store extends ConversationStore>(
  store: Store,
  reader: HistoryReader,
): Store {
  readers.set(store, reader);
  return store;
}

/** The history reader of a provider store; undefined for item stores. */
export function historyReader(store: ConversationStore): HistoryReader | undefined {
  return readers.get(store);
}
