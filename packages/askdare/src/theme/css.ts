import type { ThemeTokens } from './presets';
import type { ResolvedTheme } from './theme';

/** Public CSS variable for each token (ADR-0008). */
export const TOKEN_VARIABLES: Readonly<Record<keyof ThemeTokens, string>> = {
  accent: '--ask-color-accent',
  onAccent: '--ask-color-on-accent',
  background: '--ask-color-background',
  surface: '--ask-color-surface',
  text: '--ask-color-text',
  muted: '--ask-color-muted',
  border: '--ask-color-border',
  danger: '--ask-color-danger',
  success: '--ask-color-success',
  userBubble: '--ask-color-user-bubble',
  onUserBubble: '--ask-color-on-user-bubble',
  backdrop: '--ask-backdrop',
  orb: '--ask-orb',
  fontFamily: '--ask-font-family',
  headingFamily: '--ask-font-family-heading',
  fontSize: '--ask-font-size',
  radius: '--ask-radius',
};

function declarations(tokens: ThemeTokens, scheme: 'light' | 'dark', selector = ':root'): string {
  const entries = Object.entries(TOKEN_VARIABLES).map(
    ([key, variable]) => `${variable}:${tokens[key as keyof ThemeTokens]}`,
  );
  return `${selector}{${entries.join(';')};color-scheme:${scheme}}`;
}

/**
 * The theme as a stylesheet, served next to the iframe so the first paint already has the right
 * colors (the CSP forbids inline styles). Token values are validated, so they can't break out.
 * Kept in the library's layer: a site's own CSS still wins.
 */
export function themeStylesheet(theme: ResolvedTheme): string {
  const rules =
    theme.colorScheme === 'auto'
      ? `${declarations(theme.light, 'light')}@media (prefers-color-scheme: dark){${declarations(theme.dark, 'dark')}}`
      : declarations(theme[theme.colorScheme], theme.colorScheme);
  return `@layer askdare{${rules}}`;
}

/** The theme root of one bot's chat inside a page; more specific than the skin's fallback tokens. */
const inlineRoot = (botId: string): string => `[data-askdare-root][data-ask-bot="${botId}"]`;

/**
 * The theme for a chat inside a page (ADR-0011): both schemes, chosen by `data-ask-scheme` on
 * the bot's theme root, so the page can switch it. Scoped to that bot's chat: other chats on the
 * page, and the page itself, are untouched.
 */
export function inlineThemeStylesheet(theme: ResolvedTheme, botId: string): string {
  const root = inlineRoot(botId);
  const dark = (scheme: string): string =>
    declarations(theme.dark, 'dark', `${root}[data-ask-scheme="${scheme}"]`);
  return `@layer askdare{${declarations(theme.light, 'light', root)}${dark('dark')}@media (prefers-color-scheme: dark){${dark('auto')}}}`;
}

/** At-rules that define names for the whole document and can't live inside `@scope`. */
const GLOBAL_AT_RULE =
  /^@(font-face|keyframes|property|import|namespace|counter-style|font-feature-values|charset)\b/i;

/** Splits a stylesheet into its top-level rules, respecting strings, comments and nested blocks. */
function topLevelRules(css: string): string[] {
  const rules: string[] = [];
  let depth = 0;
  let start = 0;
  let quote = '';
  for (let index = 0; index < css.length; index += 1) {
    const char = css[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2);
      index = end === -1 ? css.length : end + 1;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}' || (char === ';' && depth === 0)) {
      if (char === '}') depth = Math.max(0, depth - 1);
      if (depth === 0) {
        rules.push(css.slice(start, index + 1).trim());
        start = index + 1;
      }
    }
  }
  const rest = css.slice(start).trim();
  if (rest) rules.push(rest);
  return rules.filter(Boolean);
}

/**
 * A bot's own CSS for a chat inside a page: inside `@scope` of that bot's theme root, so a rule
 * written for the iframe's document (`body`, `button`, a part of another bot) can't reach the page
 * or another chat. `:root` there means the theme root. `@font-face`, `@keyframes` and the like
 * stay global, as CSS requires.
 */
export function inlineCustomCss(css: string, botId: string): string {
  const global: string[] = [];
  const scoped: string[] = [];
  for (const rule of topLevelRules(css)) {
    if (GLOBAL_AT_RULE.test(rule)) global.push(rule);
    else scoped.push(rule.replaceAll(/:root\b/g, ':scope'));
  }
  const block = scoped.length > 0 ? `@scope (${inlineRoot(botId)}){${scoped.join('\n')}}` : '';
  return [...global, block].filter(Boolean).join('\n');
}

/** Variant attributes for the iframe document's root element. */
export function themeAttributes(theme: ResolvedTheme): Record<string, string> {
  return {
    'data-ask-preset': theme.preset,
    'data-ask-scheme': theme.colorScheme,
    ...Object.fromEntries(
      Object.entries(theme.variants).map(([name, value]) => [`data-ask-${name}`, value]),
    ),
  };
}
