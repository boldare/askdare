import { type Bot, primarySubtag, widgetTexts } from '../bot/define-bot';
import { TEXT_LOCALES, textLocale, textsFor } from '../i18n/texts';
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
  const greeting = bot.widget.launcherGreeting;
  // The loader picks an entry by the page's primary subtag: one per built-in dictionary, plus one
  // per language the bot has its own texts for (`de`, in English with the bot's German set).
  const languages = [
    ...new Set([...TEXT_LOCALES, ...Object.keys(bot.widget.textsByLocale).map(primarySubtag)]),
  ];
  const texts = Object.fromEntries(
    languages.map((language) => {
      // A fixed locale shows its own texts in the dictionary it uses, `de` in English say.
      const fixed = bot.widget.locale !== 'auto' && textLocale(bot.widget.locale) === language;
      const all = textsFor(language, widgetTexts(bot.widget, fixed ? bot.widget.locale : language));
      return [
        language,
        {
          label: all['launcher.label'] ?? '',
          open: all['launcher.open'] ?? '',
          close: all['launcher.close'] ?? '',
          unavailable: all['launcher.unavailable'] ?? '',
          title: all['header.title'] ?? '',
          unread: all['launcher.unread'] ?? '',
          // A bot without a greeting doesn't ship its texts to every page (ADR-0033).
          ...(greeting
            ? {
                greeting: all['launcher.greeting'] ?? '',
                dismiss: all['launcher.dismiss'] ?? '',
              }
            : {}),
        },
      ];
    }),
  );
  return {
    style: theme.variants.launcher,
    texts,
    ...(bot.widget.locale === 'auto' ? {} : { locale: textLocale(bot.widget.locale) }),
    accent: tokens.accent,
    onAccent: tokens.onAccent,
    orb: tokens.orb,
    ...(bot.widget.avatar ? { avatar: bot.widget.avatar } : {}),
    initials: initials(bot.widget.title),
    light: theme.light.background,
    dark: theme.dark.background,
    text: theme.light.text,
    textDark: theme.dark.text,
    scheme: theme.colorScheme,
    radius: tokens.radius,
    ...(greeting ? { greet: Math.round(greeting.delaySeconds * 1000) } : {}),
  };
}

/**
 * The look of a launcher whose bot the server can't name: a tag with only `data-bot`, or one whose
 * `data-bot` differs from `?bot=`. The loader carries no fallbacks of its own (ADR-0033), so this is
 * the blue chat icon with English texts that docs/embedding.md promises.
 */
export const DEFAULT_LOOK: LauncherLook = {
  style: 'circle',
  texts: {
    en: {
      label: 'Ask us',
      open: 'Open chat',
      close: 'Close chat',
      unavailable: 'The chat couldn’t load. Please try again later.',
      title: 'Chat',
      unread: 'new messages',
    },
  },
  accent: '#1f5fe0',
  onAccent: '#ffffff',
  orb: 'var(--a)',
  initials: '',
  light: '#ffffff',
  dark: '#0a0f1c',
  text: '#0d1526',
  textDark: '#e8edf7',
  scheme: 'auto',
  radius: '18px',
};

/** The placeholder as the minifier left it, in whichever quotes it chose (it picks backticks too). */
const QUOTED_PLACEHOLDER = new RegExp(`(['"\`])${LAUNCHER_PLACEHOLDER}\\1`);

/**
 * The loader with the requested bot's launcher look inlined, and no other bot's: widget.js must
 * not list every bot. The default look always comes along under '', for a `data-bot` the server
 * didn't see. The whole quoted placeholder is replaced by a JSON string literal, which is
 * a valid JS string whatever it contains (quotes, backticks, `${`, `$&`), and the replacement is a
 * function so `String.replace` patterns in the values are not interpreted.
 */
export function loaderWithLook(loaderJs: string, bot: Bot | undefined): string {
  const looks = bot ? { [bot.id]: launcherLook(bot), '': DEFAULT_LOOK } : { '': DEFAULT_LOOK };
  const literal = JSON.stringify(JSON.stringify(looks))
    .replaceAll(' ', '\\u2028')
    .replaceAll(' ', '\\u2029');
  return loaderJs.replace(QUOTED_PLACEHOLDER, () => literal);
}
