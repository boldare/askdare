/**
 * The `ConversationStore` port (ADR-0024): where conversations live. `openaiConversations()` keeps
 * them at OpenAI (the default), `memoryConversations()` in memory for tests, and add-ons such as
 * `@boldare/askdare-postgres` in a database. Nothing here depends on a model provider: the mapping
 * between stored items and a provider's items lives with that provider (ADR-0002).
 */

/** Who may resume, read and delete a conversation (ADR-0009). */
export interface ConversationOwner {
  readonly botId: string;
  /**
   * `visitor:<id>` for an anonymous visitor, `user:<hmac>` for a signed-in user. Opaque to the
   * store: it stores and returns the string, and the server compares it.
   */
  readonly owner: string;
}

/** A stored conversation, as `info()` describes it. */
export interface ConversationInfo extends ConversationOwner {
  readonly id: string;
  /** Epoch milliseconds. */
  readonly createdAt: number;
  /** Epoch milliseconds of the last append; retention counts from here. */
  readonly updatedAt: number;
  /** Sequence number of the last item, 0 while empty. `append`'s `expect` compares with it. */
  readonly version: number;
}

/** Where a cited passage came from, stored with the text that cites it (ADR-0024, decision 8). */
export interface StoredCitation {
  readonly title: string;
  readonly url?: string | undefined;
  /** The knowledge source's ID, when the passage came from the bot's knowledge base. */
  readonly sourceId?: string | undefined;
}

/** One part of a stored message. */
export type StoredPart =
  | {
      readonly type: 'text';
      readonly text: string;
      readonly citations?: readonly StoredCitation[] | undefined;
    }
  /** What the host page said about itself (ADR-0013); sent to the model, never shown. */
  | { readonly type: 'page_context'; readonly text: string }
  /** A file from a verified attachment handle: the provider's file ID, never one from the client. */
  | {
      readonly type: 'file';
      readonly fileId: string;
      readonly kind: 'image' | 'pdf';
      readonly name?: string | undefined;
    }
  | { readonly type: 'refusal'; readonly text: string };

/**
 * One conversation item. Its `id` is chosen by the writer and unique within the conversation; a
 * store that assigns its own IDs (OpenAI) may return others.
 */
export type StoredItem =
  | {
      readonly id: string;
      readonly type: 'message';
      readonly role: 'user' | 'assistant' | 'developer';
      /** Assistant text written before a tool call is `commentary`; the answer is `final_answer`. */
      readonly phase?: 'commentary' | 'final_answer' | undefined;
      readonly parts: readonly StoredPart[];
    }
  | {
      readonly id: string;
      readonly type: 'call';
      readonly callId: string;
      readonly name: string;
      /** JSON, as the model wrote it. */
      readonly arguments: string;
    }
  | {
      readonly id: string;
      readonly type: 'call_output';
      readonly callId: string;
      readonly output: string;
    }
  /**
   * State only the provider that wrote it can read back, such as encrypted reasoning. Stored as
   * given, never shown, and dropped when the conversation is replayed to another provider or model
   * family.
   */
  | {
      readonly id: string;
      readonly type: 'native';
      readonly provider: string;
      readonly family?: string | undefined;
      /**
       * What the item is, for a store that must recognise it without reading `data`. A
       * `compaction` item stands for everything before it: the replay window starts at the latest
       * one of the model's provider and family (ADR-0029). Absent for other state.
       */
      readonly kind?: 'compaction' | undefined;
      readonly data: unknown;
    };

/** A stored item with its position in the conversation. */
export type PositionedItem = StoredItem & {
  /**
   * The item's position: 1 for the first item of the conversation, one more per item. A provider
   * store that can't number its items (OpenAI) counts within the page only.
   */
  readonly seq: number;
  /** Epoch milliseconds of the append that wrote it; 0 when the store doesn't know. */
  readonly at: number;
};

/** The model a conversation is replayed to: a compaction item of another one is ignored. */
export interface CompactionModel {
  readonly provider: string;
  readonly family: string;
}

/** What the next model call reads to continue a conversation. */
export type ConversationContext =
  /** The provider keeps the items itself (OpenAI Conversations): the turn sends this reference. */
  | {
      readonly kind: 'provider';
      readonly provider: string;
      readonly ref: string;
      readonly version: number;
    }
  /** The turn replays these items, oldest first, and appends every item it produces. */
  | { readonly kind: 'items'; readonly items: readonly PositionedItem[]; readonly version: number };

/** One page of a conversation's items. */
export interface ConversationPage {
  /** Oldest first. */
  readonly items: readonly PositionedItem[];
  /** Pass as `before` for the next older page; absent at the start of the conversation. */
  readonly before?: string | undefined;
}

/** One finding of a store's `diagnose()`, shown by `askdare doctor`. Never contains secrets. */
export interface ConversationStoreCheck {
  readonly status: 'ok' | 'warn' | 'fail';
  readonly title: string;
  /** What to do about a warning or failure. */
  readonly fix?: string | undefined;
}

/**
 * Thrown by `append` when the conversation is no longer at the `expect`ed version: another turn
 * wrote first. Nothing of the refused append is stored.
 */
export class VersionConflictError extends Error {
  readonly expected: number;
  readonly actual: number;

  constructor(expected: number, actual: number) {
    super(`The conversation changed: expected version ${expected}, found ${actual}.`);
    this.name = 'VersionConflictError';
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Where conversations live (ADR-0024). Every method that takes an ID answers an unknown or deleted
 * conversation the same way: `info` with `undefined`, `delete` with no files, the others by
 * throwing. Implementations never log stored content.
 */
export interface ConversationStore {
  /** Stable name for logs and diagnostics, such as `openai-conversations` or `postgres`. */
  readonly name: string;
  /** Creates an empty conversation and returns its ID. */
  create(owner: ConversationOwner, signal?: AbortSignal): Promise<string>;
  /** The conversation's bot and owner, which the server compares with the resume token's. */
  info(id: string, signal?: AbortSignal): Promise<ConversationInfo | undefined>;
  /**
   * What the next model call reads. An item store returns the latest `maxItems` items at most,
   * cut forward to a visitor message so a turn is never split. With `model`, the items start at
   * the latest `compaction` item of that provider and family instead, when it is later than that
   * cut (ADR-0029).
   */
  context(
    id: string,
    options?: {
      readonly maxItems?: number | undefined;
      /** The model that reads the items, whose compaction items may start the window. */
      readonly model?: CompactionModel | undefined;
      readonly signal?: AbortSignal | undefined;
    },
  ): Promise<ConversationContext>;
  /**
   * Appends items in order, all or none. With `expect`, throws {@link VersionConflictError} unless
   * the conversation is still at that version. Resolves to the new version. An item ID already in
   * the conversation is refused.
   */
  append(
    id: string,
    items: readonly StoredItem[],
    options?: { readonly expect?: number | undefined; readonly signal?: AbortSignal | undefined },
  ): Promise<number>;
  /** The newest items before `before` (all when absent), oldest first. `before` is opaque. */
  page(
    id: string,
    options?: {
      readonly before?: string | undefined;
      readonly limit?: number | undefined;
      readonly signal?: AbortSignal | undefined;
    },
  ): Promise<ConversationPage>;
  /**
   * Deletes the conversation and returns the IDs of the files its visitor attached, for the
   * server to delete. Deleting an unknown conversation is not an error.
   */
  delete(id: string, signal?: AbortSignal): Promise<{ readonly fileIds: readonly string[] }>;
  /**
   * Retention: deletes up to `limit` conversations with no append since `idleSince` (epoch
   * milliseconds) and returns them, so the caller deletes their files too. Absent on stores that
   * can't list their conversations (OpenAI). An aborted `signal` stops it before it deletes more.
   */
  sweep?(
    idleSince: number,
    limit: number,
    signal?: AbortSignal,
  ): Promise<readonly { readonly id: string; readonly fileIds: readonly string[] }[]>;
  /** Small live checks for `askdare doctor`, such as a reachable database with the right schema. */
  diagnose?(signal?: AbortSignal): Promise<readonly ConversationStoreCheck[]>;
}
