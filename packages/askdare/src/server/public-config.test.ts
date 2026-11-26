import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createBot } from '../bot/define-bot';
import { defineForm } from '../forms/define-form';
import { getChatConfig } from '../next/get-chat-config';
import { defineTool } from '../tools/define-tool';
import { themeAsset } from './embed-page';
import { publicConfig } from './public-config';

const bot = createBot({
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
    replies: 'suggest',
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
      // Options arrive as events; the browser doesn't need to know where they come from.
      expect(json).not.toContain('"suggest"');
    }
  });

  it("says only whether the handoff button shows, never the rest of the bot's handoff", () => {
    const base = { id: 'h', model: 'm', instructions: 'x' } as const;
    expect(publicConfig(bot, '/api/chat')).not.toHaveProperty('handoff');
    const contact = defineForm({
      name: 'handoff_contact_form',
      model: false,
      title: 'Contact',
      fields: [{ name: 'email', type: 'email', label: 'Email', required: true }],
    });
    const helped = publicConfig(
      createBot({
        ...base,
        forms: [contact],
        handoff: {
          form: 'handoff_contact_form',
          available: () => true,
          content: 'transcript',
          limits: { perConversation: 7, perVisitorPerDay: 8, perBotPerDay: 987 },
        },
      }),
      '/api/chat',
    );
    // A flag, not an object: the form, limits, content and availability stay on the server.
    expect(helped.handoff).toBe(true);
    const { forms, ...rest } = helped;
    const json = JSON.stringify(rest);
    expect(json).not.toMatch(
      /handoff_contact_form|"transcript"|987|perConversation|"available"|"limits"/,
    );
    // The form itself is public like every form (ADR-0031); only `forms` names it.
    expect(forms?.map((form) => form.name)).toEqual(['handoff_contact_form']);
    // Transports belong to createChatHandler, which publicConfig never sees.
    const modelOnly = createBot({ ...base, handoff: { button: false } });
    expect(publicConfig(modelOnly, '/api/chat')).not.toHaveProperty('handoff');
    expect(getChatConfig({ bots: [modelOnly], bot: 'h' })).not.toHaveProperty('handoff');
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
    const fixed = createBot({ id: 'de', model: 'm', instructions: 'x', widget: { locale: 'de' } });
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

  it('gives each language its own texts, and keeps the sets out of the config', () => {
    const multi = createBot({
      id: 'multi',
      model: 'm',
      instructions: 'x',
      widget: {
        locale: 'auto',
        texts: {
          en: { 'welcome.greeting': 'Hello' },
          pl: { 'welcome.greeting': 'Dzień dobry' },
        },
      },
    });
    const polish = publicConfig(multi, '/api/chat', { locale: 'pl-PL' });
    expect(polish.widget.greeting).toBe('Dzień dobry');
    expect(polish.widget.texts['welcome.greeting']).toBe('Dzień dobry');
    expect(polish.widget.texts['composer.send']).toBe('Wyślij');
    expect(publicConfig(multi, '/api/chat', { locale: 'sv' }).widget.greeting).toBe('Hello');
    expect(publicConfig(multi, '/api/chat').widget.greeting).toBe('Hello');
    expect(JSON.stringify(polish)).not.toContain('textsByLocale');
    expect(JSON.stringify(polish)).not.toContain('Hello');
  });
});
