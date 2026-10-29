import OpenAI, { NotFoundError } from 'openai';
import type { ModelGateway } from '../gateway';
import { fromOpenAIError } from './errors';
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
    async createConversation({ botId, visitorId }) {
      try {
        const conversation = await client.conversations.create({
          metadata: { chatdock_bot: botId, chatdock_visitor: visitorId },
        });
        return conversation.id;
      } catch (error) {
        throw fromOpenAIError(error, false);
      }
    },

    async deleteConversation(conversationId) {
      try {
        await client.conversations.delete(conversationId);
      } catch (error) {
        if (error instanceof NotFoundError) return;
        throw fromOpenAIError(error, false);
      }
    },

    runTurn: (request) => runTurn(client, request),
  };
}
