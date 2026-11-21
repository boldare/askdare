import { describe, expect, it } from 'vitest';
import {
  inlineCustomCss,
  inlineThemeStylesheet,
  TOKEN_VARIABLES,
  themeAttributes,
  themeStylesheet,
} from './css';
import { resolveTheme } from './theme';

const ROOT = '[data-askdare-root][data-ask-bot="support"]';

describe('themeStylesheet', () => {
  it('declares every token as its public variable, with the color scheme', () => {
    const theme = resolveTheme('aura', 'light');
    const css = themeStylesheet(theme);
    for (const [key, variable] of Object.entries(TOKEN_VARIABLES)) {
      expect(css).toContain(`${variable}:${theme.light[key as keyof typeof theme.light]}`);
    }
    expect(css).toMatch(/^@layer askdare\{:root\{.*;color-scheme:light\}\}$/);
  });

  it('uses only the dark tokens for a dark-only theme', () => {
    const theme = resolveTheme('aura', 'dark');
    const css = themeStylesheet(theme);
    expect(css).toContain(`--ask-color-background:${theme.dark.background}`);
    expect(css).toContain('color-scheme:dark');
    expect(css).not.toContain('color-scheme:light');
  });
});

describe('inlineThemeStylesheet', () => {
  const theme = resolveTheme('aura', 'auto');
  const css = inlineThemeStylesheet(theme, 'support');

  it("scopes both schemes to the bot's theme root, never the page", () => {
    expect(css.startsWith(`@layer askdare{${ROOT}{--ask-color-accent:${theme.light.accent}`)).toBe(
      true,
    );
    expect(css).toContain(
      `${ROOT}[data-ask-scheme="dark"]{--ask-color-accent:${theme.dark.accent}`,
    );
    expect(css).toContain(
      `@media (prefers-color-scheme: dark){${ROOT}[data-ask-scheme="auto"]{--ask-color-accent:${theme.dark.accent}`,
    );
    expect(css).not.toContain(':root');
  });

  it('leaves other bots alone', () => {
    expect(css).not.toContain('data-ask-bot="sales"');
  });
});

describe('inlineCustomCss', () => {
  it('keeps every rule inside the scope when the CSS has unbalanced braces or quotes', () => {
    // A stray `}` used to close @scope early, so `body` reached the host page.
    expect(inlineCustomCss('a { color: red } } body { display: none }', 'support')).toBe(
      `@scope (${ROOT}){a { color: red }\nbody { display: none }}`,
    );
    expect(inlineCustomCss('} body { display: none }', 'support')).toBe(
      `@scope (${ROOT}){body { display: none }}`,
    );
    expect(inlineCustomCss('a { b { color: red }', 'support')).toBe(
      `@scope (${ROOT}){a { b { color: red }}}`,
    );
    expect(inlineCustomCss('a { content: "x }', 'support')).toBe(
      `@scope (${ROOT}){a { content: "x }"}}`,
    );
  });

  it("wraps the bot's rules in @scope of its theme root, :root meaning that root", () => {
    expect(inlineCustomCss(':root { --ask-radius: 0 } body { margin: 0 }', 'support')).toBe(
      `@scope (${ROOT}){:scope { --ask-radius: 0 }\nbody { margin: 0 }}`,
    );
  });

  it('keeps @font-face, @keyframes and @import global, before the scoped block', () => {
    const css = [
      "@import url('x.css');",
      "@font-face { font-family: X; src: url('x.woff2') }",
      '[data-ask-part="bubble"] { animation: pop 1s }',
      '@keyframes pop { from { opacity: 0 } to { opacity: 1 } }',
    ].join('\n');
    expect(inlineCustomCss(css, 'support').split('\n')).toEqual([
      "@import url('x.css');",
      "@font-face { font-family: X; src: url('x.woff2') }",
      '@keyframes pop { from { opacity: 0 } to { opacity: 1 } }',
      `@scope (${ROOT}){[data-ask-part="bubble"] { animation: pop 1s }}`,
    ]);
  });

  it('keeps nested blocks, such as @media, whole and scoped', () => {
    const css = '@media (max-width: 600px) { a { color: red } b { color: blue } }';
    expect(inlineCustomCss(css, 'support')).toBe(`@scope (${ROOT}){${css}}`);
  });

  it('is not fooled by braces in strings or comments', () => {
    const css = `a::after { content: "}" } /* } { */ b { content: '\\'{' }`;
    const out = inlineCustomCss(css, 'support');
    expect(out.startsWith(`@scope (${ROOT}){`)).toBe(true);
    expect(out).toContain('a::after { content: "}" }');
    expect(out).toContain(`b { content: '\\'{' }`);
    expect(out.endsWith('}')).toBe(true);
  });

  it('returns nothing for empty CSS and only globals when there is nothing to scope', () => {
    expect(inlineCustomCss('   ', 'support')).toBe('');
    expect(inlineCustomCss('@font-face { font-family: X }', 'support')).toBe(
      '@font-face { font-family: X }',
    );
  });
});

describe('themeAttributes', () => {
  it('names the preset, the scheme and each variant', () => {
    const theme = resolveTheme('aura', 'auto');
    const attributes = themeAttributes(theme);
    expect(attributes['data-ask-preset']).toBe('aura');
    expect(attributes['data-ask-scheme']).toBe('auto');
    for (const [name, value] of Object.entries(theme.variants)) {
      expect(attributes[`data-ask-${name}`]).toBe(value);
    }
  });
});
