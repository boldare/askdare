import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineBot } from '../bot/define-bot';
import { defineTool } from '../tools/define-tool';
import { type EmbedAssets, embedConfig, renderEmbedPage } from './embed-page';

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

describe('renderEmbedPage', () => {
  const assets: EmbedAssets = {
    loaderJs: '',
    widgetJs: '',
    widgetCss: '',
    widgetJsFile: 'widget.js',
    widgetCssFile: 'widget.css',
    fontsCss: '',
    fontsCssFile: 'fonts.css',
    fontFiles: {},
  };
  const page = (widget: NonNullable<Parameters<typeof defineBot>[0]['widget']>): string => {
    const bot = defineBot({ id: 'support', model: 'm', instructions: 'x', widget });
    const locale = bot.widget.locale === 'auto' ? 'en' : bot.widget.locale;
    return renderEmbedPage(bot, '/api/chat', assets, {
      locale,
      theme: bot.widget.theme,
      themeHref: '/api/chat/theme/support.css',
    });
  };

  it('marks a translation into a language without a dictionary with its own lang', () => {
    expect(page({ locale: 'de', texts: { 'header.title': 'Assistent' } })).toContain('lang="de"');
    // Untranslated, the interface is English, and says so.
    expect(page({ locale: 'de' })).toContain('lang="en"');
    expect(page({ locale: 'pl-PL' })).toContain('lang="pl-PL"');
  });
});
