import type { Bot } from '../bot/define-bot';
import { ChatdockError } from '../errors';
import type { ModelGateway } from '../gateway';
import {
  LOADER_JS,
  WIDGET_CSS,
  WIDGET_CSS_FILE,
  WIDGET_JS,
  WIDGET_JS_FILE,
} from '../generated/assets';
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

  const handle = createRequestHandler({
    bots: options.bots,
    basePath,
    assets: {
      loaderJs: LOADER_JS,
      widgetJs: WIDGET_JS,
      widgetCss: WIDGET_CSS,
      widgetJsFile: WIDGET_JS_FILE,
      widgetCssFile: WIDGET_CSS_FILE,
    },
    gateway: () =>
      (gateway ??= createOpenAIGateway({
        apiKey: required(options.openaiApiKey ?? process.env['OPENAI_API_KEY'], 'OPENAI_API_KEY'),
      })),
    tokens: () =>
      (tokens ??= (async () =>
        createTokenService({
          secret: required(options.secret ?? process.env['CHAT_SECRET'], 'CHAT_SECRET'),
          previousSecrets:
            options.previousSecrets ??
            (process.env['CHAT_SECRET_PREVIOUS'] ?? '')
              .split(',')
              .map((secret) => secret.trim())
              .filter(Boolean),
        }))()),
  });

  return { GET: handle, POST: handle, DELETE: handle };
}
