import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineBot } from '../bot/define-bot';
import { defineTool } from '../tools/define-tool';
import { embedConfig } from './embed-page';

describe('embedConfig', () => {
  it('sends the browser only the public part of a bot (ADR-0008)', () => {
    const bot = defineBot({
      id: 'support',
      model: 'model-that-stays-on-the-server',
      instructions: 'Instructions that stay on the server.',
      tools: [
        defineTool({
          name: 'tool_that_stays_on_the_server',
          description: 'A description that stays on the server.',
          input: z.object({}),
          execute: () => 1,
        }),
      ],
      knowledge: { vectorStoreId: 'vs_store_that_stays_on_the_server' },
      voice: { model: 'transcriber-that-stays-on-the-server' },
      widget: { greeting: 'Public greeting' },
    });

    const json = JSON.stringify(embedConfig(bot, '/api/chat'));

    expect(json).toContain('Public greeting');
    expect(json).not.toContain('stays on the server');
    expect(json).not.toContain('stays_on_the_server');
    expect(json).not.toContain('stays-on-the-server');
  });
});
