import { z } from 'zod';
import type { Bot } from '../bot/define-bot';
import { ChatdockError, toChatdockError } from '../errors';
import type { ModelGateway } from '../gateway';
import type { Limits } from '../limits/limits';
import { newVisitorId, type TokenService } from '../security/tokens';
import { type EmbedAssets, embedContentSecurityPolicy, renderEmbedPage } from './embed-page';
import { STREAM_HEADERS, streamTurn } from './stream-turn';

export interface HandlerConfig {
  readonly bots: readonly Bot[];
  /** Path of the catch-all route, without a trailing slash, e.g. `/api/chat`. */
  readonly basePath: string;
  readonly assets: EmbedAssets;
  /** Resolved lazily on first use, so importing the route never needs secrets (e.g. during build). */
  readonly gateway: () => ModelGateway;
  readonly tokens: () => Promise<TokenService>;
  readonly limits: Limits;
  /** Best-effort client IP for rate-limit keys. */
  readonly clientIp: (request: Request) => string;
  readonly onError?: ((error: ChatdockError) => void) | undefined;
  readonly heartbeatIntervalMs?: number | undefined;
}

export type RequestHandler = (request: Request) => Promise<Response>;

const MAX_BODY_BYTES = 256 * 1024;
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const sessionBody = z.object({
  botId: z.string().max(64),
  resumeToken: z.string().max(4096).optional(),
});

const messageBody = z.object({
  botId: z.string().max(64),
  text: z.string(),
  resumeToken: z.string().max(4096).optional(),
  locale: z
    .string()
    .regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/)
    .max(35)
    .optional(),
});

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE, ...headers },
  });
}

function errorResponse(error: ChatdockError): Response {
  const retry = error.retryAfterMs;
  return jsonResponse(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(retry ? { retryAfterMs: retry } : {}),
      },
    },
    error.status,
    retry ? { 'Retry-After': String(Math.ceil(retry / 1000)) } : {},
  );
}

/**
 * Defense in depth only: browsers can't reach the API cross-origin anyway, because JSON bodies need
 * a CORS preflight we never grant. Compares Origin with the Host header, which proxies set, never
 * with X-Forwarded-Host, which clients control.
 */
function assertSameOrigin(request: Request): void {
  const denied = (): ChatdockError =>
    new ChatdockError('unauthorized', { message: 'Cross-origin requests are not allowed.' });
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw denied();
  const origin = request.headers.get('origin');
  if (origin === null) return;
  const host = request.headers.get('host') ?? new URL(request.url).host;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw denied();
  }
  if (originHost !== host) throw denied();
}

/** Reads at most `limit` bytes and cancels the upload as soon as it grows past the limit. */
async function readBody(request: Request, limit: number): Promise<string> {
  const tooLarge = (): ChatdockError =>
    new ChatdockError('invalid_input', { message: 'Request body is too large.' });
  if (Number(request.headers.get('content-length') ?? 0) > limit) throw tooLarge();
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new ChatdockError('invalid_input', { message: 'Expected an application/json body.' });
  }
  const text = await readBody(request, MAX_BODY_BYTES);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ChatdockError('invalid_input', { message: 'Malformed JSON.' });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ChatdockError('invalid_input');
  return parsed.data;
}

function bearerToken(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match?.[1]) throw new ChatdockError('unauthorized');
  return match[1];
}

/**
 * Framework-agnostic request handler behind `createChatHandler`. Serves the loader, the iframe
 * document and its assets, and the JSON/SSE API used by the iframe app (same-origin, no CORS).
 */
export function createRequestHandler(config: HandlerConfig): RequestHandler {
  const bots = new Map(config.bots.map((bot) => [bot.id, bot]));
  const report =
    config.onError ??
    ((error: ChatdockError) => console.error(`[chatdock] ${error.code}`, error.cause));

  const findBot = (botId: string): Bot => {
    const bot = bots.get(botId);
    if (!bot) throw new ChatdockError('not_found');
    return bot;
  };

  const serveLoader = (): Response =>
    new Response(config.assets.loaderJs, {
      headers: {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'X-Content-Type-Options': 'nosniff',
      },
    });

  const serveEmbed = (botId: string): Response => {
    const bot = findBot(botId);
    return new Response(renderEmbedPage(bot, config.basePath, config.assets), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': embedContentSecurityPolicy(bot),
        'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
        'Referrer-Policy': 'strict-origin',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'X-Content-Type-Options': 'nosniff',
        ...NO_STORE,
      },
    });
  };

  const serveAsset = (file: string): Response => {
    const { assets } = config;
    const body =
      file === assets.widgetJsFile
        ? { content: assets.widgetJs, type: 'text/javascript; charset=utf-8' }
        : file === assets.widgetCssFile
          ? { content: assets.widgetCss, type: 'text/css; charset=utf-8' }
          : undefined;
    if (!body) throw new ChatdockError('not_found');
    return new Response(body.content, {
      headers: {
        'Content-Type': body.type,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  };

  const createSession = async (request: Request): Promise<Response> => {
    assertSameOrigin(request);
    const body = await readJson(request, sessionBody);
    const bot = findBot(body.botId);
    const tokens = await config.tokens();
    let returningVisitorId: string | undefined;
    if (body.resumeToken) {
      try {
        returningVisitorId = (await tokens.verifyResume(body.resumeToken, bot.id)).visitorId;
      } catch {
        // A stale or forged handle just starts a fresh visitor.
      }
    }
    // Renewals by returning visitors count per visitor, so people behind one NAT don't lock each other out.
    await config.limits.checkSession(bot, {
      clientIp: config.clientIp(request),
      returningVisitorId,
    });
    const visitorId = returningVisitorId ?? newVisitorId();
    const resumable = returningVisitorId !== undefined;
    const access = await tokens.issueAccess(bot.id, visitorId);
    return jsonResponse({ accessToken: access.token, expiresAt: access.expiresAt, resumable });
  };

  const sendMessage = async (request: Request): Promise<Response> => {
    assertSameOrigin(request);
    const body = await readJson(request, messageBody);
    const bot = findBot(body.botId);
    const tokens = await config.tokens();
    const { visitorId } = await tokens.verifyAccess(bearerToken(request), bot.id);
    let conversationId: string | undefined;
    if (body.resumeToken) {
      const grant = await tokens.verifyResume(body.resumeToken, bot.id);
      if (grant.visitorId !== visitorId) throw new ChatdockError('not_found');
      conversationId = grant.conversationId;
    }
    const text = body.text.trim();
    if (text.length === 0 || text.length > bot.limits.maxInputChars) {
      throw new ChatdockError('invalid_input', {
        message: `Messages must be between 1 and ${bot.limits.maxInputChars} characters.`,
      });
    }
    const context = { locale: body.locale ?? bot.widget.locale };
    const reservation = await config.limits.beginTurn(bot, {
      clientIp: config.clientIp(request),
      visitorId,
      conversationId,
      inputChars: text.length + bot.instructions(context).length,
    });
    const stream = streamTurn({
      gateway: config.gateway(),
      bot,
      text,
      context,
      visitorId,
      conversationId,
      signal: request.signal,
      issueResumeToken: async (id) =>
        (await tokens.issueResume(bot.id, { visitorId, conversationId: id })).token,
      onUsage: (usage, id) => {
        reservation.settle(usage, id).catch((error: unknown) => report(toChatdockError(error)));
      },
      onError: report,
      heartbeatIntervalMs: config.heartbeatIntervalMs,
    });
    return new Response(stream, { headers: STREAM_HEADERS });
  };

  const route = async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith(`${config.basePath}/`)) throw new ChatdockError('not_found');
    const path = pathname.slice(config.basePath.length);
    const method = request.method.toUpperCase();

    if (method === 'GET') {
      if (path === '/widget.js') return serveLoader();
      const embed = /^\/embed\/([a-z0-9-]{1,48})$/.exec(path);
      if (embed?.[1]) return serveEmbed(embed[1]);
      const asset = /^\/assets\/([a-zA-Z0-9.-]{1,80})$/.exec(path);
      if (asset?.[1]) return serveAsset(asset[1]);
    } else if (method === 'POST') {
      if (path === '/session') return createSession(request);
      if (path === '/messages') return sendMessage(request);
    }
    throw new ChatdockError('not_found');
  };

  return async (request) => {
    try {
      return await route(request);
    } catch (error) {
      const failure = toChatdockError(error);
      if (failure.status >= 500) report(failure);
      return errorResponse(failure);
    }
  };
}
