import OpenAI, { NotFoundError } from 'openai';
import { fromConversationItem, toInput } from './openai-map.ts';
import { attachedFiles, type ConversationStore, type Positioned } from './port.ts';

/**
 * The default `openaiConversations()` behind the same port. The provider records the model's
 * items during the call (`conversation` + `store: true`), so `context()` returns a reference and
 * the turn appends only what the server writes itself (guardrail notes, `suggest_replies` outputs).
 */
export function openaiConversationsStore(client: OpenAI): ConversationStore {
  const listAll = async (id: string): Promise<Positioned[]> => {
    const items: Positioned[] = [];
    let seq = 0;
    for await (const item of client.conversations.items.list(id, { order: 'asc', limit: 100 })) {
      seq += 1;
      items.push({ ...fromConversationItem(item), seq, at: 0 });
      if (seq >= 1_000) break;
    }
    return items;
  };
  return {
    name: 'openai-conversations',

    async create({ botId, owner }, signal) {
      const conversation = await client.conversations.create(
        { metadata: { askdare_bot: botId, askdare_owner: owner } },
        signal ? { signal } : undefined,
      );
      return conversation.id;
    },

    async info(id, signal) {
      try {
        const conversation = await client.conversations.retrieve(id, signal ? { signal } : undefined);
        const metadata = (conversation.metadata ?? {}) as Record<string, string>;
        const createdAt = conversation.created_at * 1000;
        // No version or last-update time at OpenAI: appends can't be compared, retention can't be swept.
        return { id, botId: metadata['askdare_bot'] ?? '', owner: metadata['askdare_owner'] ?? '', createdAt, updatedAt: createdAt, version: 0 };
      } catch (error) {
        if (error instanceof NotFoundError) return undefined;
        throw error;
      }
    },

    async context(id) {
      return { kind: 'provider', provider: 'openai', ref: id, version: 0 };
    },

    async append(id, items, options) {
      // Not atomic beyond 20 items: the API takes at most 20 per request. `expect` can't be honoured.
      for (let index = 0; index < items.length; index += 20) {
        const input = items.slice(index, index + 20).flatMap((item) => toInput(item, '') ?? []);
        await client.conversations.items.create(id, { items: input }, options?.signal ? { signal: options.signal } : undefined);
      }
      return 0;
    },

    async page(id, options) {
      const page = await client.conversations.items.list(
        id,
        { order: 'desc', limit: Math.min(options?.limit ?? 100, 100), ...(options?.before ? { after: options.before } : {}) },
        options?.signal ? { signal: options.signal } : undefined,
      );
      const items = page.data.toReversed().map((item, index): Positioned => ({ ...fromConversationItem(item), seq: index + 1, at: 0 }));
      const oldest = page.data.at(-1);
      return page.has_more && oldest && 'id' in oldest && typeof oldest.id === 'string' ? { items, before: oldest.id } : { items };
    },

    async delete(id) {
      try {
        // Collected first: once the conversation is gone, its items can no longer be listed.
        const fileIds = attachedFiles(await listAll(id));
        await client.conversations.delete(id);
        return { fileIds };
      } catch (error) {
        if (error instanceof NotFoundError) return { fileIds: [] };
        throw error;
      }
    },
  };
}
