/**
 * Live smoke test against the real OpenAI API. Never part of `pnpm test`.
 *
 * Run with a key from a dedicated OpenAI project that has a hard spend limit:
 *   OPENAI_API_KEY=… SMOKE_MODEL=<cheap current model> pnpm smoke
 * Add SMOKE_VECTOR_STORE_ID (a store synced from examples/starter/knowledge) for the file search turn.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineBot } from '../bot/define-bot';
import type { ProtocolEvent } from '../protocol/events';
import { defineTool } from '../tools/define-tool';
import { createOpenAIGateway } from './gateway';

const apiKey = process.env['OPENAI_API_KEY'];
const model = process.env['SMOKE_MODEL'];
const vectorStoreId = process.env['SMOKE_VECTOR_STORE_ID'];

describe.skipIf(!apiKey || !model)('OpenAI gateway (live)', () => {
  it('runs a text turn in a new conversation and cleans up', async () => {
    const gateway = createOpenAIGateway({ apiKey: apiKey ?? '', maxRetries: 1 });
    const bot = defineBot({
      id: 'smoke',
      model: model ?? '',
      instructions: 'Reply with exactly one word: pong.',
      limits: { maxOutputTokens: 64 },
    });
    const conversationId = await gateway.createConversation({ botId: bot.id, visitorId: 'smoke' });
    try {
      const events: ProtocolEvent[] = [];
      const result = await gateway.runTurn({
        bot,
        conversationId,
        text: 'ping',
        context: { locale: 'en' },
        safetyIdentifier: 'chatdock-smoke',
        visitorId: `v_${'0f'.repeat(16)}`,
        messageId: 'msg_smoke',
        signal: AbortSignal.timeout(60_000),
        emit: (event) => events.push(event),
      });
      const text = events
        .flatMap((event) => (event.type === 'text.delta' ? [event.delta] : []))
        .join('');
      expect(text.toLowerCase()).toContain('pong');
      expect(result.usage.outputTokens).toBeGreaterThan(0);
    } finally {
      await gateway.deleteConversation(conversationId);
    }
  }, 90_000);

  it.skipIf(!vectorStoreId)(
    'searches the knowledge base on the last step and cites the source page',
    async () => {
      const gateway = createOpenAIGateway({ apiKey: apiKey ?? '', maxRetries: 1 });
      const bot = defineBot({
        id: 'smoke',
        model: model ?? '',
        instructions: 'Answer from the documents you can search and cite them.',
        // One step: functions are off, file search must stay available (allowed_tools).
        limits: { maxOutputTokens: 512, maxSteps: 1 },
        tools: [
          defineTool({
            name: 'ping',
            description: 'Never needed.',
            input: z.object({}),
            execute: () => 'pong',
          }),
        ],
        knowledge: { vectorStoreId: vectorStoreId ?? '', maxResults: 3 },
      });
      const conversationId = await gateway.createConversation({
        botId: bot.id,
        visitorId: 'smoke',
      });
      try {
        const events: ProtocolEvent[] = [];
        await gateway.runTurn({
          bot,
          conversationId,
          text: 'How much does the Business plan cost per user per month?',
          context: { locale: 'en' },
          safetyIdentifier: 'chatdock-smoke',
          visitorId: `v_${'0f'.repeat(16)}`,
          messageId: 'msg_smoke',
          signal: AbortSignal.timeout(60_000),
          emit: (event) => events.push(event),
        });
        expect(events).toContainEqual(
          expect.objectContaining({ type: 'tool.status', name: 'file_search', state: 'done' }),
        );
        expect(events).toContainEqual(
          expect.objectContaining({ type: 'citation', url: 'https://example.com/pricing' }),
        );
        const history = await gateway.listMessages(conversationId);
        expect(history.at(-1)?.citations).toContainEqual(
          expect.objectContaining({ url: 'https://example.com/pricing' }),
        );
      } finally {
        await gateway.deleteConversation(conversationId);
      }
    },
    90_000,
  );
});
