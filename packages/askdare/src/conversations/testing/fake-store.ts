import type { ConversationOwner, ConversationStore, StoredItem } from '../port';
import { type HistoryReader, withHistory } from '../provider-history';

/** A provider store for server tests that records what the server did with it. */
export interface FakeConversations extends ConversationStore {
  readonly created: ConversationOwner[];
  readonly deleted: string[];
  readonly appended: { readonly id: string; readonly items: readonly StoredItem[] }[];
  /** Records a conversation as if the store had created it for `owner`. */
  own(id: string, owner: ConversationOwner): void;
}

export interface FakeConversationsOptions {
  /** The ID of each created conversation. Default `conv_new`. */
  readonly id?: string | (() => string);
  /** What `POST /history` reads. Default: no messages. */
  readonly history?: HistoryReader;
  /** What `delete` reports as the visitor's files. Default: none. */
  readonly fileIds?: (id: string) => readonly string[];
  /** Who owns which conversation; pass one map to several stores to share it. */
  readonly owners?: Map<string, ConversationOwner>;
}

export function fakeConversations(options: FakeConversationsOptions = {}): FakeConversations {
  const owners = options.owners ?? new Map<string, ConversationOwner>();
  const created: ConversationOwner[] = [];
  const deleted: string[] = [];
  const appended: { id: string; items: readonly StoredItem[] }[] = [];
  const store: FakeConversations = {
    name: 'fake',
    created,
    deleted,
    appended,
    own: (id, owner) => {
      owners.set(id, owner);
    },
    async create(owner) {
      const id = typeof options.id === 'function' ? options.id() : (options.id ?? 'conv_new');
      owners.set(id, owner);
      created.push(owner);
      return id;
    },
    async info(id) {
      const owner = owners.get(id);
      return owner && { id, ...owner, createdAt: 0, updatedAt: 0, version: 0 };
    },
    async context(id) {
      return { kind: 'provider', provider: 'fake', ref: id, version: 0 };
    },
    async append(id, items) {
      appended.push({ id, items });
      return 0;
    },
    async page() {
      return { items: [] };
    },
    async delete(id) {
      deleted.push(id);
      owners.delete(id);
      return { fileIds: options.fileIds?.(id) ?? [] };
    },
  };
  return withHistory(store, options.history ?? (async () => ({ messages: [] })));
}
