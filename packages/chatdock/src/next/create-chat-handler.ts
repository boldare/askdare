// The .js suffix: Next.js has no exports map, so plain Node ESM can't resolve `next/server`.
import { after } from 'next/server.js';
import type { Bot } from '../bot/define-bot';
import { ChatdockError } from '../errors';
import type { ModelGateway } from '../gateway';
import {
  FONT_FILES,
  FONTS_CSS,
  FONTS_CSS_FILE,
  LOADER_JS,
  WIDGET_CSS,
  WIDGET_CSS_FILE,
  WIDGET_JS,
  WIDGET_JS_FILE,
} from '../generated/assets';
import { getClientIp, type TrustProxy } from '../limits/client-ip';
import { createLimits } from '../limits/limits';
import { memoryStore, type RateLimitStore } from '../limits/store';
import { createOpenAIGateway } from '../openai/gateway';
import { createTokenService, type TokenService } from '../security/tokens';
import { createRequestHandler } from '../server/handler';

export interface ChatHandlerOptions {
  readonly bots: readonly Bot[];
  /** Path of the catch-all route. Default `/api/chat` (route file `app/api/chat/[...path]/route.ts`). */
  readonly basePath?: string;
  /** Default `process.env.OPENAI_API_KEY`. */
  readonly openaiApiKey?: string;
  /** Token secret, at least 32 characters. Default `process.env.CHAT_SECRET`. */
  readonly secret?: string;
  /** Former secrets still accepted during rotation. Default: comma-separated `process.env.CHAT_SECRET_PREVIOUS`. */
  readonly previousSecrets?: readonly string[];
  readonly limits?: ChatHandlerLimitsOptions;
  /**
   * Serves the state gallery: `/embed/<bot>?gallery=<state>&preset=<preset>&scheme=<scheme>`
   * renders fixture states without calling the model. For development and visual tests; leave
   * it off in production.
   */
  readonly gallery?: boolean;
}

export interface ChatHandlerLimitsOptions {
  /**
   * Counter storage for rate limits and budgets. Defaults to per-process memory, which is weak when
   * several instances serve traffic; use `@boldare/chatdock-upstash` there.
   */
  readonly store?: RateLimitStore;
  /** How to read the client IP behind your proxy. Default `auto` (Vercel, otherwise one proxy). */
  readonly trustProxy?: TrustProxy;
  /** Input plus output tokens per UTC day across all bots. Unlimited by default. */
  readonly globalDailyTokens?: number;
}

export type RouteHandler = (request: Request) => Promise<Response>;

export interface ChatHandlers {
  readonly GET: RouteHandler;
  readonly POST: RouteHandler;
  readonly DELETE: RouteHandler;
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new ChatdockError('bot_unavailable', { cause: `${name} is not configured.` });
  }
  return value;
}

/**
 * Creates the Next.js route handlers for chatdock. Mount them in a catch-all route:
 *
 * ```ts
 * // app/api/chat/[...path]/route.ts
 * export const maxDuration = 300;
 * export const { GET, POST, DELETE } = createChatHandler({ bots });
 * ```
 *
 * Secrets are read on the first request, so importing the route (for example during
 * `next build`) never requires them.
 */
export function createChatHandler(options: ChatHandlerOptions): ChatHandlers {
  const basePath = options.basePath ?? '/api/chat';
  if (!/^(\/[a-zA-Z0-9._~-]+)+$/.test(basePath)) {
    throw new TypeError(`[chatdock] basePath must look like /api/chat, got "${basePath}".`);
  }
  const ids = options.bots.map((bot) => bot.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) throw new TypeError(`[chatdock] Duplicate bot id "${duplicate}".`);
  if (ids.length === 0) throw new TypeError('[chatdock] Define at least one bot.');

  let gateway: ModelGateway | undefined;
  let tokens: Promise<TokenService> | undefined;
  const store = options.limits?.store ?? memoryStore();
  if (!store.shared && process.env['NODE_ENV'] === 'production') {
    console.warn(
      '[chatdock] Rate limits are kept in memory, per instance. With more than one instance, use a shared store such as @boldare/chatdock-upstash.',
    );
  }
  const trustProxy = options.limits?.trustProxy ?? 'auto';

  const handle = createRequestHandler({
    bots: options.bots,
    basePath,
    // A turn outlives a visitor who disconnects; on serverless hosts this keeps the function alive.
    waitUntil: (work) => {
      try {
        after(work);
      } catch {
        // No request scope or no platform waitUntil: the turn still runs while the process lives.
      }
    },
    assets: {
      loaderJs: LOADER_JS,
      widgetJs: WIDGET_JS,
      widgetCss: WIDGET_CSS,
      widgetJsFile: WIDGET_JS_FILE,
      widgetCssFile: WIDGET_CSS_FILE,
      fontsCss: FONTS_CSS,
      fontsCssFile: FONTS_CSS_FILE,
      fontFiles: FONT_FILES,
    },
    gallery: options.gallery,
    gateway: () =>
      (gateway ??= createOpenAIGateway({
        apiKey: required(options.openaiApiKey ?? process.env['OPENAI_API_KEY'], 'OPENAI_API_KEY'),
      })),
    tokens: () => {
      tokens ??= createTokenService({
        secret: required(options.secret ?? process.env['CHAT_SECRET'], 'CHAT_SECRET'),
        previousSecrets:
          options.previousSecrets ??
          (process.env['CHAT_SECRET_PREVIOUS'] ?? '')
            .split(',')
            .map((secret) => secret.trim())
            .filter(Boolean),
      }).catch((error: unknown) => {
        tokens = undefined; // retry on the next request instead of failing forever
        throw error;
      });
      return tokens;
    },
    limits: createLimits({
      store,
      globalDailyTokens: options.limits?.globalDailyTokens,
      disabled: () => process.env['CHATDOCK_DISABLED'] === 'true',
    }),
    clientIp: (request) => getClientIp(request, trustProxy),
  });

  return { GET: handle, POST: handle, DELETE: handle };
}
