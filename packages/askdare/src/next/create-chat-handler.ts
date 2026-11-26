// The .js suffix: Next.js has no exports map, so plain Node ESM can't resolve `next/server`.
import { after } from 'next/server.js';
import type { AdminDashboard } from '../admin/dashboard';
import type { AdminStore } from '../admin/port';
import { isBasePath } from '../base-path';
import { type BotHandle, botOf, compactionWarnings } from '../bot/define-bot';
import type { ConversationStore } from '../conversations/port';
import { historyReader } from '../conversations/provider-history';
import { AskdareError, forLog } from '../errors';
import type { ModelGateway } from '../gateway';
import {
  FONT_FILES,
  FONTS_CSS,
  FONTS_CSS_FILE,
  LOADER_JS,
  SKIN_CSS,
  SKIN_CSS_FILE,
  WIDGET_CSS,
  WIDGET_CSS_FILE,
  WIDGET_JS,
  WIDGET_JS_FILE,
} from '../generated/assets';
import { getClientIp, type TrustProxy } from '../limits/client-ip';
import { createLimits } from '../limits/limits';
import { memoryStore, type RateLimitStore } from '../limits/store';
import { openaiConversations } from '../openai/conversations';
import { createOpenAIGateway } from '../openai/gateway';
import type { ErrorCode } from '../protocol/events';
import { memoryTurnLog } from '../resume/memory-turn-log';
import type { TurnEventLog } from '../resume/turn-log';
import { createIdentityVerifier, type IdentityVerifier } from '../security/identity';
import { createTokenService, type TokenService } from '../security/tokens';
import { type AdminWriter, adminWriter } from '../server/admin-records';
import { explain, TROUBLESHOOTING } from '../server/explain';
import type { ChatFeedbackReport } from '../server/feedback-report';
import { createRequestHandler } from '../server/handler';
import { hookError } from '../server/stream-turn';
import { type ChatSweepOptions, type ChatSweepResult, createSweep } from '../server/sweep';
import type { ChatTranscriptReport } from '../server/transcript-report';
import type { ChatUsageReport } from '../server/usage-report';

export interface ChatHandlerOptions {
  readonly bots: readonly BotHandle[];
  /** Path of the catch-all route. Default `/api/chat` (route file `app/api/chat/[...path]/route.ts`). */
  readonly basePath?: string;
  /** Default `process.env.OPENAI_API_KEY`. */
  readonly openaiApiKey?: string;
  /** Token secret, at least 32 characters. Default `process.env.CHAT_SECRET`. */
  readonly secret?: string;
  /** Former secrets still accepted during rotation. Default: comma-separated `process.env.CHAT_SECRET_PREVIOUS`. */
  readonly previousSecrets?: readonly string[];
  /**
   * Secret the site's backend signs identity tokens with, for `askdare('identify')` (ADR-0009).
   * At least 32 random characters, different from `secret`. Default `process.env.IDENTITY_SECRET`;
   * without one, identity is off.
   */
  readonly identitySecret?: string;
  readonly limits?: ChatHandlerLimitsOptions;
  /**
   * Where conversations are stored (ADR-0024). Default `openaiConversations()`: OpenAI keeps them,
   * with no database of yours. Chosen on the server only; the widget never picks it.
   */
  readonly conversations?: ConversationStore;
  /**
   * Resuming an answer after a dropped connection (ADR-0027): each turn writes its events to a
   * log for a few minutes, and a client that lost its stream continues it from there.
   */
  readonly resume?: ChatHandlerResumeOptions;
  /**
   * Called for every server error (status 500 and up), for an error that ends a streamed answer,
   * once a day when a bot-wide or the global budget runs out, and when `onTranscript` throws, for
   * your monitoring, such as Sentry. Defaults to one `console.error` line with a pointer to the
   * troubleshooting guide. Never receives message contents or API keys. May be async; nothing it
   * throws reaches the request.
   */
  readonly onError?: (report: ChatErrorReport) => void | Promise<void>;
  /**
   * Called once per chat turn, after its answer has streamed, including turns that failed: the
   * tokens it used, how long it took, which tools it called. For cost tracking and tracing, e.g.
   * with `@boldare/askdare-otel`. Counters and pseudonyms only, never message text. May be async;
   * nothing it throws reaches the chat.
   */
  readonly onUsage?: (report: ChatUsageReport) => void | Promise<void>;
  /**
   * Called when a visitor rates an answer 👍 or 👎, with an optional comment, or takes a rating
   * back. Without it, answers can't be rated; a bot can opt out with `widget.feedback: false`.
   * askdare stores no ratings: keep them here. May be async; nothing it throws reaches the chat.
   */
  readonly onFeedback?: (report: ChatFeedbackReport) => void | Promise<void>;
  /**
   * Called once per chat turn whose answer finished, after it has streamed, with what the visitor
   * sent (after `onInput`) and the answer they saw (after output checks), to keep your own
   * transcripts. The only hook that receives message content: treat it as personal data. Off
   * unless set. May be async; nothing it throws reaches the chat, and `onError` gets its error's
   * name, never its message.
   */
  readonly onTranscript?: (report: ChatTranscriptReport) => void | Promise<void>;
  /**
   * Serves the state gallery: `/embed/<bot>?gallery=<state>&preset=<preset>&scheme=<scheme>`
   * renders fixture states without calling the model. For development and visual tests; leave
   * it off in production.
   */
  readonly gallery?: boolean;
  /**
   * The admin store and console (ADR-0016, ADR-0032). With `store`, askdare writes each turn's
   * counters, ratings and, with `transcripts`, transcripts there itself, and deleting or sweeping a
   * conversation deletes its records too. `console` turns on the owners' console at
   * `<basePath>/admin`.
   */
  readonly admin?: ChatHandlerAdminOptions;
}

export interface ChatHandlerAdminOptions {
  /** Where admin records live, such as `postgresAdminStore()` from `@boldare/askdare-postgres`. */
  readonly store?: AdminStore;
  /**
   * Also keep each turn's text (the visitor's message and the answer they saw) in the store.
   * Personal data: off by default; needs `store`.
   */
  readonly transcripts?: boolean;
  /** Days records are kept, once the app calls `sweep()` on a schedule. Default 30, at most 400. */
  readonly retentionDays?: number;
  /** The console at `<basePath>/admin`, off unless set. */
  readonly console?: ChatHandlerAdminConsoleOptions;
}

export interface ChatHandlerAdminConsoleOptions {
  /**
   * Users who may sign in with an identity token: the `sub` of a JWT signed with
   * `IDENTITY_SECRET`, audience `askdare:admin`, at most 10 minutes long, passed to the console
   * as `<basePath>/admin#identity=<jwt>`. Without it, only `ADMIN_SECRET` signs in; one of the
   * two is required.
   */
  readonly allow?: readonly string[];
  /** The stage 2 dashboard, such as `adminDashboard()` from `@boldare/askdare-admin`. Needs `store`. */
  readonly dashboard?: AdminDashboard;
}

/** One server error, as `onError` receives it. */
export interface ChatErrorReport {
  /** The stable code the widget also receives, such as `bot_unavailable` or `upstream_error`. */
  readonly code: ErrorCode;
  /** What went wrong, for you: a missing key, a model the project can't use. Never shown to visitors. */
  readonly message: string;
  /** The underlying error, with any API key cut down to its prefix. */
  readonly cause?: unknown;
}

export interface ChatHandlerLimitsOptions {
  /**
   * Counter storage for rate limits and budgets. Defaults to per-process memory, which is weak when
   * several instances serve traffic; use `@boldare/askdare-upstash` there.
   */
  readonly store?: RateLimitStore;
  /** How to read the client IP behind your proxy. Default `auto` (Vercel, otherwise one proxy). */
  readonly trustProxy?: TrustProxy;
  /**
   * Input plus output tokens per UTC day across all bots, with input read from the prompt cache
   * counted as a tenth of a token. Unlimited by default.
   */
  readonly globalDailyTokens?: number;
  /**
   * Refuse to start without a shared `store`, instead of warning in production that limits are
   * per instance (ADR-0019). For example `process.env.NODE_ENV === 'production'`, so development
   * keeps the in-memory store. Default `false`.
   */
  readonly requireSharedStore?: boolean;
}

export interface ChatHandlerResumeOptions {
  /**
   * Where turns keep their events, for the turn timeout plus a minute after the last one. Defaults
   * to `memoryTurnLog()`, per instance: a reconnect that reaches another instance reloads the
   * history instead. With several instances, use a shared log such as `upstashTurnLog()` from
   * `@boldare/askdare-upstash`.
   */
  readonly log?: TurnEventLog;
}

export type RouteHandler = (request: Request) => Promise<Response>;

export interface ChatHandlers {
  readonly GET: RouteHandler;
  readonly POST: RouteHandler;
  readonly DELETE: RouteHandler;
  /**
   * Deletes conversations idle for `idleDays` (with a store that can list them, not OpenAI's),
   * with their files and admin records, then admin records older than `admin.retentionDays`. Call
   * it from your own scheduled route, behind its own secret; askdare schedules nothing.
   */
  readonly sweep: (options?: ChatSweepOptions) => Promise<ChatSweepResult>;
}

export type { ChatSweepOptions, ChatSweepResult };

/** Keeps async work alive after the response on serverless hosts, where there is a request scope. */
function keepAlive(work: Promise<unknown>): void {
  try {
    after(work);
  } catch {
    // No request scope or no platform waitUntil: the work still runs while the process lives.
  }
}

/** Wraps an app's hook so it can't break a request: anything it throws is logged by name only. */
function guard<T>(
  name: string,
  hook: ((value: T) => void | Promise<void>) | undefined,
): ((value: T) => Promise<void>) | undefined {
  if (!hook) return undefined;
  return async (value) => {
    try {
      await hook(value);
    } catch (error) {
      console.error(`[askdare] the ${name} hook failed: ${hookError(error)}`);
    }
  };
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new AskdareError('bot_unavailable', { cause: `${name} is not configured.` });
  }
  return value;
}

/**
 * Creates the Next.js route handlers for askdare. Mount them in a catch-all route:
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
  if (!isBasePath(basePath)) {
    throw new TypeError(`[askdare] basePath must look like /api/chat, got "${basePath}".`);
  }
  const ids = options.bots.map((bot) => bot.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) throw new TypeError(`[askdare] Duplicate bot id "${duplicate}".`);
  if (ids.length === 0) throw new TypeError('[askdare] Define at least one bot.');

  let gateway: ModelGateway | undefined;
  /** null: no IDENTITY_SECRET, so identity is off. */
  let identity: IdentityVerifier | null | undefined;
  let tokens: Promise<TokenService> | undefined;
  const store = options.limits?.store ?? memoryStore();
  if (!store.shared && options.limits?.requireSharedStore === true) {
    throw new TypeError(
      '[askdare] limits.requireSharedStore is on, but limits.store is not shared across instances. Pass a shared store such as @boldare/askdare-upstash.',
    );
  }
  if (!store.shared && process.env['NODE_ENV'] === 'production') {
    console.warn(
      '[askdare] Rate limits are kept in memory, per instance. With more than one instance, use a shared store such as @boldare/askdare-upstash.',
    );
  }
  const turnLog = options.resume?.log ?? memoryTurnLog();
  const conversations =
    options.conversations ??
    openaiConversations(options.openaiApiKey === undefined ? {} : { apiKey: options.openaiApiKey });
  const bots = options.bots.map(botOf);
  for (const warning of compactionWarnings(bots, historyReader(conversations) !== undefined)) {
    console.warn(`[askdare] ${warning}`);
  }
  const adminOptions = options.admin;
  const retentionDays = adminOptions?.retentionDays ?? 30;
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 400) {
    throw new TypeError('[askdare] admin.retentionDays must be a whole number of days, 1 to 400.');
  }
  if (adminOptions?.transcripts === true && !adminOptions.store) {
    throw new TypeError('[askdare] admin.transcripts needs admin.store.');
  }
  const consoleOptions = adminOptions?.console;
  if (consoleOptions?.dashboard && !adminOptions?.store) {
    throw new TypeError('[askdare] admin.console.dashboard needs admin.store.');
  }
  // Whether ADMIN_SECRET or `allow` is set is checked by the console on its first request, like
  // the other secrets, so `next build` never needs it.
  const allow = consoleOptions?.allow ?? [];
  const trustProxy = options.limits?.trustProxy ?? 'auto';
  const development = process.env['NODE_ENV'] === 'development';
  const onError = guard('onError', options.onError);
  const report = (error: AskdareError): void => {
    const explanation = explain(error);
    if (onError) {
      keepAlive(
        onError({
          code: error.code,
          message: explanation ?? error.message,
          cause: error.cause,
        }),
      );
      return;
    }
    const line = `[askdare] ${error.code}: ${explanation ?? error.message} (see ${TROUBLESHOOTING})`;
    if (error.cause === undefined) console.error(line);
    else console.error(line, forLog(error.cause));
  };
  /** A setup mistake (a weak secret) is the operator's to fix, not an internal error. */
  const setupError = (error: unknown): unknown =>
    error instanceof TypeError ? new AskdareError('bot_unavailable', { cause: error }) : error;

  const writer: AdminWriter | undefined = adminOptions?.store
    ? adminWriter(adminOptions.store, {
        transcripts: adminOptions.transcripts === true,
        onError: report,
      })
    : undefined;
  /** ADMIN_SECRET, checked on first use like the other secrets (ADR-0032, decision 8). */
  const adminSecret = (): string | undefined => {
    const secret = process.env['ADMIN_SECRET'];
    if (!secret) return undefined;
    if (secret.length < 32 || new Set(secret).size < 12) {
      throw setupError(
        new TypeError(
          `[askdare] ADMIN_SECRET must be at least 32 random characters. Generate one with: node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`,
        ),
      );
    }
    const others = [
      options.secret ?? process.env['CHAT_SECRET'],
      options.identitySecret ?? process.env['IDENTITY_SECRET'],
    ];
    if (others.includes(secret)) {
      throw setupError(
        new TypeError('[askdare] ADMIN_SECRET must differ from CHAT_SECRET and IDENTITY_SECRET.'),
      );
    }
    return secret;
  };
  const gatewayOf = (): ModelGateway =>
    (gateway ??= createOpenAIGateway({
      apiKey: required(options.openaiApiKey ?? process.env['OPENAI_API_KEY'], 'OPENAI_API_KEY'),
    }));

  const handle = createRequestHandler({
    bots,
    basePath,
    // A turn outlives a visitor who disconnects; on serverless hosts this keeps the function alive.
    waitUntil: keepAlive,
    onUsage: guard('onUsage', options.onUsage),
    onFeedback: guard('onFeedback', options.onFeedback),
    // Not guarded: a failure goes to onError, by its error's name, from inside the turn.
    onTranscript: options.onTranscript,
    assets: {
      loaderJs: LOADER_JS,
      widgetJs: WIDGET_JS,
      widgetCss: WIDGET_CSS,
      widgetJsFile: WIDGET_JS_FILE,
      widgetCssFile: WIDGET_CSS_FILE,
      fontsCss: FONTS_CSS,
      fontsCssFile: FONTS_CSS_FILE,
      fontFiles: FONT_FILES,
      skinCss: SKIN_CSS,
      skinCssFile: SKIN_CSS_FILE,
    },
    gallery: options.gallery,
    development,
    onError: report,
    // In development the chat says what is wrong with the setup; in production, never.
    explain: development ? explain : undefined,
    sharedLimits: store.shared,
    conversations,
    resume: turnLog,
    gateway: gatewayOf,
    admin: adminOptions
      ? {
          writer,
          retentionDays,
          console: consoleOptions
            ? {
                allow,
                dashboard: consoleOptions.dashboard,
                secret: adminSecret,
                // Only when the console is on, so other apps never evaluate its assets.
                assets: () => import('../generated/admin-console'),
              }
            : undefined,
        }
      : undefined,
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
        throw setupError(error);
      });
      return tokens;
    },
    identity: () => {
      if (identity === undefined) {
        const secret = options.identitySecret ?? process.env['IDENTITY_SECRET'];
        try {
          identity = secret
            ? createIdentityVerifier({
                secret,
                chatSecret: options.secret ?? process.env['CHAT_SECRET'],
              })
            : null;
        } catch (error) {
          throw setupError(error);
        }
      }
      return identity ?? undefined;
    },
    limits: createLimits({
      store,
      globalDailyTokens: options.limits?.globalDailyTokens,
      disabled: () => process.env['ASKDARE_DISABLED'] === 'true',
      // The chat stops answering until midnight UTC: the operator should hear about it.
      onExhausted: (message) => report(new AskdareError('budget_exceeded', { message })),
    }),
    clientIp: (request) => getClientIp(request, trustProxy),
  });

  const sweep = createSweep({
    conversations,
    gateway: gatewayOf,
    admin: writer ? { writer, retentionDays } : undefined,
    onError: report,
  });

  return { GET: handle, POST: handle, DELETE: handle, sweep };
}
