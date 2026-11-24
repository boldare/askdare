import type OpenAI from 'openai';
import { NotFoundError } from 'openai';
import type { ConversationStore, PositionedItem } from '../conversations/port';
import { withHistory } from '../conversations/provider-history';
import { attachedFileIds } from './attachments';
import { addSources, type KnowledgeSources } from './citations';
import { fromOpenAIError } from './errors';
import { listHistory } from './history';
import { fromConversationItem, toResponseInput } from './items';

/** The Conversations API takes at most this many items per append. */
const APPEND_BATCH = 20;
/** And returns at most this many per page. */
const PAGE_LIMIT = 100;

const timedOut = (signal: AbortSignal | undefined): boolean =>
  signal?.reason instanceof DOMException && signal.reason.name === 'TimeoutError';

/** `openaiConversations()` with a given client, for tests. */
export function createOpenAIConversations(client: () => OpenAI): ConversationStore {
  const store: ConversationStore = {
    name: 'openai-conversations',

    async create({ botId, owner }, signal) {
      try {
        const conversation = await client().conversations.create(
          { metadata: { askdare_bot: botId, askdare_owner: owner } },
          signal ? { signal } : undefined,
        );
        return conversation.id;
      } catch (error) {
        throw fromOpenAIError(error, timedOut(signal));
      }
    },

    async info(id, signal) {
      try {
        const conversation = await client().conversations.retrieve(
          id,
          signal ? { signal } : undefined,
        );
        const metadata = (conversation.metadata ?? {}) as Record<string, unknown>;
        const text = (key: string): string | undefined =>
          typeof metadata[key] === 'string' ? metadata[key] : undefined;
        const visitor = text('askdare_visitor');
        const createdAt = conversation.created_at * 1000;
        return {
          id: conversation.id,
          botId: text('askdare_bot') ?? '',
          // Conversations from 0.5 and earlier name their visitor only.
          owner: text('askdare_owner') ?? (visitor ? `visitor:${visitor}` : ''),
          createdAt,
          // OpenAI reports neither the last change nor a version.
          updatedAt: createdAt,
          version: 0,
        };
      } catch (error) {
        if (error instanceof NotFoundError) return undefined;
        throw fromOpenAIError(error, timedOut(signal));
      }
    },

    async context(id) {
      return { kind: 'provider', provider: 'openai', ref: id, version: 0 };
    },

    async append(id, items, options) {
      // OpenAI keeps no versions, so `expect` can't be checked: it serialises turns itself.
      const input = items.flatMap((item) => toResponseInput(item) ?? []);
      try {
        for (let index = 0; index < input.length; index += APPEND_BATCH) {
          await client().conversations.items.create(
            id,
            { items: input.slice(index, index + APPEND_BATCH) },
            options?.signal ? { signal: options.signal } : undefined,
          );
        }
      } catch (error) {
        throw fromOpenAIError(error, timedOut(options?.signal));
      }
      return 0;
    },

    async page(id, options) {
      try {
        const page = await client().conversations.items.list(
          id,
          {
            order: 'desc',
            limit: Math.min(Math.max(1, options?.limit ?? PAGE_LIMIT), PAGE_LIMIT),
            // Search results carry the titles and URLs that file citations link to.
            include: ['file_search_call.results'],
            ...(options?.before ? { after: options.before } : {}),
          },
          options?.signal ? { signal: options.signal } : undefined,
        );
        const oldestFirst = page.data.toReversed();
        const sources: KnowledgeSources = new Map();
        for (const item of oldestFirst) {
          if (item.type === 'file_search_call') addSources(item, sources);
        }
        // No sequence numbers at OpenAI: positions count within the page.
        const items = oldestFirst.map(
          (item, index): PositionedItem => ({
            ...fromConversationItem(item, sources),
            seq: index + 1,
            at: 0,
          }),
        );
        const oldest = page.data.at(-1);
        return page.has_more && oldest && 'id' in oldest && typeof oldest.id === 'string'
          ? { items, before: oldest.id }
          : { items };
      } catch (error) {
        throw fromOpenAIError(error, timedOut(options?.signal));
      }
    },

    async delete(id, signal) {
      try {
        // Collected first: once the conversation is gone, its items can no longer be listed.
        // A failed listing must not keep the conversation alive; its files then simply expire.
        const fileIds = await attachedFileIds(client(), id).catch((error: unknown) => {
          if (error instanceof NotFoundError) throw error;
          return [];
        });
        await client().conversations.delete(id, signal ? { signal } : undefined);
        return { fileIds };
      } catch (error) {
        if (error instanceof NotFoundError) return { fileIds: [] };
        throw fromOpenAIError(error, timedOut(signal));
      }
    },
  };
  return withHistory(store, async (id, { signal, replies, ui, checked }) => {
    try {
      return await listHistory(client(), id, signal, replies, ui, checked);
    } catch (error) {
      throw fromOpenAIError(error, false);
    }
  });
}
