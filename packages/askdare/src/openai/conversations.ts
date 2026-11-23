import type OpenAI from 'openai';
import type { ConversationStore } from '../conversations/port';
import { AskdareError } from '../errors';
import { createOpenAIClient } from './client';
import { createOpenAIConversations } from './conversation-store';

export interface OpenAIConversationsOptions {
  /**
   * The key of the OpenAI project the conversations live in. Default `process.env.OPENAI_API_KEY`,
   * read on first use.
   */
  readonly apiKey?: string;
}

/**
 * Conversations stored by OpenAI's Conversations API, askdare's default (ADR-0003). A provider
 * store: the model's items are recorded during each turn, so `context()` returns a reference and
 * askdare appends only what the server writes itself, such as notes of output checks. No database
 * is needed; OpenAI keeps the conversations until they are deleted, and they can't be swept.
 *
 * ```ts
 * createChatHandler({ bots, conversations: openaiConversations() });
 * ```
 */
export function openaiConversations(options: OpenAIConversationsOptions = {}): ConversationStore {
  let client: OpenAI | undefined;
  return createOpenAIConversations(() => {
    if (!client) {
      const apiKey = options.apiKey ?? process.env['OPENAI_API_KEY'];
      if (!apiKey) {
        throw new AskdareError('bot_unavailable', { cause: 'OPENAI_API_KEY is not configured.' });
      }
      client = createOpenAIClient({ apiKey });
    }
    return client;
  });
}
