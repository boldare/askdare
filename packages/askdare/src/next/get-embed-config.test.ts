import { describe, expect, it } from 'vitest';
import { defineBot } from '../bot/define-bot';
import { embedPageHeaders, getEmbedConfig } from './get-embed-config';

const bots = [
  defineBot({
    id: 'support',
    model: 'secret-model-id',
    instructions: 'Secret instructions.',
    knowledge: { vectorStoreId: 'vs_secret' },
    security: { allowedOrigins: ['https://www.example.com', 'https://shop.example.com'] },
    embedPath: '/askdare/support',
    widget: { locale: 'auto' },
  }),
  defineBot({
    id: 'voice',
    model: 'm',
    instructions: 'x',
    voice: { model: 'transcribe-model' },
    embedPath: '/askdare/voice',
  }),
];

describe('getEmbedConfig', () => {
  it("reads the language and the mode the route passes, from Next's searchParams or a URL", () => {
    const config = getEmbedConfig({
      bots,
      bot: 'support',
      searchParams: { lang: ['pl-PL', 'de'], mode: 'inline' },
    });
    expect(config.widget.locale).toBe('pl-PL');
    expect(config.mode).toBe('inline');
    expect(config.allowedOrigins).toEqual(['https://www.example.com', 'https://shop.example.com']);
    expect(config.basePath).toBe('/api/chat');

    const plain = getEmbedConfig({
      bots,
      bot: 'support',
      basePath: '/chat',
      searchParams: new URLSearchParams('mode=popup'),
    });
    expect(plain.widget.locale).toBe('en');
    expect(plain.mode).toBe('floating');
    expect(plain.basePath).toBe('/chat');
  });

  it('holds nothing a browser must not see', () => {
    const json = JSON.stringify(getEmbedConfig({ bots, bot: 'support', searchParams: {} }));
    for (const secret of [
      'secret-model-id',
      'Secret instructions',
      'vs_secret',
      '/askdare/support',
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it('names a bot that is missing', () => {
    expect(() => getEmbedConfig({ bots, bot: 'nope', searchParams: {} })).toThrow(
      '[askdare] getEmbedConfig: there is no bot "nope".',
    );
  });
});

describe('embedPageHeaders', () => {
  it("sends the iframe page's frame-ancestors, microphone and referrer rules", () => {
    expect(embedPageHeaders({ bots, bot: 'support' })).toEqual([
      {
        key: 'Content-Security-Policy',
        value: "frame-ancestors 'self' https://www.example.com https://shop.example.com",
      },
      { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=()' },
      { key: 'Referrer-Policy', value: 'strict-origin' },
    ]);
    expect(embedPageHeaders({ bots, bot: 'voice' })[1]?.value).toBe(
      'camera=(), geolocation=(), microphone=(self)',
    );
    expect(() => embedPageHeaders({ bots, bot: 'nope' })).toThrow('there is no bot "nope"');
  });
});
