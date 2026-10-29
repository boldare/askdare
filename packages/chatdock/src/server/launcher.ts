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

/** The placeholder as the minifier left it, in whichever quotes it chose (it picks backticks too). */
const QUOTED_PLACEHOLDER = new RegExp(`(['"\`])${LAUNCHER_PLACEHOLDER}\\1`);

/**
 * The loader with the requested bot's launcher look inlined, and no other bot's: widget.js must
 * not list every bot. The whole quoted placeholder is replaced by a JSON string literal, which is
 * a valid JS string whatever it contains (quotes, backticks, `${`, `$&`), and the replacement is a
 * function so `String.replace` patterns in the values are not interpreted.
 */
export function loaderWithLook(loaderJs: string, bot: Bot | undefined): string {
  const looks = bot ? { [bot.id]: launcherLook(bot) } : {};
  const literal = JSON.stringify(JSON.stringify(looks))
    .replaceAll(' ', '\\u2028')
    .replaceAll(' ', '\\u2029');
  return loaderJs.replace(QUOTED_PLACEHOLDER, () => literal);
}
