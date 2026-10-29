import type { ThemeTokens } from './presets';
import type { ResolvedTheme } from './theme';

/** Public CSS variable for each token (ADR-0008). */
export const TOKEN_VARIABLES: Readonly<Record<keyof ThemeTokens, string>> = {
  accent: '--cd-color-accent',
  onAccent: '--cd-color-on-accent',
  background: '--cd-color-background',
  surface: '--cd-color-surface',
  text: '--cd-color-text',
  muted: '--cd-color-muted',
  border: '--cd-color-border',
  danger: '--cd-color-danger',
  success: '--cd-color-success',
  userBubble: '--cd-color-user-bubble',
  onUserBubble: '--cd-color-on-user-bubble',
  backdrop: '--cd-backdrop',
  orb: '--cd-orb',
  fontFamily: '--cd-font-family',
  headingFamily: '--cd-font-family-heading',
  fontSize: '--cd-font-size',
  radius: '--cd-radius',
};

function declarations(tokens: ThemeTokens, scheme: 'light' | 'dark'): string {
  const entries = Object.entries(TOKEN_VARIABLES).map(
    ([key, variable]) => `${variable}:${tokens[key as keyof ThemeTokens]}`,
  );
  return `:root{${entries.join(';')};color-scheme:${scheme}}`;
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
  return `@layer chatdock{${rules}}`;
}

/** Variant attributes for the iframe document's root element. */
export function themeAttributes(theme: ResolvedTheme): Record<string, string> {
  return {
    'data-cd-preset': theme.preset,
    'data-cd-scheme': theme.colorScheme,
    ...Object.fromEntries(
      Object.entries(theme.variants).map(([name, value]) => [`data-cd-${name}`, value]),
    ),
  };
}
