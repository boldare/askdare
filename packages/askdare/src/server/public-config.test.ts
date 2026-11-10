import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineBot } from '../bot/define-bot';
import { getChatConfig } from '../next/get-chat-config';
import { defineTool } from '../tools/define-tool';
import { themeAsset } from './embed-page';
import { publicConfig } from './public-config';

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
  security: { allowedOrigins: ['https://partner.example'] },
  widget: {
    locale: 'auto',
    greeting: 'Public greeting',
    css: ':root { --ask-color-accent: #0f766e; } [data-ask-part="bubble"] { border-radius: 6px; }',
  },
});

describe('publicConfig', () => {
  it('holds only the public part of a bot (ADR-0008)', () => {
    for (const config of [
      publicConfig(bot, '/api/chat'),
      getChatConfig({ bots: [bot], bot: 'support' }),
    ]) {
      const json = JSON.stringify(config);
      expect(json).toContain('Public greeting');
      expect(json).not.toContain('stays on the server');
      expect(json).not.toContain('stays_on_the_server');
      expect(json).not.toContain('stays-on-the-server');
      // The bot's own CSS travels as a stylesheet, and its allowlist is the iframe's business.
      expect(json).not.toContain('0f766e');
      expect(json).not.toContain('partner.example');
    }
  });
});

describe('getChatConfig', () => {
  it('points at the stylesheets the route serves', () => {
    const config = getChatConfig({ bots: [bot], bot: 'support', basePath: '/chat-api' });
    const { hash } = themeAsset(bot.widget.theme, bot.widget.css, bot.id);
    expect(config.basePath).toBe('/chat-api');
    expect(config.styles?.theme).toBe(`/chat-api/theme/support.css?scope=inline&v=${hash}`);
    expect(config.styles?.skin).toMatch(/^\/chat-api\/assets\/skin\.[0-9a-f]+\.css$/);
    expect(config.styles?.fonts).toMatch(/^\/chat-api\/assets\/fonts\.[0-9a-f]+\.css$/);
    expect(config.widget.colorScheme).toBe('auto');
  });

  it("uses the page's language for a bot set to auto, and a fixed locale otherwise", () => {
    expect(getChatConfig({ bots: [bot], bot: 'support' }).widget.locale).toBe('en');
    const polish = getChatConfig({ bots: [bot], bot: 'support', locale: 'pl-PL' });
    expect(polish.widget.locale).toBe('pl-PL');
    expect(polish.widget.texts['composer.send']).toBe('Wyślij');
    const fixed = defineBot({ id: 'de', model: 'm', instructions: 'x', widget: { locale: 'de' } });
    expect(getChatConfig({ bots: [fixed], bot: 'de', locale: 'pl' }).widget.locale).toBe('de');
  });

  it('refuses an unknown bot and a basePath that is not a path', () => {
    expect(() => getChatConfig({ bots: [bot], bot: 'sales' })).toThrow(/no bot "sales"/);
    expect(() =>
      getChatConfig({ bots: [bot], bot: 'support', basePath: 'https://x.example' }),
    ).toThrow(/basePath/);
  });

  it("scopes the bot's theme and its own CSS to that bot's chat", () => {
    const own = [
      '@font-face { font-family: "Brand"; src: url("/fonts/brand.woff2"); }',
      ':root { --ask-color-accent: #0f766e; }',
      'body { background: red; }',
      '@media (max-width: 600px) { [data-ask-part="bubble"] { border-radius: 6px; } }',
      '[data-ask-part="title"]::after { content: "}"; }',
    ].join('\n');
    const { css } = themeAsset(bot.widget.theme, own, 'support');
    const root = '[data-askdare-root][data-ask-bot="support"]';
    expect(css).toContain(`${root}{--ask-color-accent:`);
    expect(css).toContain(`${root}[data-ask-scheme="dark"]{`);
    // Fonts are global by nature; everything else lives inside the bot's scope.
    const [before, scoped] = css.split(`@scope (${root}){`);
    expect(before).toContain('@font-face');
    expect(scoped).toContain(':scope { --ask-color-accent: #0f766e; }');
    expect(scoped).toContain('body { background: red; }');
    expect(scoped).toContain('@media (max-width: 600px)');
    expect(scoped).toContain('content: "}"');
    expect(css).not.toContain(':root');
    // Another bot gets its own stylesheet and hash.
    expect(themeAsset(bot.widget.theme, own, 'sales').hash).not.toBe(
      themeAsset(bot.widget.theme, own, 'support').hash,
    );
  });
});
