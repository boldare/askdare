import type { Bot } from '../bot/define-bot';
import type { ChatConfig } from '../chat/config';
import { embedPermissionsPolicy, frameAncestors } from '../server/embed-page';
import { getChatConfig } from './get-chat-config';

/** A page's search parameters, as Next.js hands them to it or as `URLSearchParams`. */
export type EmbedSearchParams =
  | URLSearchParams
  | Readonly<Record<string, string | readonly string[] | undefined>>;

export interface EmbedConfigOptions {
  /** The same bots as in `createChatHandler`. */
  readonly bots: readonly Bot[];
  /** The id of the bot whose `embedPath` this page is. */
  readonly bot: string;
  /** Path of the chat route, the same as in `createChatHandler`. Default `/api/chat`. */
  readonly basePath?: string;
  /** The page's search parameters: the chat route passes the language and the mode in them. */
  readonly searchParams: EmbedSearchParams;
}

/** What `EmbedRoot` from `@boldare/askdare/embed` needs: public, like `getChatConfig`'s. */
export interface EmbedChatConfig extends ChatConfig {
  /** Origins whose pages may hand the chat its connection to the loader (ADR-0005). */
  readonly allowedOrigins: readonly string[];
  /** `inline` inside an element of the host page, `floating` in the widget's panel. */
  readonly mode: 'floating' | 'inline';
}

const first = (params: EmbedSearchParams, name: string): string | undefined => {
  const value = params instanceof URLSearchParams ? params.get(name) : params[name];
  return (typeof value === 'string' ? value : value?.[0]) ?? undefined;
};

/** The bot with this id, for a page that serves it. */
function embeddedBot(bots: readonly Bot[], id: string, caller: string): Bot {
  const bot = bots.find((candidate) => candidate.id === id);
  if (!bot) throw new TypeError(`[askdare] ${caller}: there is no bot "${id}".`);
  return bot;
}

/**
 * The configuration for the page at a bot's `embedPath` (ADR-0018), read in its Server Component
 * from the language and the mode that the chat route passes in the URL:
 *
 * ```tsx
 * // app/(askdare)/askdare/support/page.tsx
 * const config = getEmbedConfig({ bots, bot: 'support', searchParams: await searchParams });
 * return <Frame config={config} />; // a client component with <EmbedRoot> and <DefaultChat>
 * ```
 */
export function getEmbedConfig(options: EmbedConfigOptions): EmbedChatConfig {
  const bot = embeddedBot(options.bots, options.bot, 'getEmbedConfig');
  const locale = first(options.searchParams, 'lang');
  return {
    ...getChatConfig({
      bots: options.bots,
      bot: options.bot,
      ...(options.basePath === undefined ? {} : { basePath: options.basePath }),
      ...(locale === undefined ? {} : { locale }),
    }),
    allowedOrigins: bot.security.allowedOrigins,
    mode: first(options.searchParams, 'mode') === 'inline' ? 'inline' : 'floating',
  };
}

/** One response header, in the shape of `headers()` in `next.config.ts`. */
export interface EmbedPageHeader {
  readonly key: string;
  readonly value: string;
}

/**
 * The headers the page at a bot's `embedPath` must send, as askdare's own iframe page does
 * (ADR-0018): who may frame it, the microphone only with voice input, and the referrer policy.
 * Set them for the page's path in `next.config.ts`:
 *
 * ```ts
 * async headers() {
 *   return [{ source: '/askdare/support', headers: embedPageHeaders({ bots, bot: 'support' }) }];
 * }
 * ```
 */
export function embedPageHeaders(options: {
  readonly bots: readonly Bot[];
  readonly bot: string;
}): EmbedPageHeader[] {
  const bot = embeddedBot(options.bots, options.bot, 'embedPageHeaders');
  return [
    { key: 'Content-Security-Policy', value: frameAncestors(bot) },
    { key: 'Permissions-Policy', value: embedPermissionsPolicy(bot) },
    { key: 'Referrer-Policy', value: 'strict-origin' },
  ];
}
