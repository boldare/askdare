import { AskdareError } from '../errors';
import { attachedFiles, contextWindow } from './items';
import {
  type ConversationInfo,
  type ConversationStore,
  type PositionedItem,
  VersionConflictError,
} from './port';

/** Items a page returns when the caller sets no limit. */
const DEFAULT_PAGE = 100;

interface Entry {
  info: ConversationInfo;
  readonly items: PositionedItem[];
}

/**
 * Conversations in this process's memory, for tests and local development. Every instance has its
 * own, and a restart forgets them, so production warns. It is an item store: turns replay its
 * items statelessly.
 */
export function memoryConversations(): ConversationStore {
  if (process.env['NODE_ENV'] === 'production') {
    console.warn(
      '[askdare] Conversations are kept in memory, per instance, and lost on restart. Use a shared store such as @boldare/askdare-postgres.',
    );
  }
  const conversations = new Map<string, Entry>();
  const entry = (id: string): Entry => {
    const found = conversations.get(id);
    if (!found) throw new AskdareError('not_found');
    return found;
  };
  // Copies in and out, so nobody changes a stored item behind the store's back.
  const copy = <T>(value: T): T => structuredClone(value);

  const store: ConversationStore = {
    name: 'memory',

    async create({ botId, owner }) {
      const id = crypto.randomUUID();
      const now = Date.now();
      conversations.set(id, {
        info: { id, botId, owner, createdAt: now, updatedAt: now, version: 0 },
        items: [],
      });
      return id;
    },

    async info(id) {
      return conversations.get(id)?.info;
    },

    async context(id, options) {
      const { info, items } = entry(id);
      const window = contextWindow(items, {
        maxItems: options?.maxItems,
        model: options?.model,
      });
      return { kind: 'items', items: copy(window), version: info.version };
    },

    async append(id, items, options) {
      const found = entry(id);
      const { version } = found.info;
      if (options?.expect !== undefined && options.expect !== version) {
        throw new VersionConflictError(options.expect, version);
      }
      const ids = new Set(found.items.map((item) => item.id));
      for (const item of items) {
        if (ids.has(item.id)) {
          throw new AskdareError('invalid_input', { message: 'An item ID is already stored.' });
        }
        ids.add(item.id);
      }
      if (items.length === 0) return version;
      const at = Date.now();
      for (const [index, item] of items.entries()) {
        found.items.push({ ...copy(item), seq: version + index + 1, at });
      }
      found.info = { ...found.info, version: version + items.length, updatedAt: at };
      return found.info.version;
    },

    async page(id, options) {
      const { items } = entry(id);
      const before =
        options?.before === undefined ? Number.POSITIVE_INFINITY : Number(options.before);
      const limit = Math.max(1, options?.limit ?? DEFAULT_PAGE);
      const older = items.filter((item) => item.seq < before);
      const slice = copy(older.slice(-limit));
      const first = slice[0];
      return first && first.seq > 1
        ? { items: slice, before: String(first.seq) }
        : { items: slice };
    },

    async delete(id) {
      const found = conversations.get(id);
      conversations.delete(id);
      return { fileIds: found ? attachedFiles(found.items) : [] };
    },

    async sweep(idleSince, limit) {
      const deleted: { id: string; fileIds: readonly string[] }[] = [];
      for (const [id, found] of conversations) {
        if (deleted.length >= limit) break;
        if (found.info.updatedAt >= idleSince) continue;
        conversations.delete(id);
        deleted.push({ id, fileIds: attachedFiles(found.items) });
      }
      return deleted;
    },
  };
  return store;
}
