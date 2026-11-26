import { z } from 'zod';
import {
  attachmentName,
  countPdfPages,
  detectFile,
  IMAGE_TOKENS,
  PDF_PAGE_TOKENS,
} from '../attachments/files';
import { isInside } from '../base-path';
import { type Bot, offersForms } from '../bot/define-bot';
import { checksOutput } from '../bot/guardrails';
import { type FormOrigin, itemHistory } from '../conversations/history';
import { conversationGone, ownerOf, ownsConversation } from '../conversations/owner';
import type { ConversationStore } from '../conversations/port';
import { type HistoryPosition, historyReader } from '../conversations/provider-history';
import { AskdareError, forLog, toAskdareError } from '../errors';
import type { ChatLeadReport } from '../forms/lead-report';
import type { ModelGateway, RepliesReader, TurnAttachment, UiReader } from '../gateway';
import type { ChatHandoffReport } from '../handoff/report';
import { canonicalLocale } from '../i18n/texts';
import type { Limits } from '../limits/limits';
import type { DoctorCheck, DoctorReport } from '../protocol/doctor';
import type { FeedbackHandle } from '../protocol/events';
import type { HistoryForm } from '../protocol/forms';
import type { HistoryMessage } from '../protocol/history';
import { HISTORY_CURSOR_MAX } from '../protocol/history';
import { formRequestSchema, handoffRequestSchema } from '../protocol/schemas';
import { turnKey } from '../resume/turn-key';
import type { TurnEventLog } from '../resume/turn-log';
import { HUMAN_TOKEN_MAX_LENGTH } from '../security/human-verifier';
import type { IdentityFailure, IdentityVerifier, VerifiedIdentity } from '../security/identity';
import {
  ANSWER_ITEM_ID,
  newVisitorId,
  type ResumeGrant,
  type TokenService,
} from '../security/tokens';
import { PRESET_NAMES, type PresetName } from '../theme/presets';
import { type ColorScheme, type ResolvedTheme, resolveTheme } from '../theme/theme';
import { readToolReplies, readToolUi } from '../tools/define-tool';
import { readSuggestedReplies } from '../tools/suggest-replies';
import { detectAudio, languageHints, maxAudioBytes, worstCaseSeconds } from '../voice/audio';
import { type AdminHandlerConfig, adminStoreChecks, createAdminConsole } from './admin-console';
import {
  documentLanguage,
  type EmbedAssets,
  type EmbedView,
  embedContentSecurityPolicy,
  embedPermissionsPolicy,
  GALLERY_STATES,
  type GalleryState,
  renderEmbedPage,
  themeAsset,
} from './embed-page';
import type { ChatFeedbackReport } from './feedback-report';
import { createHandoffs, type HandoffVisitor } from './handoff';
import {
  assertSameOrigin,
  bearerToken,
  errorResponse,
  jsonResponse,
  NO_STORE,
  readBytes,
  readJson,
} from './http';
import { loaderWithLook } from './launcher';
import { publicConfig } from './public-config';
import { resumeStream } from './resume-stream';
import { hookError, STREAM_HEADERS, streamTurn } from './stream-turn';
import type { ChatTranscriptReport } from './transcript-report';
import type { ChatUsageReport } from './usage-report';

export interface HandlerConfig {
  readonly bots: readonly Bot[];
  /** Path of the catch-all route, without a trailing slash, e.g. `/api/chat`. */
  readonly basePath: string;
  readonly assets: EmbedAssets;
  /** Resolved lazily on first use, so importing the route never needs secrets (e.g. during build). */
  readonly gateway: () => ModelGateway;
  /** Where conversations live (ADR-0024). */
  readonly conversations: ConversationStore;
  readonly tokens: () => Promise<TokenService>;
  readonly limits: Limits;
  /** Best-effort client IP for rate-limit keys. */
  readonly clientIp: (request: Request) => string;
  readonly onError?: ((error: AskdareError) => void) | undefined;
  /** Receives each turn's report once its stream has ended (ADR-0012). */
  readonly onUsage?: ((report: ChatUsageReport) => void | Promise<void>) | undefined;
  /** Receives visitors' ratings of answers; without it, answers can't be rated (ADR-0012). */
  readonly onFeedback?: ((report: ChatFeedbackReport) => void | Promise<void>) | undefined;
  /**
   * Receives each finished turn's text and answer once its stream has ended (ADR-0016). Not
   * wrapped: a failure goes to `onError` by name, from inside the turn.
   */
  readonly onTranscript?: ((report: ChatTranscriptReport) => void | Promise<void>) | undefined;
  /**
   * Receives requests for a person (ADR-0030), awaited with a 10-second deadline; a throw is a
   * failed delivery. Required when a bot turns handoff on.
   */
  readonly onHandoff?: ((report: ChatHandoffReport) => void | Promise<void>) | undefined;
  /**
   * Receives sent forms (ADR-0031), after the response; a throw goes to `onError` by name.
   * Required when a bot offers forms to the model.
   */
  readonly onLead?: ((report: ChatLeadReport) => void | Promise<void>) | undefined;
  /**
   * Development only: a description of a setup error to show in the chat instead of the generic
   * message, such as a missing OPENAI_API_KEY. Never given in production.
   */
  readonly explain?: ((error: AskdareError) => string | undefined) | undefined;
  readonly heartbeatIntervalMs?: number | undefined;
  /**
   * Development and visual tests only: lets `/embed/:bot?gallery=<state>&preset=&scheme=` render
   * fixture states with any preset, without calling the model.
   */
  readonly gallery?: boolean | undefined;
  /** `next dev`: browsers revalidate the loader, so a changed launcher shows on the next reload. */
  readonly development?: boolean | undefined;
  /**
   * Checks identity tokens from the site's backend (IDENTITY_SECRET); undefined turns identity off.
   * Resolved lazily, like the token service.
   */
  readonly identity?: (() => IdentityVerifier | undefined) | undefined;
  /** Whether the limits store is shared across instances; reported by `askdare doctor`. */
  readonly sharedLimits?: boolean | undefined;
  /** Keeps a turn running after its response ends, e.g. Next.js `after`; see `streamTurn`. */
  readonly waitUntil?: ((work: Promise<unknown>) => void) | undefined;
  /**
   * Where turns log their events for `POST /resume` (ADR-0027). Without one, every resume answers
   * `404` and clients reload history.
   */
  readonly resume?: TurnEventLog | undefined;
  /** The admin store and console (ADR-0032); without it, `<basePath>/admin…` answers 404. */
  readonly admin?: AdminHandlerConfig | undefined;
}

export type RequestHandler = (request: Request) => Promise<Response>;

/** Upload metadata travels in headers because the body is the raw file. */
const BOT_HEADER = 'x-askdare-bot';
const FILENAME_HEADER = 'x-askdare-filename';
/** The visitor's likely languages (browser and page), as transcription hints. */
const LANGUAGES_HEADER = 'x-askdare-languages';
/** Transcription is short; this only bounds a stuck upstream call. */
const TRANSCRIPTION_TIMEOUT_MS = 60_000;
/** Bounds a human check with its provider, such as Cloudflare's siteverify. */
const HUMAN_CHECK_TIMEOUT_MS = 10_000;
/** Bounds deleting a conversation, which outlives the request that asked for it. */
const DELETE_TIMEOUT_MS = 60_000;
/** Bounds the conversation store's own checks in `askdare doctor`. */
const DOCTOR_STORE_TIMEOUT_MS = 10_000;
/**
 * How long one passed human check lets a visitor renew sessions (ADR-0023). After it, or for a
 * session that never passed one, the bot asks again.
 */
const HUMAN_CHECK_MAX_AGE_SECONDS = 24 * 60 * 60;

const sessionBody = z.object({
  botId: z.string().max(64),
  resumeToken: z.string().max(4096).optional(),
  /** The previous access token, so a renewal keeps the visitor before they have a conversation. */
  accessToken: z.string().max(8192).optional(),
  /**
   * askdare('identify') from the page: a JWT signed by the site's backend, or null to sign out.
   * Absent: a renewal keeps the identity the previous access token had.
   */
  identityToken: z.string().max(4096).nullable().optional(),
  /** The challenge's token, for a bot with a human check; needed unless this renews a session. */
  humanToken: z.string().max(HUMAN_TOKEN_MAX_LENGTH).optional(),
});

const feedbackBody = z.object({
  botId: z.string().max(64),
  feedback: z.string().min(1).max(4096),
  rating: z.enum(['up', 'down']).nullable(),
  comment: z.string().max(500).optional(),
});

const conversationBody = z.object({
  botId: z.string().max(64),
  resumeToken: z.string().min(1).max(4096),
});

const historyBody = conversationBody.extend({
  /** The `before` of the previous answer, for the next older page; the latest page when absent. */
  before: z.string().min(1).max(HISTORY_CURSOR_MAX).optional(),
});

const resumeBody = conversationBody.extend({
  /** The answer's ID, from its `message.start`. */
  messageId: z.string().min(1).max(128),
  /** The sequence number (the SSE `id:`) of the last event the client received; 0 for none. */
  after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

const messageBody = z.object({
  botId: z.string().max(64),
  text: z.string(),
  /** Handles from POST /attachments; raw OpenAI file IDs fail verification. */
  attachments: z.array(z.string().min(1).max(4096)).max(10).optional(),
  /** askdare('configure', { context }) from the host page: untrusted, like the message itself. */
  context: z.string().max(1000).optional(),
  resumeToken: z.string().max(4096).optional(),
  // The same rule as defineBot's widget.locale: any tag Intl accepts, so letters, digits and dashes.
  locale: z
    .string()
    .max(35)
    .refine((value) => canonicalLocale(value) !== undefined)
    .optional(),
});

/**
 * Whether the current session may use a conversation: anonymous conversations stay open to their
 * visitor, signed-in ones only to the same user (ADR-0009).
 */
function sameOwner(
  grant: Pick<ResumeGrant, 'visitorId' | 'identityKey'>,
  visitorId: string,
  key: string | undefined,
): boolean {
  // A signed-in user's conversation follows them, even when the visitor ID changed (an expired
  // session on a laptop that slept); an anonymous one stays with its visitor.
  return grant.identityKey === undefined
    ? grant.visitorId === visitorId
    : grant.identityKey === key;
}

/** Turns attachment handles into files, rejecting foreign, expired and duplicate handles. */
async function verifyAttachments(
  bot: Bot,
  tokens: TokenService,
  visitorId: string,
  handles: readonly string[],
): Promise<{ attachments: TurnAttachment[]; attachmentTokens: number }> {
  const unique = [...new Set(handles)];
  if (unique.length === 0) return { attachments: [], attachmentTokens: 0 };
  if (!bot.attachments) {
    throw new AskdareError('invalid_input', {
      message: 'This assistant does not accept files.',
      key: 'error.filesNotAccepted',
    });
  }
  if (unique.length > bot.attachments.maxPerMessage) {
    throw new AskdareError('invalid_input', {
      message: `Attach up to ${bot.attachments.maxPerMessage} files per message.`,
      key: 'error.tooManyFiles',
      params: { count: bot.attachments.maxPerMessage },
    });
  }
  const files = new Map<string, TurnAttachment>();
  let attachmentTokens = 0;
  for (const handle of unique) {
    const grant = await tokens.verifyAttachment(handle, bot.id);
    if (grant.visitorId !== visitorId) {
      throw new AskdareError('invalid_input', {
        message: 'An attachment expired or is invalid. Please attach it again.',
        key: 'error.attachmentExpired',
      });
    }
    if (files.has(grant.fileId)) continue;
    files.set(grant.fileId, { fileId: grant.fileId, kind: grant.kind });
    attachmentTokens += grant.tokens;
  }
  return { attachments: [...files.values()], attachmentTokens };
}

/**
 * Reads the latest answer's options back from its turn's calls: those a tool defined win over
 * those the model suggested, as in a live turn (ADR-0015). None for a bot that has neither.
 */
function repliesReader(bot: Bot): RepliesReader | undefined {
  const defined = bot.tools.some((tool) => tool.replies);
  const suggested = bot.widget.replies === 'suggest';
  if (!defined && !suggested) return undefined;
  return (calls) =>
    (defined ? readToolReplies(bot.tools, calls) : undefined) ??
    (suggested ? readSuggestedReplies(calls) : undefined);
}

/** Reads each answer's UI payloads back from its turn's calls (ADR-0017); none without `ui`. */
function uiReader(bot: Bot): UiReader | undefined {
  if (!bot.tools.some((tool) => tool.ui)) return undefined;
  return (calls) =>
    readToolUi(bot.tools, calls, (tool) =>
      console.error(`[askdare] ui of tool "${tool.name}" failed while reading the history.`),
    );
}

/**
 * Framework-agnostic request handler behind `createChatHandler`. Serves the loader, the iframe
 * document and its assets, and the JSON/SSE API used by the iframe app (same-origin, no CORS).
 */
export function createRequestHandler(config: HandlerConfig): RequestHandler {
  const bots = new Map(config.bots.map((bot) => [bot.id, bot]));
  for (const bot of config.bots) {
    // The iframe would be sent back into the route, or to one of its own answers.
    if (bot.embedPath !== undefined && isInside(bot.embedPath, config.basePath)) {
      throw new TypeError(
        `[askdare] Bot "${bot.id}": embedPath must be a page outside ${config.basePath}, got "${bot.embedPath}".`,
      );
    }
  }
  for (const bot of config.bots) {
    // A request nobody receives would tell the visitor it was sent (ADR-0030, ADR-0031).
    if (bot.handoff && !config.onHandoff) {
      throw new TypeError(
        `[askdare] Bot "${bot.id}" turns handoff on, but createChatHandler has no onHandoff. Pass one, such as webhookHandoff() or emailHandoff().`,
      );
    }
    if (offersForms(bot) && !config.onLead) {
      throw new TypeError(
        `[askdare] Bot "${bot.id}" offers forms to the model, but createChatHandler has no onLead to receive them.`,
      );
    }
  }
  const report =
    config.onError ??
    ((error: AskdareError) => console.error(`[askdare] ${error.code}`, forLog(error.cause)));

  const findBot = (botId: string): Bot => {
    const bot = bots.get(botId);
    if (!bot) throw new AskdareError('not_found');
    return bot;
  };

  /** One loader per bot, with only that bot's launcher look (`widget.js?bot=<id>`). */
  const loaders = new Map<string, string>();
  const serveLoader = (query: URLSearchParams): Response => {
    const bot = bots.get(query.get('bot') ?? '');
    const key = bot?.id ?? '';
    let loaderJs = loaders.get(key);
    if (loaderJs === undefined) {
      loaderJs = loaderWithLook(config.assets.loaderJs, bot);
      loaders.set(key, loaderJs);
    }
    return new Response(loaderJs, {
      headers: {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': config.development
          ? 'no-cache'
          : 'public, max-age=300, stale-while-revalidate=86400',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  };

  /**
   * The visitor's language for a bot set to `auto`: their page's `lang` (sent by the loader),
   * else their browser's first language, else English.
   */
  const localeFor = (bot: Bot, query: URLSearchParams, request: Request): string => {
    if (bot.widget.locale !== 'auto') return bot.widget.locale;
    const candidates = [
      query.get('lang'),
      (request.headers.get('accept-language') ?? '').split(',')[0]?.split(';')[0]?.trim(),
    ];
    for (const tag of candidates) {
      const canonical = tag ? canonicalLocale(tag) : undefined;
      if (canonical) return canonical;
    }
    return 'en';
  };

  /** The bot's theme, or in gallery mode the preset and scheme asked for in the query. */
  const viewFor = (bot: Bot, query: URLSearchParams, request: Request): EmbedView => {
    let theme: ResolvedTheme = bot.widget.theme;
    let gallery: GalleryState | undefined;
    const overrides = new URLSearchParams();
    if (config.gallery) {
      const state = query.get('gallery');
      if (GALLERY_STATES.includes(state as GalleryState)) gallery = state as GalleryState;
      const preset = query.get('preset');
      const scheme = query.get('scheme');
      const colorScheme = (['auto', 'light', 'dark'] as const).includes(scheme as ColorScheme)
        ? (scheme as ColorScheme)
        : theme.colorScheme;
      if (PRESET_NAMES.includes(preset as PresetName)) {
        theme = resolveTheme(preset as PresetName, colorScheme);
        overrides.set('preset', preset as string);
      } else if (colorScheme !== theme.colorScheme) {
        theme = { ...theme, colorScheme };
      }
      if (colorScheme !== bot.widget.theme.colorScheme) overrides.set('scheme', colorScheme);
    }
    overrides.set('v', themeAsset(theme, bot.widget.css).hash);
    return {
      locale: localeFor(bot, query, request),
      theme,
      gallery,
      themeHref: `${config.basePath}/theme/${bot.id}.css?${overrides}`,
      feedback: feedbackOn(bot),
    };
  };

  const serveTheme = (botId: string, query: URLSearchParams, request: Request): Response => {
    const bot = findBot(botId);
    // `scope=inline`: the bot's own theme for a chat inside a page (ADR-0011).
    const { css, hash } =
      query.get('scope') === 'inline'
        ? themeAsset(bot.widget.theme, bot.widget.css, bot.id)
        : themeAsset(viewFor(bot, query, request).theme, bot.widget.css);
    return new Response(css, {
      headers: {
        'Content-Type': 'text/css; charset=utf-8',
        // The URL carries the content hash; a stale or missing one gets a short cache.
        'Cache-Control':
          query.get('v') === hash ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  };

  /**
   * The bot's public configuration in one language (ADR-0014, step 2), so a chat can switch its
   * language without reloading. Built by `publicConfig`, like the iframe's, so it carries no
   * secrets. A fixed locale ignores `lang`; an invalid `lang` is refused.
   */
  const serveConfig = (botId: string, query: URLSearchParams, request: Request): Response => {
    const bot = findBot(botId);
    const lang = query.get('lang');
    if (lang !== null && canonicalLocale(lang) === undefined) {
      throw new AskdareError('invalid_input', { message: 'lang must be a BCP 47 tag.' });
    }
    const locale = localeFor(bot, query, request);
    const body = publicConfig(bot, config.basePath, { locale, feedback: feedbackOn(bot) });
    // Without `lang`, a bot set to auto answers in the browser's language.
    const byBrowser = bot.widget.locale === 'auto' && lang === null;
    return jsonResponse(body, 200, {
      // The language the texts are written in, for the chat document's `lang`.
      'Content-Language': documentLanguage(bot, locale),
      'Cache-Control': config.development ? 'no-cache' : 'public, max-age=300',
      ...(byBrowser ? { Vary: 'Accept-Language' } : {}),
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
    });
  };

  const serveEmbed = (botId: string, query: URLSearchParams, request: Request): Response => {
    const bot = findBot(botId);
    // The site's own page (ADR-0018), with the visitor's language and the mode, nothing else. The
    // gallery keeps askdare's page, whose fixtures it renders.
    if (bot.embedPath !== undefined && !(config.gallery && query.has('gallery'))) {
      const forward = new URLSearchParams();
      if (bot.widget.locale === 'auto') forward.set('lang', localeFor(bot, query, request));
      if (query.get('mode') === 'inline') forward.set('mode', 'inline');
      const search = forward.toString();
      return new Response(null, {
        status: 302,
        headers: {
          Location: search ? `${bot.embedPath}?${search}` : bot.embedPath,
          'Referrer-Policy': 'strict-origin',
          ...NO_STORE,
        },
      });
    }
    const page = renderEmbedPage(bot, config.basePath, config.assets, viewFor(bot, query, request));
    return new Response(page, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': embedContentSecurityPolicy(bot),
        'Permissions-Policy': embedPermissionsPolicy(bot),
        'Referrer-Policy': 'strict-origin',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'X-Content-Type-Options': 'nosniff',
        ...NO_STORE,
      },
    });
  };

  const fonts = new Map<string, Uint8Array>();
  const fontFile = (file: string): Uint8Array | undefined => {
    const encoded = Object.hasOwn(config.assets.fontFiles, file)
      ? config.assets.fontFiles[file]
      : undefined;
    if (encoded === undefined) return undefined;
    let bytes = fonts.get(file);
    if (!bytes) {
      bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
      fonts.set(file, bytes);
    }
    return bytes;
  };

  const serveAsset = (file: string): Response => {
    const { assets } = config;
    const font = fontFile(file);
    const body: { content: string | Uint8Array; type: string } | undefined = font
      ? { content: font, type: 'font/woff2' }
      : file === assets.widgetJsFile
        ? { content: assets.widgetJs, type: 'text/javascript; charset=utf-8' }
        : file === assets.widgetCssFile
          ? { content: assets.widgetCss, type: 'text/css; charset=utf-8' }
          : file === assets.fontsCssFile
            ? { content: assets.fontsCss, type: 'text/css; charset=utf-8' }
            : file === assets.skinCssFile
              ? { content: assets.skinCss, type: 'text/css; charset=utf-8' }
              : undefined;
    if (!body) throw new AskdareError('not_found');
    return new Response(body.content, {
      headers: {
        'Content-Type': body.type,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  };

  /** Whether visitors may rate this bot's answers. */
  const adminWriter = config.admin?.writer;
  const feedbackOn = (bot: Bot): boolean =>
    (config.onFeedback !== undefined || adminWriter !== undefined) && bot.widget.feedback;

  /** A conversation's latest history page, for history and a handoff's transcript. */
  const latestHistory = (bot: Bot, conversationId: string, signal?: AbortSignal) => {
    const read = historyReader(config.conversations) ?? itemHistory(config.conversations);
    return read(conversationId, {
      signal,
      replies: repliesReader(bot),
      ui: uiReader(bot),
      checked: checksOutput(bot.guardrails),
      knowledge: bot.knowledge?.index,
    });
  };

  const handoffs = createHandoffs({
    limits: config.limits,
    conversations: config.conversations,
    onHandoff: config.onHandoff,
    onLead: config.onLead,
    onError: report,
    waitUntil: config.waitUntil,
    admin: adminWriter,
    transcript: async (bot, conversationId) =>
      (
        await latestHistory(bot, conversationId, AbortSignal.timeout(DELETE_TIMEOUT_MS))
      ).messages.map(({ role, text }) => ({ role, text })),
  });

  /** The bot's own language, for requests that don't carry the visitor's. */
  const botLocale = (bot: Bot): string => (bot.widget.locale === 'auto' ? 'en' : bot.widget.locale);

  /** The rating handle of one answer, bound to the session that may rate it. */
  const feedbackHandle = async (
    tokens: TokenService,
    bot: Bot,
    owner: { readonly visitorId: string; readonly key: string | undefined },
    conversationId: string,
    itemId: string,
  ): Promise<FeedbackHandle> => ({
    handle: (
      await tokens.issueFeedback(bot.id, {
        visitorId: owner.visitorId,
        conversationId,
        itemId,
        identityKey: owner.key,
      })
    ).token,
    // Stable across reloads, so the widget can show the visitor's own rating again.
    key: (await tokens.pseudonym(`answer:${itemId}`)).slice(0, 32),
  });

  /** With identity off (no IDENTITY_SECRET), identities in older access tokens no longer count. */
  const keyed = <Grant extends { identity?: VerifiedIdentity | undefined }>(grant: Grant): Grant =>
    config.identity?.() ? grant : { ...grant, identity: undefined };
  const keyOf = (bot: Bot, identity: VerifiedIdentity): Promise<string | undefined> =>
    config.identity?.()?.key(bot.id, identity.identity) ?? Promise.resolve(undefined);

  /** Throws unless the token passes the bot's human check (ADR-0019); fails closed. */
  const checkHuman = async (
    bot: Bot,
    token: string | undefined,
    signal: AbortSignal,
  ): Promise<void> => {
    const verifier = bot.security.humanVerifier;
    if (!verifier) return;
    let passed = false;
    if (token) {
      try {
        passed = await verifier.verify(token, {
          botId: bot.id,
          signal: AbortSignal.any([signal, AbortSignal.timeout(HUMAN_CHECK_TIMEOUT_MS)]),
        });
      } catch (error) {
        throw error instanceof AskdareError
          ? error
          : new AskdareError('upstream_error', { cause: error });
      }
    }
    if (passed !== true) {
      throw new AskdareError('unauthorized', {
        message: 'We couldn’t confirm you’re human. Please try again.',
        key: 'error.humanCheck',
      });
    }
  };

  const createSession = async (request: Request): Promise<Response> => {
    assertSameOrigin(request);
    const body = await readJson(request, sessionBody);
    const bot = findBot(body.botId);
    const tokens = await config.tokens();
    let returningVisitorId: string | undefined;
    let resume: ResumeGrant | undefined;
    if (body.resumeToken) {
      try {
        resume = await tokens.verifyResume(body.resumeToken, bot.id);
        returningVisitorId = resume.visitorId;
      } catch {
        // A stale or forged handle just starts a fresh visitor.
      }
    }
    let identity: VerifiedIdentity | undefined;
    /** When the session being renewed passed the human check, for a bot with one. */
    let humanCheckedAt: number | undefined;
    if (body.accessToken) {
      try {
        const renewal = await tokens.verifyRenewal(body.accessToken, bot.id);
        humanCheckedAt = renewal.humanCheckedAt;
        returningVisitorId ??= renewal.visitorId;
        if (renewal.visitorId === returningVisitorId) identity = renewal.identity;
      } catch {
        // Too old or forged: start a fresh visitor.
      }
    }
    // identify(): a new identity replaces the old one; null signs out.
    let identityProblem: IdentityFailure | 'disabled' | undefined;
    if (body.identityToken !== undefined) {
      identity = undefined;
      if (body.identityToken !== null) {
        const verifier = config.identity?.();
        const result = verifier
          ? await verifier.verify(body.identityToken, bot.id)
          : ({ ok: false, reason: 'disabled' } as const);
        if (result.ok) identity = result.verified;
        else identityProblem = result.reason;
      }
    }
    if (!config.identity?.()) identity = undefined;
    const key = identity ? await keyOf(bot, identity) : undefined;
    // A conversation started while signed in belongs to that user (ADR-0009).
    const resumable = resume !== undefined && sameOwner(resume, resume.visitorId, key);
    // Renewals by returning visitors count per visitor, so people behind one NAT don't lock each other out.
    await config.limits.checkSession(bot, {
      clientIp: config.clientIp(request),
      returningVisitorId,
    });
    // After the limits, so a flood of sessions doesn't become a flood of checks upstream. A renewal
    // skips it only while the check it carries is recent; a token without one (issued before the
    // bot turned the check on) counts as unchecked.
    if (bot.security.humanVerifier) {
      const now = Math.floor(Date.now() / 1000);
      const recent =
        humanCheckedAt !== undefined &&
        humanCheckedAt <= now + 60 &&
        now - humanCheckedAt <= HUMAN_CHECK_MAX_AGE_SECONDS;
      if (!recent) {
        await checkHuman(bot, body.humanToken, request.signal);
        humanCheckedAt = now;
      }
    } else {
      humanCheckedAt = undefined; // bots without a check issue the same tokens as before
    }
    const visitorId = returningVisitorId ?? newVisitorId();
    const access = await tokens.issueAccess(bot.id, visitorId, identity, humanCheckedAt);
    // Signing in during an anonymous conversation adopts it: from now on only this user may resume
    // it, so it doesn't stay readable on the browser after sign-out.
    const adopted =
      resume && resumable && key && resume.identityKey === undefined
        ? (await tokens.issueResume(bot.id, { ...resume, identityKey: key })).token
        : undefined;
    return jsonResponse({
      accessToken: access.token,
      expiresAt: access.expiresAt,
      resumable,
      ...(adopted ? { resumeToken: adopted } : {}),
      identified: identity !== undefined,
      // Which user's conversation this browser should show: an HMAC, it says nothing about them.
      ...(key ? { identityKey: key } : {}),
      // Why identify() was refused, for the site's developers (never set otherwise).
      ...(identityProblem ? { identityProblem } : {}),
    });
  };

  const sendMessage = async (request: Request): Promise<Response> => {
    assertSameOrigin(request);
    const body = await readJson(request, messageBody);
    const bot = findBot(body.botId);
    const tokens = await config.tokens();
    const { visitorId, identity } = keyed(await tokens.verifyAccess(bearerToken(request), bot.id));
    const key = identity ? await keyOf(bot, identity) : undefined;
    let grant: ResumeGrant | undefined;
    if (body.resumeToken) {
      grant = await tokens.verifyResume(body.resumeToken, bot.id);
      if (!sameOwner(grant, visitorId, key)) {
        throw new AskdareError('not_found');
      }
    }
    const conversationId = grant?.conversationId;
    const { attachments, attachmentTokens } = await verifyAttachments(
      bot,
      tokens,
      visitorId,
      body.attachments ?? [],
    );
    const text = body.text.trim();
    if ((text.length === 0 && attachments.length === 0) || text.length > bot.limits.maxInputChars) {
      throw new AskdareError('invalid_input', {
        message: `Messages must be between 1 and ${bot.limits.maxInputChars} characters.`,
        key: 'error.messageLength',
        params: { max: bot.limits.maxInputChars },
      });
    }
    const context = {
      locale: body.locale ?? (bot.widget.locale === 'auto' ? 'en' : bot.widget.locale),
      identity: identity?.identity,
    };
    // Only for bots that opted in; others never pass it on.
    const pageContext = bot.pageContext ? body.context?.trim() || undefined : undefined;
    // Before reserving: a missing key must not leave a reservation behind on every attempt.
    const gateway = config.gateway();
    const reservation = await config.limits.beginTurn(bot, {
      clientIp: config.clientIp(request),
      visitorId,
      conversationId,
      inputChars: text.length + bot.instructions(context).length + (pageContext?.length ?? 0),
      attachmentTokens,
    });
    const resumed = grant;
    const stream = streamTurn({
      gateway,
      conversations: config.conversations,
      owner: ownerOf(visitorId, key),
      // The store's record must agree with the token (ADR-0024): checked when the turn starts.
      owns: resumed ? (info) => ownsConversation(info, bot.id, resumed) : undefined,
      pseudonym: (value) => tokens.pseudonym(value),
      bot,
      text,
      attachments,
      pageContext,
      context,
      visitorId,
      conversationId,
      signal: request.signal,
      issueResumeToken: async (id) =>
        (await tokens.issueResume(bot.id, { visitorId, conversationId: id, identityKey: key }))
          .token,
      settle: (usage, id, history) => {
        reservation
          .settle(usage, id, history)
          .catch((error: unknown) => report(toAskdareError(error)));
      },
      report: config.onUsage,
      transcript: config.onTranscript,
      record: adminWriter ? (turn) => adminWriter.turn(bot, 'chat', turn) : undefined,
      recordText: adminWriter?.transcripts,
      issueFeedback: feedbackOn(bot)
        ? (id, itemId) => feedbackHandle(tokens, bot, { visitorId, key }, id, itemId)
        : undefined,
      actions:
        bot.handoff?.model || offersForms(bot)
          ? async (id) => {
              const visitor: HandoffVisitor = {
                visitorId,
                key,
                identity: identity?.identity,
                locale: context.locale,
                clientIp: config.clientIp(request),
              };
              return {
                handoff: await handoffs.forTurn(tokens, bot, visitor, id),
                showForm: offersForms(bot)
                  ? (name, callId) => handoffs.showForm(tokens, bot, visitor, id, name, callId)
                  : undefined,
              };
            }
          : undefined,
      reserveCall: () => reservation.extend(),
      reserveCompaction: (inputTokens) => reservation.compaction(inputTokens),
      lockConversation: checksOutput(bot.guardrails)
        ? (id) => config.limits.lockConversation(bot, id)
        : undefined,
      onError: report,
      explain: config.explain,
      heartbeatIntervalMs: config.heartbeatIntervalMs,
      waitUntil: config.waitUntil,
      resume: config.resume,
    });
    return new Response(stream, { headers: STREAM_HEADERS });
  };

  /**
   * Stores one file for the visitor's next message. The body is the raw file; its type is detected
   * from its bytes. Returns an encrypted handle, so the client never learns the OpenAI file ID.
   */
  const uploadAttachment = async (request: Request): Promise<Response> => {
    assertSameOrigin(request);
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('application/octet-stream')) {
      throw new AskdareError('invalid_input', {
        message: 'Expected an application/octet-stream body.',
      });
    }
    const bot = findBot(request.headers.get(BOT_HEADER) ?? '');
    const allowed = bot.attachments;
    if (!allowed) {
      throw new AskdareError('invalid_input', {
        message: 'This assistant does not accept files.',
        key: 'error.filesNotAccepted',
      });
    }
    const tokens = await config.tokens();
    const { visitorId } = await tokens.verifyAccess(bearerToken(request), bot.id);
    await config.limits.checkUpload(bot, { clientIp: config.clientIp(request), visitorId });
    const megabytes = Math.floor((allowed.maxBytes / 1_000_000) * 10) / 10;
    const bytes = await readBytes(request, allowed.maxBytes, {
      message: `Files can be up to ${megabytes} MB.`,
      key: 'error.fileTooLarge',
      params: { size: `${megabytes} MB` },
    });
    const file = detectFile(bytes);
    if (
      !file ||
      (file.kind === 'image' && !allowed.images) ||
      (file.kind === 'pdf' && !allowed.pdf)
    ) {
      const types = [
        allowed.images ? 'images (PNG, JPEG, WebP, GIF)' : '',
        allowed.pdf ? 'PDF' : '',
      ]
        .filter(Boolean)
        .join(' or ');
      throw new AskdareError('invalid_input', {
        message: `Only ${types} files are supported.`,
        key:
          allowed.images && allowed.pdf
            ? 'error.fileType.both'
            : allowed.images
              ? 'error.fileType.images'
              : 'error.fileType.pdf',
      });
    }
    let cost = IMAGE_TOKENS;
    if (file.kind === 'pdf') {
      const pages = await countPdfPages(bytes);
      if (pages !== undefined && pages > allowed.maxPdfPages) {
        throw new AskdareError('invalid_input', {
          message: `PDFs can have up to ${allowed.maxPdfPages} pages.`,
          key: 'error.pdfPages',
          params: { max: allowed.maxPdfPages },
        });
      }
      // A PDF that hides its structure is charged as if it had the most pages allowed.
      cost = (pages ?? allowed.maxPdfPages) * PDF_PAGE_TOKENS;
    }
    const name = attachmentName(request.headers.get(FILENAME_HEADER), file);
    const fileId = await config.gateway().uploadFile({
      bytes,
      filename: name,
      mime: file.mime,
      signal: request.signal,
    });
    const handle = await tokens.issueAttachment(bot.id, {
      visitorId,
      fileId,
      kind: file.kind,
      tokens: cost,
    });
    return jsonResponse({
      attachment: { id: handle.token, kind: file.kind, name, size: bytes.byteLength },
    });
  };

  /**
   * Transcribes one dictation into text for the visitor to check and send. The body is the raw
   * recording. Speech is billed by duration, so seconds are reserved first and settled with what
   * OpenAI reports; the call is not tied to the visitor's connection, so it always settles.
   */
  const transcribe = async (request: Request): Promise<Response> => {
    assertSameOrigin(request);
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('application/octet-stream')) {
      throw new AskdareError('invalid_input', {
        message: 'Expected an application/octet-stream body.',
      });
    }
    const bot = findBot(request.headers.get(BOT_HEADER) ?? '');
    const { voice } = bot;
    if (!voice) {
      throw new AskdareError('invalid_input', {
        message: 'This assistant does not accept voice input.',
        key: 'error.voiceNotAccepted',
      });
    }
    const tokens = await config.tokens();
    const { visitorId } = await tokens.verifyAccess(bearerToken(request), bot.id);
    const reservation = await config.limits.beginTranscription(bot, {
      clientIp: config.clientIp(request),
      visitorId,
    });
    let bytes: Uint8Array;
    let audio: ReturnType<typeof detectAudio>;
    try {
      bytes = await readBytes(request, maxAudioBytes(voice.maxSeconds), {
        message: 'This recording is too long.',
        key: 'error.recordingTooLong',
      });
      audio = detectAudio(bytes);
      if (!audio) {
        throw new AskdareError('invalid_input', {
          message: 'This recording format is not supported.',
          key: 'error.recordingFormat',
        });
      }
    } catch (error) {
      // Refused before reaching OpenAI: nothing was billed.
      await reservation.settle(0).catch((settleError: unknown) => {
        report(toAskdareError(settleError));
      });
      throw error;
    }
    // Without a billed duration (token-billed models, or a timeout OpenAI may still bill), charge
    // the longest audio the file could hold rather than the length the client meant to send.
    const worstCase = worstCaseSeconds(bytes.byteLength, voice.maxSeconds);
    // An error answer from OpenAI is not billed; a timeout leaves the outcome unknown.
    let billed = 0;
    try {
      const result = await config.gateway().transcribe({
        bytes,
        filename: `speech.${audio.extension}`,
        mime: audio.mime,
        model: voice.model,
        languages: languageHints(request.headers.get(LANGUAGES_HEADER)),
        signal: AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS),
      });
      billed = result.seconds ?? worstCase;
      return jsonResponse({ text: result.text.trim() });
    } catch (error) {
      if (toAskdareError(error).code === 'timeout') billed = worstCase;
      throw error;
    } finally {
      await reservation.settle(billed).catch((error: unknown) => report(toAskdareError(error)));
    }
  };

  /**
   * Authenticates the visitor and proves they own the conversation behind the resume token, then
   * applies the endpoint's rate limit (history reads and deletions by default).
   */
  const ownedConversation = async <Body extends z.infer<typeof conversationBody>>(
    request: Request,
    schema: z.ZodType<Body>,
    limit: (bot: Bot, visitorId: string) => Promise<void> = (bot, visitorId) =>
      config.limits.checkConversationAccess(bot, visitorId),
  ): Promise<{
    body: Body;
    bot: Bot;
    conversationId: string;
    grant: ResumeGrant;
    tokens: TokenService;
    owner: { readonly visitorId: string; readonly key: string | undefined };
  }> => {
    assertSameOrigin(request);
    const body = await readJson(request, schema);
    const bot = findBot(body.botId);
    const tokens = await config.tokens();
    const { visitorId, identity } = keyed(await tokens.verifyAccess(bearerToken(request), bot.id));
    const grant = await tokens.verifyResume(body.resumeToken, bot.id);
    const key = identity ? await keyOf(bot, identity) : undefined;
    if (!sameOwner(grant, visitorId, key)) {
      throw new AskdareError('not_found');
    }
    await limit(bot, visitorId);
    return {
      body,
      bot,
      conversationId: grant.conversationId,
      grant,
      tokens,
      owner: { visitorId, key },
    };
  };

  const readHistory = async (request: Request): Promise<Response> => {
    const { body, bot, conversationId, grant, tokens, owner } = await ownedConversation(
      request,
      historyBody,
    );
    // The cursor names a place in this conversation only: one from another conversation, even
    // the same visitor's, is refused before anything is read.
    let before: HistoryPosition | undefined;
    if (body.before !== undefined) {
      const cursor = await tokens.verifyHistoryCursor(body.before, bot.id);
      if (cursor.conversationId !== conversationId) {
        throw new AskdareError('invalid_input', {
          message: 'The history cursor is invalid. Load the history again.',
          key: 'error.history',
        });
      }
      before = { before: cursor.before, skip: cursor.skip };
    }
    // A provider store reads its own items; an item store's are read as stored.
    const read = historyReader(config.conversations) ?? itemHistory(config.conversations);
    // Side by side: the store's record decides whether the history read is returned at all.
    const [info, history] = await Promise.all([
      config.conversations.info(conversationId, request.signal),
      read(conversationId, {
        signal: request.signal,
        before,
        replies: repliesReader(bot),
        ui: uiReader(bot),
        checked: checksOutput(bot.guardrails),
        knowledge: bot.knowledge?.index,
      }),
    ]);
    if (!ownsConversation(info, bot.id, grant)) throw conversationGone();
    let messages = await withFormHandles(
      tokens,
      bot,
      visitorOf(owner, request, botLocale(bot)),
      conversationId,
      history.messages,
      history.origins,
    );
    if (feedbackOn(bot)) {
      // The same answers as the stream rated: never one a guardrail replaced (ADR-0022).
      const rated = new Set(history.rated);
      messages = await Promise.all(
        messages.map(async (message) =>
          message.role === 'assistant' && rated.has(message.id) && ANSWER_ITEM_ID.test(message.id)
            ? {
                ...message,
                feedback: await feedbackHandle(tokens, bot, owner, conversationId, message.id),
              }
            : message,
        ),
      );
    }
    const next =
      history.next &&
      (await tokens.issueHistoryCursor(bot.id, { conversationId, ...history.next })).token;
    return jsonResponse(next ? { messages, before: next } : { messages });
  };

  /**
   * The rest of an answer whose stream dropped (ADR-0027): the events after `after`, then the live
   * ones. The turn is found from the conversation in the resume token, never from the request
   * alone, so a visitor reaches only their own answers. An unknown, expired or foreign turn, and a
   * conversation the store no longer has for them, all answer `404` alike: the client reloads
   * history.
   */
  const resumeAnswer = async (request: Request): Promise<Response> => {
    const { body, bot, conversationId, grant, tokens, owner } = await ownedConversation(
      request,
      resumeBody,
      (owner, visitorId) => config.limits.checkResume(owner, visitorId),
    );
    const log = config.resume;
    if (!log) throw new AskdareError('not_found');
    const turnId = await turnKey(
      (value) => tokens.pseudonym(value),
      bot.id,
      conversationId,
      body.messageId,
    );
    // From the event the client saw last, to tell whether it already had the end.
    const [info, known] = await Promise.all([
      config.conversations.info(conversationId, request.signal),
      log.read(turnId, Math.max(0, body.after - 1), request.signal).catch((error: unknown) => {
        // The name only: a log's error may quote what it holds, which is answer text.
        throw new AskdareError('internal_error', {
          message: 'The turn log could not be read.',
          cause: hookError(error),
        });
      }),
    ]);
    if (!ownsConversation(info, bot.id, grant) || known === undefined) {
      throw new AskdareError('not_found');
    }
    // The handles the turn logged name whoever started it: a visitor who signed in since gets
    // their own, as `sendMessage` would issue it now.
    const { token: resumeToken } = await tokens.issueResume(bot.id, {
      visitorId: owner.visitorId,
      conversationId,
      identityKey: owner.key,
    });
    const stream = resumeStream({
      log,
      turnId,
      after: body.after,
      known,
      resumeToken,
      maxDurationMs: bot.limits.turnTimeoutMs,
      signal: request.signal,
      heartbeatIntervalMs: config.heartbeatIntervalMs,
    });
    return new Response(stream, { headers: STREAM_HEADERS });
  };

  /**
   * A visitor's rating of one answer, handed to `onFeedback` after the response. The handle must
   * belong to the same visitor, or the same signed-in user, as the session.
   */
  const submitFeedback = async (request: Request): Promise<Response> => {
    assertSameOrigin(request);
    const body = await readJson(request, feedbackBody);
    const bot = findBot(body.botId);
    const onFeedback = config.onFeedback;
    if (!feedbackOn(bot)) throw new AskdareError('not_found');
    const tokens = await config.tokens();
    const { visitorId, identity } = keyed(await tokens.verifyAccess(bearerToken(request), bot.id));
    const key = identity ? await keyOf(bot, identity) : undefined;
    const grant = await tokens.verifyFeedback(body.feedback, bot.id);
    if (!sameOwner(grant, visitorId, key)) throw new AskdareError('not_found');
    await config.limits.checkFeedback(bot, visitorId);
    const comment = body.comment?.trim();
    const at = Date.now();
    const work = (async () => {
      const visitor = await tokens.pseudonym(identity ? `user:${identity.identity.id}` : visitorId);
      const withComment = comment && body.rating !== null ? { comment } : {};
      await Promise.all([
        onFeedback?.({
          bot: bot.id,
          rating: body.rating,
          ...withComment,
          visitor,
          ...(identity ? { identity: identity.identity } : {}),
          conversationId: grant.conversationId,
          itemId: grant.itemId,
        }),
        adminWriter?.rating({
          bot: bot.id,
          conversationId: grant.conversationId,
          visitor,
          at,
          source: 'chat',
          itemId: grant.itemId,
          rating: body.rating,
          ...withComment,
        }),
      ]);
    })().catch((error: unknown) => {
      console.error(`[askdare] the onFeedback hook failed: ${hookError(error)}`);
    });
    config.waitUntil?.(work);
    return new Response(null, { status: 204, headers: NO_STORE });
  };

  /** The session's visitor, as the handoff and form code needs them. */
  const visitorOf = (
    owner: { readonly visitorId: string; readonly key: string | undefined },
    request: Request,
    locale: string,
    identity?: VerifiedIdentity,
  ): HandoffVisitor => ({
    visitorId: owner.visitorId,
    key: owner.key,
    identity: identity?.identity,
    locale,
    clientIp: config.clientIp(request),
  });

  /**
   * Gives each open form in the history a fresh handle (ADR-0031, decision 3). A form whose handle
   * can't be issued any more (its form was removed from the bot) shows as expired.
   */
  const withFormHandles = async (
    tokens: TokenService,
    bot: Bot,
    visitor: HandoffVisitor,
    conversationId: string,
    messages: readonly HistoryMessage[],
    origins: ReadonlyMap<string, FormOrigin> | undefined,
  ): Promise<HistoryMessage[]> =>
    Promise.all(
      messages.map(async (message) => {
        if (!message.forms) return message;
        const forms = await Promise.all(
          message.forms.map(async (form): Promise<HistoryForm> => {
            if (form.state !== 'open') return form;
            const origin = origins?.get(form.callId);
            // In the visitor's language when it was shown, so the reports and labels keep it.
            const handle = await handoffs.reissue(
              tokens,
              bot,
              origin?.locale ? { ...visitor, locale: origin.locale } : visitor,
              conversationId,
              form,
              origin?.handoff,
            );
            return handle ? { ...form, handle } : { ...form, state: 'expired' };
          }),
        );
        return { ...message, forms };
      }),
    );

  /**
   * "Talk to a person" (ADR-0030, decision 2): the steps of a handoff without a model call. A
   * handoff limit is a state the chat shows; only this endpoint's own burst limit answers 429.
   */
  const requestHandoff = async (request: Request): Promise<Response> => {
    const { bot, conversationId, grant, tokens, owner } = await ownedConversation(
      request,
      handoffRequestSchema,
      async (bot, visitorId) => {
        if (!bot.handoff?.button) throw new AskdareError('not_found');
        await config.limits.checkHandoffRequest(bot, visitorId);
      },
    );
    const identity = keyed(await tokens.verifyAccess(bearerToken(request), bot.id)).identity;
    const info = await config.conversations.info(conversationId, request.signal);
    if (!ownsConversation(info, bot.id, grant)) throw new AskdareError('not_found');
    const result = await handoffs.fromVisitor(
      tokens,
      bot,
      visitorOf(owner, request, botLocale(bot), identity),
      conversationId,
    );
    return jsonResponse(
      result.form ? { state: result.state, form: result.form } : { state: result.state },
    );
  };

  /**
   * A form's submission (ADR-0031, decision 4). The handle names the form and the conversation;
   * it must belong to this session and to the conversation of the resume token. A refused value
   * is named by its field and an error key, never echoed.
   */
  const submitForm = async (request: Request): Promise<Response> => {
    const { body, bot, conversationId, tokens, owner, grant } = await ownedConversation(
      request,
      formRequestSchema,
      (bot, visitorId) =>
        config.limits.checkFormSubmission(bot, { visitorId, clientIp: config.clientIp(request) }),
    );
    const form = await tokens.verifyForm(body.form, bot.id);
    if (form.conversationId !== conversationId || !sameOwner(form, owner.visitorId, owner.key)) {
      throw new AskdareError('not_found');
    }
    const identity = keyed(await tokens.verifyAccess(bearerToken(request), bot.id)).identity;
    const info = await config.conversations.info(conversationId, request.signal);
    if (!ownsConversation(info, bot.id, grant)) throw new AskdareError('not_found');
    const result = await handoffs.submit(
      tokens,
      bot,
      visitorOf(owner, request, form.locale, identity),
      form,
      body.values,
    );
    switch (result.kind) {
      case 'sent':
        return jsonResponse(
          result.handoff ? { state: 'sent', handoff: result.handoff } : { state: 'sent' },
        );
      case 'invalid':
        return jsonResponse(
          {
            error: {
              code: 'invalid_input',
              message: 'Some fields need another look.',
              fields: result.fields,
            },
          },
          400,
        );
      case 'already_sent':
        return jsonResponse(
          {
            error: {
              code: 'invalid_input',
              message: 'This form was already sent.',
              key: 'error.form.sent',
            },
          },
          409,
        );
      case 'gone':
        throw new AskdareError('not_found');
    }
  };

  /**
   * Deletes a conversation whose ownership was checked: its admin records first, so a failure
   * leaves the conversation for a retry to find (ADR-0032, decision 4), then the conversation, then
   * its files.
   */
  const deleteOwned = async (conversationId: string, signal: AbortSignal): Promise<void> => {
    await adminWriter?.store.deleteConversation(conversationId, signal);
    const { fileIds } = await config.conversations.delete(conversationId, signal);
    if (fileIds.length > 0) await config.gateway().deleteFiles(fileIds);
  };

  const deleteConversation = async (request: Request): Promise<Response> => {
    const { bot, conversationId, grant } = await ownedConversation(request, conversationBody);
    // Not the request's signal: a visitor who leaves right after asking still gets it deleted.
    const signal = AbortSignal.timeout(DELETE_TIMEOUT_MS);
    // Someone else's conversation is answered like one already deleted, and left alone.
    if (ownsConversation(await config.conversations.info(conversationId, signal), bot.id, grant)) {
      await deleteOwned(conversationId, signal);
    }
    return new Response(null, { status: 204, headers: NO_STORE });
  };

  /**
   * `askdare doctor`: live checks of every bot with this server's key and config. Only for
   * callers that know CHAT_SECRET; one run at a time, since each makes a few OpenAI requests.
   */
  let doctorRunning = false;
  const runDoctor = async (request: Request): Promise<Response> => {
    await (await config.tokens()).verifyDoctor(bearerToken(request));
    return jsonResponse(await doctorReport(), 200, NO_STORE);
  };

  /** The checks behind `askdare doctor` and the console's doctor. */
  const doctorReport = async (): Promise<DoctorReport> => {
    // The kill switch stops it too, and the shared store bounds runs across instances.
    await config.limits.checkDoctor();
    if (doctorRunning) throw new AskdareError('rate_limited', { retryAfterMs: 5_000 });
    doctorRunning = true;
    try {
      let gateway: ModelGateway | undefined;
      try {
        gateway = config.gateway();
      } catch {
        // Reported per bot below.
      }
      // The conversation store is shared by every bot, so its checks run once.
      const storeChecks: DoctorCheck[] = config.conversations.diagnose
        ? [
            ...(await config.conversations
              .diagnose(AbortSignal.timeout(DOCTOR_STORE_TIMEOUT_MS))
              .catch((): DoctorCheck[] => [
                {
                  status: 'fail',
                  title: `The conversation store "${config.conversations.name}" could not be checked.`,
                },
              ])),
          ]
        : [];
      // So is the admin store, with the retention it should keep (ADR-0032, decision 4).
      if (adminWriter && config.admin) {
        storeChecks.push(
          ...(await adminStoreChecks(
            adminWriter,
            config.admin.retentionDays,
            AbortSignal.timeout(DOCTOR_STORE_TIMEOUT_MS),
          )),
        );
      }
      const bots: DoctorReport['bots'][number][] = [];
      for (const bot of config.bots) {
        const checks = gateway
          ? await gateway.diagnose({
              model: bot.model,
              vectorStoreId: bot.knowledge?.vectorStoreId,
              knowledgeIndex: bot.knowledge?.index,
              transcriptionModel: bot.voice?.model,
              attachments: bot.attachments !== undefined,
            })
          : [
              {
                status: 'fail' as const,
                title: 'OPENAI_API_KEY is not set where the app runs.',
                fix: "Add the key of the bot's OpenAI project to the app's environment.",
              },
            ];
        // The handler refuses to start without them, so these only confirm the setup.
        const handoffChecks: DoctorCheck[] = [
          ...(bot.handoff
            ? [
                {
                  status: 'ok' as const,
                  title: 'Handoff is on, and onHandoff receives the requests.',
                },
              ]
            : []),
          ...(offersForms(bot)
            ? [
                {
                  status: 'ok' as const,
                  title: 'Forms are offered to the model, and onLead receives them.',
                },
              ]
            : []),
        ];
        bots.push({
          id: bot.id,
          checks: [...checks, ...handoffChecks, ...storeChecks],
          turnTimeoutMs: bot.limits.turnTimeoutMs,
          disclosure: bot.widget.disclosure !== false,
          ...(bot.embedPath === undefined
            ? {}
            : {
                embed: {
                  path: bot.embedPath,
                  allowedOrigins: bot.security.allowedOrigins,
                  voice: bot.voice !== undefined,
                },
              }),
        });
      }
      return {
        development: config.development === true,
        sharedLimits: config.sharedLimits === true,
        gallery: config.gallery === true,
        bots,
      };
    } finally {
      doctorRunning = false;
    }
  };

  // Off by default: without `admin.console`, its paths answer 404 like any unknown path.
  const consoleOptions = config.admin?.console;
  const adminConsole =
    config.admin && consoleOptions
      ? createAdminConsole({
          config,
          admin: config.admin,
          console: consoleOptions,
          findBot,
          report,
          doctor: doctorReport,
          deleteConversation: deleteOwned,
        })
      : undefined;

  const route = async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith(`${config.basePath}/`)) throw new AskdareError('not_found');
    const path = pathname.slice(config.basePath.length);
    const method = request.method.toUpperCase();
    if (adminConsole && (path === '/admin' || path.startsWith('/admin/'))) {
      return adminConsole(request, path.slice('/admin'.length), method);
    }

    if (method === 'GET') {
      const query = new URL(request.url).searchParams;
      if (path === '/widget.js') return serveLoader(query);
      const embed = /^\/embed\/([a-z0-9-]{1,48})$/.exec(path);
      if (embed?.[1]) return serveEmbed(embed[1], query, request);
      const botConfig = /^\/config\/([a-z0-9-]{1,48})$/.exec(path);
      if (botConfig?.[1]) return serveConfig(botConfig[1], query, request);
      const theme = /^\/theme\/([a-z0-9-]{1,48})\.css$/.exec(path);
      if (theme?.[1]) return serveTheme(theme[1], query, request);
      const asset = /^\/assets\/([a-zA-Z0-9.-]{1,80})$/.exec(path);
      if (asset?.[1]) return serveAsset(asset[1]);
    } else if (method === 'POST') {
      if (path === '/session') return createSession(request);
      if (path === '/messages') return sendMessage(request);
      if (path === '/history') return readHistory(request);
      if (path === '/resume') return resumeAnswer(request);
      if (path === '/feedback') return submitFeedback(request);
      if (path === '/handoff') return requestHandoff(request);
      if (path === '/forms') return submitForm(request);
      if (path === '/attachments') return uploadAttachment(request);
      if (path === '/transcriptions') return transcribe(request);
      if (path === '/doctor') return runDoctor(request);
    } else if (method === 'DELETE') {
      if (path === '/conversation') return deleteConversation(request);
    }
    throw new AskdareError('not_found');
  };

  return async (request) => {
    try {
      return await route(request);
    } catch (error) {
      const failure = toAskdareError(error);
      if (failure.status >= 500) report(failure);
      return errorResponse(failure, config.explain?.(failure));
    }
  };
}
