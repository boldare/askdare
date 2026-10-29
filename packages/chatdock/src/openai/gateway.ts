import OpenAI, { NotFoundError, toFile } from 'openai';
import type { ModelGateway } from '../gateway';
import { attachedFileIds, deleteFiles, FILE_TTL_SECONDS } from './attachments';
import { fromOpenAIError } from './errors';
import { listHistory } from './history';
import { runTurn } from './turn';

export interface OpenAIGatewayOptions {
  readonly apiKey: string;
  /** Override for tests or proxies. */
  readonly baseURL?: string;
  /** Per-request timeout for the SDK. Default 60 s; the turn deadline is enforced separately. */
  readonly timeoutMs?: number;
  /** SDK retries for failed requests before streaming starts. Default 2. */
  readonly maxRetries?: number;
  /** Custom fetch, for example to route through a proxy. Defaults to the global fetch. */
  readonly fetch?: typeof fetch;
}

/** The default {@link ModelGateway}: OpenAI Responses API with conversations stored by OpenAI (ADR-0003). */
export function createOpenAIGateway(options: OpenAIGatewayOptions): ModelGateway {
  const client = new OpenAI({
    apiKey: options.apiKey,
    ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    timeout: options.timeoutMs ?? 60_000,
    maxRetries: options.maxRetries ?? 2,
  });

  return {
    async createConversation({ botId, visitorId }, signal) {
      try {
        const conversation = await client.conversations.create(
          { metadata: { chatdock_bot: botId, chatdock_visitor: visitorId } },
          signal ? { signal } : undefined,
        );
        return conversation.id;
      } catch (error) {
        throw fromOpenAIError(
          error,
          signal?.reason instanceof DOMException && signal.reason.name === 'TimeoutError',
        );
      }
    },

    async deleteConversation(conversationId, deleteOptions) {
      try {
        // Collected first: once the conversation is gone, its items can no longer be listed.
        const fileIds = deleteOptions?.withFiles
          ? await attachedFileIds(client, conversationId)
          : [];
        await client.conversations.delete(conversationId);
        await deleteFiles(client, fileIds);
      } catch (error) {
        if (error instanceof NotFoundError) return;
        throw fromOpenAIError(error, false);
      }
    },

    async uploadFile({ bytes, filename, mime, signal }) {
      try {
        const file = await client.files.create(
          {
            file: await toFile(bytes, filename, { type: mime }),
            purpose: 'user_data',
            expires_after: { anchor: 'created_at', seconds: FILE_TTL_SECONDS },
          },
          signal ? { signal } : undefined,
        );
        return file.id;
      } catch (error) {
        throw fromOpenAIError(error, false);
      }
    },

    async listMessages(conversationId, signal) {
      try {
        return await listHistory(client, conversationId, signal);
      } catch (error) {
        throw fromOpenAIError(error, false);
      }
    },

    runTurn: (request) => runTurn(client, request),
  };
}
