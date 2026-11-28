import { describe, expect, it } from 'vitest';
import { memoryAdminStore } from '../admin/memory';
import type { AdminStore, AdminWriteOptions } from '../admin/port';
import { createBot } from '../bot/define-bot';
import { adminWriter } from './admin-records';

const usage = {
  inputTokens: 10,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 5,
  reasoningTokens: 0,
};

describe('adminWriter', () => {
  it('passes admin.retentionDays with every record it writes', async () => {
    const seen: [string, AdminWriteOptions | undefined][] = [];
    const memory = memoryAdminStore();
    const store: AdminStore = {
      ...memory,
      recordTurn: (record, options) => {
        seen.push(['turn', options]);
        return memory.recordTurn(record, options);
      },
      recordTranscript: (record, options) => {
        seen.push(['transcript', options]);
        return memory.recordTranscript(record, options);
      },
      recordRating: (record, options) => {
        seen.push(['rating', options]);
        return memory.recordRating(record, options);
      },
    };
    const writer = adminWriter(store, { transcripts: true, retentionDays: 90, onError: () => {} });
    const bot = createBot({ id: 'support', model: 'test-model', instructions: 'Help.' });
    const at = Date.UTC(2026, 10, 27, 12);

    await writer.turn(bot, 'chat', {
      usage: {
        bot: 'support',
        model: 'test-model',
        conversation: 'pseudonym',
        visitor: 'visitor',
        startedAt: at,
        durationMs: 100,
        outcome: 'completed',
        usage,
        steps: 1,
        tools: [],
      },
      conversationId: 'conv_1',
      newConversation: true,
      citations: 0,
      check: undefined,
      transcript: {
        bot: 'support',
        visitor: 'visitor',
        conversationId: 'conv_1',
        itemId: 'itm_1',
        startedAt: at,
        input: 'Hi',
        attachments: 0,
        answer: 'Hello',
        citations: [],
        reason: 'completed',
      },
    });
    await writer.rating({
      bot: 'support',
      conversationId: 'conv_1',
      visitor: 'visitor',
      at,
      source: 'chat',
      itemId: 'itm_1',
      rating: 'up',
    });

    expect(seen).toEqual([
      ['turn', { retentionDays: 90 }],
      ['transcript', { retentionDays: 90 }],
      ['rating', { retentionDays: 90 }],
    ]);
  });
});
