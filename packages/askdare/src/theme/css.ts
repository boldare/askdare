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

/** The theme root of a chat inside a page; more specific than the skin's fallback tokens. */
const INLINE_ROOT = '[data-askdare-root][data-ask-preset]';

/**
 * The theme for a chat inside a page (ADR-0011): both schemes, chosen by `data-ask-scheme` on
 * the theme root, so the page can switch it. Nothing here touches the page outside the chat.
 */
export function inlineThemeStylesheet(theme: ResolvedTheme): string {
  const dark = (scheme: string): string =>
    declarations(theme.dark, 'dark', `${INLINE_ROOT}[data-ask-scheme="${scheme}"]`);
  return `@layer askdare{${declarations(theme.light, 'light', INLINE_ROOT)}${dark('dark')}@media (prefers-color-scheme: dark){${dark('auto')}}}`;
}

/** A bot's own CSS for a chat inside a page: `:root` there means the theme root, not the page. */
export function inlineCustomCss(css: string): string {
  return css.replaceAll(/:root\b/g, '[data-askdare-root]');
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
