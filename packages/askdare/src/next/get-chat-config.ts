import type { Bot } from '../bot/define-bot';
import type { ChatConfig } from '../chat/config';
// Names only: the stylesheets themselves stay out of the page's server bundle.
import { FONTS_CSS_FILE, SKIN_CSS_FILE } from '../generated/asset-names';
import { canonicalLocale } from '../i18n/texts';
import { themeAsset } from '../server/embed-page';
import { publicConfig } from '../server/public-config';

export interface ChatConfigOptions {
  /** The same bots as in `createChatHandler`. */
  readonly bots: readonly Bot[];
  /** The id of the bot to show. */
  readonly bot: string;
  /** Path of the chat route, the same as in `createChatHandler`. Default `/api/chat`. */
  readonly basePath?: string;
  /**
   * The page's language, for a bot with `locale: 'auto'`; default English. A bot with a fixed
   * locale keeps it.
   */
  readonly locale?: string;
}

/**
 * The public configuration of one bot for `<Root config={…}>` from `@boldare/askdare/react`. Call
 * it in a Server Component and pass the result down: it holds only what browsers may see.
 *
 * ```tsx
 * // app/help/page.tsx
 * const config = getChatConfig({ bots, bot: 'support' });
 * return <Chat config={config} />; // a client component with <Root> and <DefaultChat>
 * ```
 */
export function getChatConfig(options: ChatConfigOptions): ChatConfig {
  const basePath = options.basePath ?? '/api/chat';
  if (!/^(\/[a-zA-Z0-9._~-]+)+$/.test(basePath)) {
    throw new TypeError(`[askdare] basePath must look like /api/chat, got "${basePath}".`);
  }
  const bot = options.bots.find((candidate) => candidate.id === options.bot);
  if (!bot) throw new TypeError(`[askdare] getChatConfig: there is no bot "${options.bot}".`);
  const locale =
    bot.widget.locale === 'auto'
      ? ((options.locale ? canonicalLocale(options.locale) : undefined) ?? 'en')
      : bot.widget.locale;
  const { hash } = themeAsset(bot.widget.theme, bot.widget.css, 'inline');
  return {
    ...publicConfig(bot, basePath, { locale }),
    styles: {
      theme: `${basePath}/theme/${bot.id}.css?scope=inline&v=${hash}`,
      skin: `${basePath}/assets/${SKIN_CSS_FILE}`,
      fonts: `${basePath}/assets/${FONTS_CSS_FILE}`,
    },
  };
}
