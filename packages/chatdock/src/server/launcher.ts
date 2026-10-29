import type { Bot } from '../bot/define-bot';
import { LAUNCHER_PLACEHOLDER, type LauncherLook } from '../protocol/launcher';

const initials = (title: string): string =>
  title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('') || 'AI';

export function launcherLook(bot: Bot): LauncherLook {
  const { theme } = bot.widget;
  const tokens = theme.colorScheme === 'dark' ? theme.dark : theme.light;
  return {
    style: theme.variants.launcher,
    label: bot.widget.launcherLabel,
    accent: tokens.accent,
    onAccent: tokens.onAccent,
    orb: tokens.orb,
    ...(bot.widget.avatar ? { avatar: bot.widget.avatar } : {}),
    initials: initials(bot.widget.title),
    light: theme.light.background,
    dark: theme.dark.background,
    scheme: theme.colorScheme,
    radius: tokens.radius,
  };
}

/**
 * The loader with every bot's launcher look inlined, as a JS string literal that is safe inside
 * either quote style. All values are public, validated configuration.
 */
export function loaderWithLooks(loaderJs: string, bots: readonly Bot[]): string {
  const looks = Object.fromEntries(bots.map((bot) => [bot.id, launcherLook(bot)]));
  const literal = JSON.stringify(JSON.stringify(looks))
    .slice(1, -1)
    .replaceAll("'", '\\u0027')
    .replaceAll(' ', '\\u2028')
    .replaceAll(' ', '\\u2029');
  return loaderJs.replace(LAUNCHER_PLACEHOLDER, literal);
}
