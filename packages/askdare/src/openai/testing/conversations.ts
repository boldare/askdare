import type OpenAI from 'openai';
import { settledAnswerItems } from '../../conversations/guard-notes';
import type { ConversationStore } from '../../conversations/port';
import { historyReader } from '../../conversations/provider-history';
import type { AnswerVerdict, RepliesReader, UiReader } from '../../gateway';
import type { HistoryMessage } from '../../protocol/history';
import { createOpenAIClient } from '../client';
import { createOpenAIConversations } from '../conversation-store';
import { OPENAI_TEST_BASE_URL } from './msw';

export interface TestConversations {
  readonly store: ConversationStore;
  /** The history the server shows, as `POST /history` reads it. */
  listMessages(
    conversationId: string,
    signal?: AbortSignal,
    replies?: RepliesReader,
    ui?: UiReader,
    checked?: boolean,
  ): Promise<readonly HistoryMessage[]>;
  /** Appends a verdict's note, as the server does after output checks. */
  settle(conversationId: string, verdict: AnswerVerdict): Promise<void>;
}

/**
 * `openaiConversations()` against the MSW test base URL. The client is created on first use, after
 * MSW has patched fetch (the SDK keeps a reference to it).
 */
export function testConversations(): TestConversations {
  let client: OpenAI | undefined;
  const store = createOpenAIConversations(
    () =>
      (client ??= createOpenAIClient({
        apiKey: 'sk-test',
        baseURL: OPENAI_TEST_BASE_URL,
        maxRetries: 0,
      })),
  );
  const read = historyReader(store);
  if (!read) throw new Error('openaiConversations() lost its history reader.');
  return {
    store,
    listMessages: (conversationId, signal, replies, ui, checked) =>
      read(conversationId, { signal, replies, ui, checked }).then((page) => page.messages),
    async settle(conversationId, verdict) {
      await store.append(conversationId, settledAnswerItems(verdict));
    },
  };
}
