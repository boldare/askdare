import { z } from 'zod';
import {
  attachmentName,
  countPdfPages,
  detectFile,
  IMAGE_TOKENS,
  PDF_PAGE_TOKENS,
} from '../attachments/files';
import type { Bot } from '../bot/define-bot';
import { ChatdockError, toChatdockError } from '../errors';
import type { ModelGateway, TurnAttachment } from '../gateway';
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
/** Upload metadata travels in headers because the body is the raw file. */
const BOT_HEADER = 'x-chatdock-bot';
const FILENAME_HEADER = 'x-chatdock-filename';
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const sessionBody = z.object({
  botId: z.string().max(64),
  resumeToken: z.string().max(4096).optional(),
  /** The previous access token, so a renewal keeps the visitor before they have a conversation. */
  accessToken: z.string().max(4096).optional(),
});

const conversationBody = z.object({
  botId: z.string().max(64),
  resumeToken: z.string().min(1).max(4096),
});

const messageBody = z.object({
  botId: z.string().max(64),
  text: z.string(),
  /** Handles from POST /attachments; raw OpenAI file IDs fail verification. */
  attachments: z.array(z.string().min(1).max(4096)).max(10).optional(),
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
async function readBytes(
  request: Request,
  limit: number,
  message = 'Request body is too large.',
): Promise<Uint8Array> {
  const tooLarge = (): ChatdockError => new ChatdockError('invalid_input', { message });
  if (Number(request.headers.get('content-length') ?? 0) > limit) throw tooLarge();
  if (!request.body) return new Uint8Array();
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
  return bytes;
}

async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new ChatdockError('invalid_input', { message: 'Expected an application/json body.' });
  }
  const text = new TextDecoder().decode(await readBytes(request, MAX_BODY_BYTES));
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
    throw new ChatdockError('invalid_input', { message: 'This assistant does not accept files.' });
  }
  if (unique.length > bot.attachments.maxPerMessage) {
    throw new ChatdockError('invalid_input', {
      message: `Attach up to ${bot.attachments.maxPerMessage} files per message.`,
    });
  }
  const files = new Map<string, TurnAttachment>();
  let attachmentTokens = 0;
  for (const handle of unique) {
    const grant = await tokens.verifyAttachment(handle, bot.id);
    if (grant.visitorId !== visitorId) {
      throw new ChatdockError('invalid_input', {
        message: 'An attachment expired or is invalid. Please attach it again.',
      });
    }
    if (files.has(grant.fileId)) continue;
    files.set(grant.fileId, { fileId: grant.fileId, kind: grant.kind });
    attachmentTokens += grant.tokens;
  }
  return { attachments: [...files.values()], attachmentTokens };
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
    let resumable = false;
    if (body.resumeToken) {
      try {
        returningVisitorId = (await tokens.verifyResume(body.resumeToken, bot.id)).visitorId;
        resumable = true;
      } catch {
        // A stale or forged handle just starts a fresh visitor.
      }
    }
    if (!returningVisitorId && body.accessToken) {
      try {
        returningVisitorId = (await tokens.verifyRenewal(body.accessToken, bot.id)).visitorId;
      } catch {
        // Too old or forged: start a fresh visitor.
      }
    }
    // Renewals by returning visitors count per visitor, so people behind one NAT don't lock each other out.
    await config.limits.checkSession(bot, {
      clientIp: config.clientIp(request),
      returningVisitorId,
    });
    const visitorId = returningVisitorId ?? newVisitorId();
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
    const { attachments, attachmentTokens } = await verifyAttachments(
      bot,
      tokens,
      visitorId,
      body.attachments ?? [],
    );
    const text = body.text.trim();
    if ((text.length === 0 && attachments.length === 0) || text.length > bot.limits.maxInputChars) {
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
      attachmentTokens,
    });
    const stream = streamTurn({
      gateway: config.gateway(),
      bot,
      text,
      attachments,
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

  /**
   * Stores one file for the visitor's next message. The body is the raw file; its type is detected
   * from its bytes. Returns an encrypted handle, so the client never learns the OpenAI file ID.
   */
  const uploadAttachment = async (request: Request): Promise<Response> => {
    assertSameOrigin(request);
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('application/octet-stream')) {
      throw new ChatdockError('invalid_input', {
        message: 'Expected an application/octet-stream body.',
      });
    }
    const bot = findBot(request.headers.get(BOT_HEADER) ?? '');
    const allowed = bot.attachments;
    if (!allowed) {
      throw new ChatdockError('invalid_input', {
        message: 'This assistant does not accept files.',
      });
    }
    const tokens = await config.tokens();
    const { visitorId } = await tokens.verifyAccess(bearerToken(request), bot.id);
    await config.limits.checkUpload(bot, { clientIp: config.clientIp(request), visitorId });
    const megabytes = Math.floor((allowed.maxBytes / 1_000_000) * 10) / 10;
    const bytes = await readBytes(request, allowed.maxBytes, `Files can be up to ${megabytes} MB.`);
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
      throw new ChatdockError('invalid_input', { message: `Only ${types} files are supported.` });
    }
    let cost = IMAGE_TOKENS;
    if (file.kind === 'pdf') {
      const pages = await countPdfPages(bytes);
      if (pages !== undefined && pages > allowed.maxPdfPages) {
        throw new ChatdockError('invalid_input', {
          message: `PDFs can have up to ${allowed.maxPdfPages} pages.`,
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

  /** Authenticates the visitor and proves they own the conversation behind the resume token. */
  const ownedConversation = async (
    request: Request,
  ): Promise<{ bot: Bot; conversationId: string }> => {
    assertSameOrigin(request);
    const body = await readJson(request, conversationBody);
    const bot = findBot(body.botId);
    const tokens = await config.tokens();
    const { visitorId } = await tokens.verifyAccess(bearerToken(request), bot.id);
    const grant = await tokens.verifyResume(body.resumeToken, bot.id);
    if (grant.visitorId !== visitorId) throw new ChatdockError('not_found');
    await config.limits.checkConversationAccess(bot, visitorId);
    return { bot, conversationId: grant.conversationId };
  };

  const readHistory = async (request: Request): Promise<Response> => {
    const { conversationId } = await ownedConversation(request);
    const messages = await config.gateway().listMessages(conversationId, request.signal);
    return jsonResponse({ messages });
  };

  const deleteConversation = async (request: Request): Promise<Response> => {
    const { bot, conversationId } = await ownedConversation(request);
    await config
      .gateway()
      .deleteConversation(conversationId, { withFiles: bot.attachments !== undefined });
    return new Response(null, { status: 204, headers: NO_STORE });
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
      if (path === '/history') return readHistory(request);
      if (path === '/attachments') return uploadAttachment(request);
    } else if (method === 'DELETE') {
      if (path === '/conversation') return deleteConversation(request);
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
