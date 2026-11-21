import { randomUUID } from 'node:crypto';
import {
  attachedFiles,
  type ConversationInfo,
  type ConversationStore,
  type Positioned,
  replayWindow,
  VersionConflict,
} from './port.ts';

/** `memory()` for tests: the reference implementation the contract suite is written against. */
export function memoryStore(now: () => number = Date.now): ConversationStore {
  const conversations = new Map<string, { info: ConversationInfo; items: Positioned[] }>();
  const get = (id: string) => {
    const entry = conversations.get(id);
    if (!entry) throw new Error('not_found');
    return entry;
  };
  return {
    name: 'memory',
    async create(owner) {
      const id = randomUUID();
      const at = now();
      conversations.set(id, { info: { ...owner, id, createdAt: at, updatedAt: at, version: 0 }, items: [] });
      return id;
    },
    async info(id) {
      return conversations.get(id)?.info;
    },
    async context(id, options) {
      const entry = get(id);
      return { kind: 'items', items: replayWindow(entry.items, options?.maxItems ?? 1_000), version: entry.info.version };
    },
    async append(id, items, options) {
      const entry = get(id);
      const { version } = entry.info;
      if (options?.expect !== undefined && options.expect !== version) throw new VersionConflict(options.expect, version);
      const ids = new Set(entry.items.map((item) => item.id));
      if (items.some((item) => ids.has(item.id))) throw new Error('duplicate item id');
      const at = now();
      items.forEach((item, index) => entry.items.push({ ...structuredClone(item), seq: version + index + 1, at }));
      entry.info = { ...entry.info, version: version + items.length, updatedAt: items.length > 0 ? at : entry.info.updatedAt };
      return entry.info.version;
    },
    async page(id, options) {
      const { items } = get(id);
      const before = options?.before === undefined ? Infinity : Number(options.before);
      const older = items.filter((item) => item.seq < before);
      const slice = older.slice(-(options?.limit ?? 100));
      const first = slice[0];
      return first && first.seq > 1 ? { items: slice, before: String(first.seq) } : { items: slice };
    },
    async delete(id) {
      const entry = conversations.get(id);
      conversations.delete(id);
      return { fileIds: entry ? attachedFiles(entry.items) : [] };
    },
    async sweep(idleSince, limit) {
      const deleted = [];
      for (const [id, entry] of conversations) {
        if (deleted.length >= limit) break;
        if (entry.info.updatedAt < idleSince) deleted.push({ id, fileIds: (await this.delete(id)).fileIds });
      }
      return deleted;
    },
  };
}
