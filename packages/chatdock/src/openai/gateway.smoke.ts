/**
 * Live smoke test against the real OpenAI API. Never part of `pnpm test`.
 *
 * Run with a key from a dedicated OpenAI project that has a hard spend limit:
 *   OPENAI_API_KEY=… SMOKE_MODEL=<cheap current model> pnpm smoke
 */
import { describe, expect, it } from 'vitest';
import { defineBot } from '../bot/define-bot';
import type { ProtocolEvent } from '../protocol/events';
import { createOpenAIGateway } from './gateway';

const apiKey = process.env['OPENAI_API_KEY'];
const model = process.env['SMOKE_MODEL'];

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
});
