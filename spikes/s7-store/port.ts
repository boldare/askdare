/**
 * Spike S7: the `ConversationStore` port as proposed for 0.6. No provider types: add-ons such as
 * `@boldare/askdare-store-postgres` implement it without depending on `openai` (ADR-0002).
 */

/** Who may resume, read and delete a conversation (ADR-0009): the visitor, or the signed-in user's HMAC. */
export interface ConversationOwner {
  readonly botId: string;
  /** `visitor:<id>` or `user:<hmac>`; compared as an opaque string. */
  readonly owner: string;
}

export interface ConversationInfo extends ConversationOwner {
  readonly id: string;
  /** Epoch ms. */
  readonly createdAt: number;
  /** Epoch ms of the last append; retention counts from here. */
  readonly updatedAt: number;
  /** Sequence number of the last item; 0 when empty. Used for optimistic appends. */
  readonly version: number;
}

/** Visible or replayable content of a message. */
export type StoredPart =
  | { readonly type: 'text'; readonly text: string; readonly citations?: readonly StoredCitation[] }
  /** The host page's description (ADR-0013); replayed, never shown. */
  | { readonly type: 'page_context'; readonly text: string }
  /** A file from a verified attachment handle; the provider's file ID. */
  | { readonly type: 'file'; readonly fileId: string; readonly kind: 'image' | 'pdf'; readonly name?: string }
  | { readonly type: 'refusal'; readonly text: string };

export interface StoredCitation {
  readonly title: string;
  readonly url?: string;
  /** Provider file ID, when the source is a knowledge-base file. */
  readonly fileId?: string;
}

/**
 * One conversation item. `id` is chosen by the caller (the turn knows its answer's ID before it
 * commits, for feedback handles), unique within the conversation.
 */
export type StoredItem =
  | {
      readonly id: string;
      readonly type: 'message';
      readonly role: 'user' | 'assistant' | 'developer';
      /** Assistant text written before a tool call; hidden unless it was the answer (history.ts). */
      readonly phase?: 'commentary' | 'final_answer';
      readonly parts: readonly StoredPart[];
    }
  | { readonly id: string; readonly type: 'call'; readonly callId: string; readonly name: string; readonly arguments: string }
  | { readonly id: string; readonly type: 'call_output'; readonly callId: string; readonly output: string }
  /**
   * Provider state that only the same provider (and model family) can replay: encrypted
   * reasoning, compaction items, hosted tool calls (file_search). Stored as given, never shown,
   * dropped on replay to another provider.
   */
  | { readonly id: string; readonly type: 'native'; readonly provider: string; readonly family?: string; readonly data: unknown };

/** A stored item with its position. */
export type Positioned<T = StoredItem> = T & { readonly seq: number; readonly at: number };

/** What a model call needs to continue the conversation. */
export type TurnContext =
  /** The provider keeps the items itself (OpenAI Conversations): send its reference, append only server-written items. */
  | { readonly kind: 'provider'; readonly provider: string; readonly ref: string; readonly version: number }
  /** Replay these items, oldest first; append every item the turn produces. */
  | { readonly kind: 'items'; readonly items: readonly Positioned[]; readonly version: number };

export interface Page {
  /** Oldest first. */
  readonly items: readonly Positioned[];
  /** Pass as `before` for the next older page; absent at the start of the conversation. */
  readonly before?: string;
}

export class VersionConflict extends Error {
  readonly expected: number;
  readonly actual: number;
  constructor(expected: number, actual: number) {
    super(`conversation changed: expected version ${expected}, found ${actual}`);
    this.name = 'VersionConflict';
    this.expected = expected;
    this.actual = actual;
  }
}

export interface ConversationStore {
  /** Stable name for logs and diagnostics, e.g. `openai-conversations`, `postgres`. */
  readonly name: string;
  create(owner: ConversationOwner, signal?: AbortSignal): Promise<string>;
  /** Undefined when unknown or deleted. The server compares bot and owner with the resume token's. */
  info(id: string, signal?: AbortSignal): Promise<ConversationInfo | undefined>;
  /** What the next model call reads. Item stores return the replay window (`maxItems`, latest first cut at a turn start). */
  context(id: string, options?: { readonly maxItems?: number; readonly signal?: AbortSignal }): Promise<TurnContext>;
  /**
   * Appends items atomically, in order. With `expect`, fails with {@link VersionConflict} unless
   * the conversation is still at that version (another turn wrote in between). Returns the new
   * version.
   */
  append(
    id: string,
    items: readonly StoredItem[],
    options?: { readonly expect?: number; readonly signal?: AbortSignal },
  ): Promise<number>;
  /** Items newest page first; each page oldest first. `before` is opaque. */
  page(id: string, options?: { readonly before?: string; readonly limit?: number; readonly signal?: AbortSignal }): Promise<Page>;
  /** Deletes the conversation and returns the file IDs its visitor attached, for the gateway to delete. */
  delete(id: string, signal?: AbortSignal): Promise<{ readonly fileIds: readonly string[] }>;
  /**
   * Retention: deletes up to `limit` conversations not appended to since `idleSince` (epoch ms)
   * and returns what was deleted, so the caller deletes the files and AdminStore transcripts.
   * Absent on stores that can't list conversations (OpenAI).
   */
  sweep?(idleSince: number, limit: number): Promise<readonly { readonly id: string; readonly fileIds: readonly string[] }[]>;
}

/** File IDs attached in visitor messages. */
export function attachedFiles(items: Iterable<StoredItem>): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.type !== 'message' || item.role !== 'user') continue;
    for (const part of item.parts) if (part.type === 'file') ids.add(part.fileId);
  }
  return [...ids];
}

/**
 * The replay window: the latest `maxItems` items, moved forward to a visitor message so a turn is
 * never cut in half (a call without its output would break the next model call, spike S1).
 */
export function replayWindow<T extends StoredItem>(items: readonly T[], maxItems: number): T[] {
  if (items.length <= maxItems) return [...items];
  let start = items.length - maxItems;
  while (start < items.length) {
    const item = items[start]!;
    if (item.type === 'message' && item.role === 'user') break;
    start += 1;
  }
  return items.slice(start);
}
