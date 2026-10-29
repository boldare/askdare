import { describe, expect, it } from 'vitest';
import { defineBot } from '../bot/define-bot';
import { themeAttributes, themeStylesheet } from './css';
import { PRESETS } from './presets';
import { defineTheme, resolveTheme, themeWarnings } from './theme';

describe('resolveTheme', () => {
  it('starts from Halo and follows the system color scheme by default', () => {
    const theme = resolveTheme(undefined, 'auto');
    expect(theme.preset).toBe('halo');
    expect(theme.light).toEqual(PRESETS.halo.light);
    expect(theme.variants.welcome).toBe('hero');
  });

  it('applies a brand accent with readable text, and token and variant overrides', () => {
    const theme = resolveTheme(
      defineTheme({
        extends: 'sage',
        accent: '#f5c518',
        tokens: { radius: '8px' },
        dark: { background: '#000000' },
        variants: { launcher: 'circle' },
      }),
      'auto',
    );
    expect(theme.light).toMatchObject({
      accent: '#f5c518',
      onAccent: '#0b0b0b',
      userBubble: '#f5c518',
      radius: '8px',
    });
    expect(theme.dark).toMatchObject({ accent: '#f5c518', background: '#000000', radius: '8px' });
    expect(theme.variants).toMatchObject({ welcome: 'persona', launcher: 'circle' });
  });

  it('warns about pairs a customized theme makes hard to read', () => {
    const theme = resolveTheme({ extends: 'halo', tokens: { muted: '#c0c4cc' } }, 'light');
    expect(themeWarnings(theme)).toContainEqual(
      expect.stringContaining('light: secondary text on panel'),
    );
  });
});

describe('defineTheme', () => {
  it.each([
    [{ accent: 'red' }, /accent must be a hex color/],
    [{ tokens: { backdrop: 'url(https://evil.example/x.png)' } }, /must be a plain CSS value/],
    [{ tokens: { orb: 'red; } body { display: none' } }, /must be a plain CSS value/],
    [{ tokens: { fontFamily: '"A"; }' } }, /font-family list/],
    [{ tokens: { radius: '200px' } }, /0px to 32px/],
    [{ extends: 'neon' }, /extends/],
  ])('rejects %o', (definition, message) => {
    expect(() => defineTheme(definition as never)).toThrow(message);
  });
});

describe('theme stylesheet', () => {
  it('declares light tokens, dark tokens under the media query, and variant attributes', () => {
    const theme = resolveTheme('care', 'auto');
    const css = themeStylesheet(theme);
    expect(css.startsWith('@layer chatdock{:root{--cd-color-accent:#3730a3')).toBe(true);
    expect(css).toContain('@media (prefers-color-scheme: dark){:root{--cd-color-accent:#c9d0ff');
    expect(themeAttributes(theme)).toMatchObject({
      'data-cd-preset': 'care',
      'data-cd-welcome': 'intro',
      'data-cd-avatar': 'icon',
    });
    expect(themeStylesheet(resolveTheme('care', 'dark'))).not.toContain('@media');
  });
});

describe('bot widget', () => {
  it('validates starters and the avatar, and resolves the theme', () => {
    const bot = defineBot({
      id: 'a',
      model: 'm',
      instructions: 'x',
      widget: { theme: 'aura', colorScheme: 'dark', starters: ['Pricing?'], avatar: '/ola.webp' },
    });
    expect(bot.widget).toMatchObject({ starters: ['Pricing?'], avatar: '/ola.webp' });
    expect(bot.widget.theme).toMatchObject({ preset: 'aura', colorScheme: 'dark' });
    expect(() =>
      defineBot({ id: 'a', model: 'm', instructions: 'x', widget: { avatar: '//x.io/a.png' } }),
    ).toThrow(/widget\.avatar/);
    expect(() =>
      defineBot({ id: 'a', model: 'm', instructions: 'x', widget: { starters: ['', 'x'] } }),
    ).toThrow(/widget\.starters/);
  });
});
