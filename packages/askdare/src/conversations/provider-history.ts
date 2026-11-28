import type { RepliesReader, UiReader } from '../gateway';
import type { KnowledgeIndex } from '../knowledge/port';
import type { HistoryMessage } from '../protocol/history';
import type { FormOrigin } from './history';
import type { ConversationStore } from './port';

/**
 * Where an older history page ends: the store's own cursor, and how many of the newest items before
 * it the newer page already showed. A turn rarely starts on a store page's edge, so a page of
 * whole turns ends inside the store page it started its oldest turn in (ADR-0024, decision 7).
 */
export interface HistoryPosition {
  /** The cursor the store returned, as `ConversationPage.before`. Opaque. */
  readonly before: string;
  /** The newest items before `before` that were already shown. */
  readonly skip: number;
}

/** One page of history: whole turns, oldest first, and where the next older page ends. */
export interface HistoryPage {
  readonly messages: readonly HistoryMessage[];
  /**
   * The IDs of the answers the visitor may rate: those they saw as final, as the stream rates them
   * (ADR-0022). Absent: none.
   */
  readonly rated?: readonly string[] | undefined;
  /** Absent on the oldest page. */
  readonly next?: HistoryPosition | undefined;
  /** The handoff each handoff form on the page continues, by the form's call ID (ADR-0030). */
  readonly origins?: ReadonlyMap<string, FormOrigin> | undefined;
}

export interface HistoryRequest {
  readonly signal?: AbortSignal | undefined;
  /** The page older than this position; the latest page when absent. */
  readonly before?: HistoryPosition | undefined;
  readonly replies?: RepliesReader | undefined;
  readonly ui?: UiReader | undefined;
  /** For bots with output checks: show only answers a note settled (ADR-0022). */
  readonly checked?: boolean | undefined;
  /**
   * The bot's own index (ADR-0025): its answers' `[id]` markers become `[n]`, from the citations
   * stored with the text, or through `passage()` where the provider stored none.
   */
  readonly knowledge?: KnowledgeIndex | undefined;
}

/** Reads one page of a conversation's visible messages, oldest first. */
export type HistoryReader = (
  conversationId: string,
  request: HistoryRequest,
) => Promise<HistoryPage>;

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
