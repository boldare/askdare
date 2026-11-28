/**
 * The stage 1 admin console (ADR-0016, ADR-0032 decisions 7 and 8): a page, its inlined app, and a
 * JSON API behind an admin token. Off unless `admin.console` is set. Every request is checked
 * here, whatever the app's own sign-in does, and no answer carries a raw conversation ID.
 */
import { z } from 'zod';
import { dayOf } from '../admin/bounds';
import type { AdminDashboard } from '../admin/dashboard';
import type { AdminConversationSummary } from '../admin/port';
import type { Bot } from '../bot/define-bot';
import { checksOutput } from '../bot/guardrails';
import { itemHistory } from '../conversations/history';
import type { ConversationStoreCheck } from '../conversations/port';
import { historyReader } from '../conversations/provider-history';
import { AskdareError, toAskdareError } from '../errors';
import type { DoctorReport } from '../protocol/doctor';
import type { AdminGrant } from '../security/tokens';
import type { AdminWriter } from './admin-records';
import { explain } from './explain';
import type { HandlerConfig } from './handler';
import { assertSameOrigin, bearerToken, errorResponse, jsonResponse, readJson } from './http';
import { hookError, STREAM_HEADERS, streamTurn } from './stream-turn';

const DAY_MS = 86_400_000;
/** An identity token for the console lives at most 10 minutes (ADR-0032, decision 8). */
const ADMIN_IDENTITY_MAX_SECONDS = 10 * 60;
/** A colon can't be in a bot ID, so no bot's identity token can open the console. */
const ADMIN_IDENTITY_AUDIENCE = 'askdare:admin';
const ACTION = /^[a-z0-9-]{1,48}$/;

/** The console's built app, from its generated module (loaded only when the console is on). */
export interface ConsoleAssets {
  readonly ADMIN_JS: string;
  readonly ADMIN_CSS: string;
  readonly ADMIN_JS_FILE: string;
  readonly ADMIN_CSS_FILE: string;
}

export interface AdminConsoleConfig {
  /** `sub` values of identity tokens allowed in (ADR-0009, audience `askdare:admin`). */
  readonly allow: readonly string[];
  readonly dashboard?: AdminDashboard | undefined;
  /** `ADMIN_SECRET`, checked; undefined when the secret sign-in is off. Throws for a weak one. */
  readonly secret: () => string | undefined;
  /** Imports the generated module, so apps without the console never evaluate it. */
  readonly assets: () => Promise<ConsoleAssets>;
}

export interface AdminHandlerConfig {
  /** Writes records, and is what deletes and sweeps reach (ADR-0032, decision 3). */
  readonly writer?: AdminWriter | undefined;
  readonly retentionDays: number;
  readonly console?: AdminConsoleConfig | undefined;
}

/** Headers of the page and every API answer (ADR-0032, decision 8). */
export const CONSOLE_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex',
};

const signInBody = z.union([
  z.object({ secret: z.string().min(1).max(512) }).strict(),
  z.object({ identity: z.string().min(1).max(4096) }).strict(),
]);
const messageBody = z.object({
  botId: z.string().max(64),
  text: z.string(),
  conversation: z.string().min(1).max(4096).optional(),
  locale: z.string().max(35).optional(),
});
const referenceBody = z.object({ conversation: z.string().min(1).max(4096) });
const conversationsBody = z.object({
  order: z.enum(['latest', 'tokens']).default('latest'),
  rated: z.literal('down').optional(),
  source: z.enum(['chat', 'console', 'all']).optional(),
  cursor: z.string().min(1).max(1024).optional(),
});
const anyBody = z.unknown();

/** Compares two strings in constant time for their length, through their SHA-256 digests. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(given)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

/**
 * What the console shows of a bot: a fixed allowlist of resolved fields (ADR-0032, decision 7).
 * A field added to `defineBot` stays hidden until it is listed here. Never hooks, keys, verifiers
 * or anything read from the environment.
 */
export function consoleBotView(bot: Bot): Record<string, unknown> {
  const locale = bot.widget.locale === 'auto' ? 'en' : bot.widget.locale;
  let instructions: string;
  try {
    instructions = bot.instructions({ locale });
  } catch {
    instructions = '(the instructions function threw for an anonymous visitor)';
  }
  const tools = bot.tools.map((tool) => tool.name);
  const { widget, limits, knowledge, attachments, voice, guardrails } = bot;
  return {
    id: bot.id,
    model: bot.model,
    instructions,
    instructionsLocale: locale,
    tools,
    replies: widget.replies,
    pageContext: bot.pageContext,
    knowledge: knowledge
      ? knowledge.index
        ? { kind: 'index', maxResults: knowledge.maxResults }
        : {
            kind: 'vector-store',
            vectorStoreId: knowledge.vectorStoreId,
            maxResults: knowledge.maxResults,
          }
      : null,
    limits: { ...limits },
    attachments: attachments ? { ...attachments } : null,
    voice: voice ? { model: voice.model, maxSeconds: voice.maxSeconds } : null,
    guardrails: {
      moderation: guardrails.moderation
        ? {
            model: guardrails.moderation.model,
            input: guardrails.moderation.input,
            output: guardrails.moderation.output,
          }
        : null,
      onInput: guardrails.onInput !== undefined,
      onOutput: guardrails.onOutput !== undefined,
      toolResults: guardrails.toolResults,
    },
    security: {
      allowedOrigins: [...bot.security.allowedOrigins],
      humanCheck: bot.security.humanVerifier !== undefined,
    },
    // ADR-0030: the settings only; whether an availability check is set, never the function.
    handoff: bot.handoff
      ? {
          model: bot.handoff.model,
          button: bot.handoff.button,
          form: bot.handoff.form?.name ?? null,
          availabilityCheck: bot.handoff.available !== undefined,
          content: bot.handoff.content,
          limits: { ...bot.handoff.limits },
        }
      : null,
    // ADR-0031: each form's name, whether the model may show it, and its fields' types and
    // `toModel`; labels and texts are in the widget, and values never reach the console.
    // Keyed by name, like `limits`, so the console shows them as nested sections.
    forms:
      bot.forms.length > 0
        ? Object.fromEntries(
            bot.forms.map((form) => [
              form.name,
              {
                model: form.model,
                fields: Object.fromEntries(
                  form.fields.map((field) => [
                    field.name,
                    { type: field.type, required: field.required, toModel: field.toModel },
                  ]),
                ),
              },
            ]),
          )
        : null,
    embedPath: bot.embedPath ?? null,
    widget: {
      locale: widget.locale,
      title: widget.title,
      subtitle: widget.subtitle,
      greeting: widget.greeting,
      placeholder: widget.placeholder,
      launcherLabel: widget.launcherLabel,
      // ADR-0033: the delay, or null when the greeting is off.
      launcherGreeting: widget.launcherGreeting ? { ...widget.launcherGreeting } : null,
      starters: [...widget.starters],
      feedback: widget.feedback,
      disclosure: widget.disclosure !== false,
      colorScheme: widget.theme.colorScheme,
      texts: { ...widget.texts },
      textsByLocale: { ...widget.textsByLocale },
    },
  };
}

/**
 * The admin store's own checks, and a warning when records older than the retention remain
 * (ADR-0032, decision 4): found with a fixed, bounded query, so every store can answer it.
 */
export async function adminStoreChecks(
  writer: AdminWriter,
  retentionDays: number,
  signal: AbortSignal,
  now: number = Date.now(),
): Promise<ConversationStoreCheck[]> {
  const { store } = writer;
  const checks: ConversationStoreCheck[] = [];
  try {
    if (store.diagnose) checks.push(...(await store.diagnose(signal)));
    const newest = retentionDays + 1;
    if (newest < 400) {
      const old = await store.conversations(
        {
          from: dayOf(now - 399 * DAY_MS),
          to: dayOf(now - newest * DAY_MS),
          source: 'all',
          order: 'latest',
          limit: 1,
        },
        signal,
      );
      checks.push(
        old.items.length > 0
          ? {
              status: 'warn',
              title: `The admin store "${store.name}" holds records older than admin.retentionDays (${retentionDays}).`,
              fix: 'Call sweep() from the handlers on a schedule, such as a daily cron route.',
            }
          : { status: 'ok', title: `The admin store "${store.name}" keeps its retention.` },
      );
    }
  } catch {
    checks.push({ status: 'fail', title: `The admin store "${store.name}" could not be checked.` });
  }
  return checks;
}

export interface AdminConsoleDependencies {
  readonly config: HandlerConfig;
  readonly admin: AdminHandlerConfig;
  readonly console: AdminConsoleConfig;
  readonly findBot: (botId: string) => Bot;
  readonly report: (error: AskdareError) => void;
  readonly doctor: () => Promise<DoctorReport>;
  /** Deletes a conversation the caller checked: admin records, the conversation, then its files. */
  readonly deleteConversation: (conversationId: string, signal: AbortSignal) => Promise<void>;
}

type Session = AdminGrant & { readonly expiresAt: number };

/**
 * A dashboard handler's failure, by its `code`: `invalid_input` and `not_found` answer as such,
 * anything else as `internal_error`, reported by class name (the add-on can't import
 * `AskdareError`, so it throws an `Error` with a `code`).
 */
function dashboardError(error: unknown): AskdareError {
  if (error instanceof AskdareError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'invalid_input' || code === 'not_found') return new AskdareError(code);
  return new AskdareError('internal_error', {
    message: `A dashboard handler failed: ${hookError(error)}.`,
  });
}

/** The console's handler for `<basePath>/admin…`; `path` is what follows `/admin`. */
export function createAdminConsole(
  dependencies: AdminConsoleDependencies,
): (request: Request, path: string, method: string) => Promise<Response> {
  const { config, admin, report, findBot } = dependencies;
  const consoleConfig = dependencies.console;
  const writer = admin.writer;
  const dashboard = consoleConfig.dashboard;
  const allow = new Set(consoleConfig.allow);
  let assets: Promise<ConsoleAssets> | undefined;
  const loadAssets = (): Promise<ConsoleAssets> => {
    assets ??= consoleConfig.assets().catch((error: unknown) => {
      assets = undefined;
      throw error;
    });
    return assets;
  };
  const hash = async (content: string): Promise<string> => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
    return Array.from(new Uint8Array(digest).slice(0, 6), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
  };
  const dashboardFiles = dashboard
    ? Promise.all([hash(dashboard.script), hash(dashboard.style)]).then(([js, css]) => ({
        script: `dashboard.${js}.js`,
        style: `dashboard.${css}.css`,
      }))
    : undefined;

  const json = (body: unknown, status = 200): Response =>
    jsonResponse(body, status, CONSOLE_HEADERS);

  /**
   * The console's setup, checked on every request rather than at startup, so `next build` never
   * needs its secrets: without ADMIN_SECRET and `allow`, nobody can sign in, so it answers a setup
   * error; `allow` without IDENTITY_SECRET is said once, since no identity sign-in can work.
   */
  let warnedIdentity = false;
  const checkSetup = (): void => {
    const secret = consoleConfig.secret();
    if (secret === undefined && allow.size === 0) {
      throw new AskdareError('bot_unavailable', {
        cause: new TypeError(
          '[askdare] admin.console needs ADMIN_SECRET in the environment or an admin.console.allow list.',
        ),
      });
    }
    if (allow.size > 0 && !config.identity?.()) {
      if (secret === undefined) {
        throw new AskdareError('bot_unavailable', {
          cause: new TypeError(
            '[askdare] admin.console.allow needs IDENTITY_SECRET to verify identity sign-ins, and ADMIN_SECRET is not set either.',
          ),
        });
      }
      if (!warnedIdentity) {
        warnedIdentity = true;
        console.warn(
          '[askdare] admin.console.allow is set but IDENTITY_SECRET is not: identity sign-ins are refused until it is. ADMIN_SECRET still signs in.',
        );
      }
    }
  };

  const fingerprint = async (subject: string, secret?: string): Promise<string> => {
    const tokens = await config.tokens();
    return tokens.pseudonym(
      secret === undefined ? `askdare-admin-user:${subject}` : `askdare-admin-secret:${secret}`,
    );
  };

  /** The session behind the request's Bearer token, still valid for the current configuration. */
  const authorize = async (request: Request): Promise<Session> => {
    config.limits.checkAdmin();
    assertSameOrigin(request);
    const tokens = await config.tokens();
    const session = await tokens.verifyAdmin(bearerToken(request));
    let current: string | undefined;
    if (session.subject === 'secret') {
      const secret = consoleConfig.secret();
      current = secret === undefined ? undefined : await fingerprint('secret', secret);
    } else if (session.subject.startsWith('user:')) {
      const id = session.subject.slice('user:'.length);
      current = allow.has(id) && config.identity?.() ? await fingerprint(id) : undefined;
    }
    // A rotated secret, or a user removed from `allow`, ends the session here.
    if (current === undefined || current !== session.fingerprint) {
      throw new AskdareError('unauthorized');
    }
    return session;
  };

  const signIn = async (request: Request): Promise<Response> => {
    assertSameOrigin(request);
    await config.limits.checkAdminSignIn(config.clientIp(request));
    const body = await readJson(request, signInBody);
    const tokens = await config.tokens();
    let subject: string | undefined;
    let print: string | undefined;
    if ('secret' in body) {
      const secret = consoleConfig.secret();
      if (secret !== undefined && (await sameSecret(body.secret, secret))) {
        subject = 'secret';
        print = await fingerprint('secret', secret);
      }
    } else {
      const verifier = config.identity?.();
      const result = verifier
        ? await verifier.verify(body.identity, ADMIN_IDENTITY_AUDIENCE, ADMIN_IDENTITY_MAX_SECONDS)
        : undefined;
      if (result?.ok && allow.has(result.verified.identity.id)) {
        const id = result.verified.identity.id;
        subject = `user:${id}`;
        print = await fingerprint(id);
      }
    }
    if (subject === undefined || print === undefined) throw new AskdareError('unauthorized');
    const issued = await tokens.issueAdmin({ subject, fingerprint: print });
    return json({ token: issued.token, expiresAt: issued.expiresAt });
  };

  /** The playground's pseudonymous visitor and owner for this admin (ADR-0032, decision 7). */
  const playgroundOwner = async (
    session: Session,
  ): Promise<{ readonly visitorId: string; readonly owner: string }> => {
    const tokens = await config.tokens();
    const mac = await tokens.pseudonym(`admin:${session.subject}`);
    return { visitorId: `v_${mac.slice(0, 32)}`, owner: `admin:${mac}` };
  };

  const openReference = async (session: Session, reference: string): Promise<string> => {
    const tokens = await config.tokens();
    const id = await tokens.openAdminReference(reference, session.session);
    if (id === undefined) throw new AskdareError('not_found');
    return id;
  };
  const seal = async (session: Session, conversationId: string): Promise<string> =>
    (await config.tokens()).sealAdminReference(conversationId, session.session, session.expiresAt);

  const configView = (): Response =>
    json({
      bots: config.bots.map(consoleBotView),
      store: writer ? { name: writer.store.name, transcripts: writer.transcripts } : null,
      retentionDays: admin.retentionDays,
    });

  /** A playground turn: the normal turn path, with the bot's limits, marked `console`. */
  const sendMessage = async (request: Request, session: Session): Promise<Response> => {
    const body = await readJson(request, messageBody);
    const bot = findBot(body.botId);
    const tokens = await config.tokens();
    const { visitorId, owner } = await playgroundOwner(session);
    const conversationId =
      body.conversation === undefined ? undefined : await openReference(session, body.conversation);
    const text = body.text.trim();
    if (text.length === 0 || text.length > bot.limits.maxInputChars) {
      throw new AskdareError('invalid_input', {
        message: `Messages must be between 1 and ${bot.limits.maxInputChars} characters.`,
      });
    }
    const context = {
      locale: body.locale ?? (bot.widget.locale === 'auto' ? 'en' : bot.widget.locale),
    };
    const gateway = config.gateway();
    const reservation = await config.limits.beginTurn(bot, {
      clientIp: config.clientIp(request),
      visitorId,
      conversationId,
      inputChars: text.length + bot.instructions(context).length,
      attachmentTokens: 0,
    });
    const stream = streamTurn({
      gateway,
      conversations: config.conversations,
      owner,
      owns: conversationId
        ? (info) => info !== undefined && info.botId === bot.id && info.owner === owner
        : undefined,
      pseudonym: (value) => tokens.pseudonym(value),
      bot,
      text,
      attachments: [],
      context,
      visitorId,
      conversationId,
      signal: request.signal,
      // The browser holds sealed references, never the conversation's ID or a resume token.
      issueResumeToken: (id) => seal(session, id),
      settle: (usage, id, history) => {
        reservation
          .settle(usage, id, history)
          .catch((error: unknown) => report(toAskdareError(error)));
      },
      report: config.onUsage,
      transcript: config.onTranscript,
      record: writer ? (turn) => writer.turn(bot, 'console', turn) : undefined,
      recordText: writer?.transcripts,
      reserveCall: () => reservation.extend(),
      reserveCompaction: (inputTokens) => reservation.compaction(inputTokens),
      lockConversation: checksOutput(bot.guardrails)
        ? (id) => config.limits.lockConversation(bot, id)
        : undefined,
      onError: report,
      // Owners see what is wrong with the setup, as developers do in `next dev`.
      explain,
      heartbeatIntervalMs: config.heartbeatIntervalMs,
      waitUntil: config.waitUntil,
    });
    return new Response(stream, {
      headers: { ...STREAM_HEADERS, ...CONSOLE_HEADERS, 'Cache-Control': 'no-store, no-transform' },
    });
  };

  /** Deletes a playground conversation of this admin (best effort when the page closes). */
  const deletePlayground = async (request: Request, session: Session): Promise<Response> => {
    const body = await readJson(request, referenceBody);
    const id = await openReference(session, body.conversation);
    const { owner } = await playgroundOwner(session);
    const signal = AbortSignal.timeout(60_000);
    const info = await config.conversations.info(id, signal);
    if (info?.owner === owner) await dependencies.deleteConversation(id, signal);
    return new Response(null, { status: 204, headers: CONSOLE_HEADERS });
  };

  const requireStore = (): AdminWriter => {
    if (!writer) throw new AskdareError('not_found');
    return writer;
  };

  /** The admin store's conversations of the last `retentionDays`, with sealed references. */
  const listConversations = async (request: Request, session: Session): Promise<Response> => {
    const { store } = requireStore();
    const body = await readJson(request, conversationsBody);
    const now = Date.now();
    const days = Math.min(admin.retentionDays, 400);
    const page = await store.conversations(
      {
        from: dayOf(now - (days - 1) * DAY_MS),
        to: dayOf(now),
        order: body.order,
        limit: 25,
        ...(body.rated ? { rated: body.rated } : {}),
        ...(body.source ? { source: body.source } : {}),
        ...(body.cursor ? { cursor: body.cursor } : {}),
      },
      request.signal,
    );
    const items = await Promise.all(
      page.items.map(async ({ conversationId, ...summary }: AdminConversationSummary) => ({
        ...summary,
        reference: await seal(session, conversationId),
      })),
    );
    return json(page.cursor ? { items, cursor: page.cursor } : { items });
  };

  /**
   * One conversation's review (ADR-0032, decision 5): its transcript records, or without them the
   * conversation store's history.
   */
  const readConversation = async (request: Request, session: Session): Promise<Response> => {
    const { store } = requireStore();
    const body = await readJson(request, referenceBody);
    const id = await openReference(session, body.conversation);
    const records = await store.transcript(id, request.signal);
    if (records.length > 0) {
      return json({
        transcript: records.map(({ conversationId: _id, visitor: _visitor, ...record }) => record),
      });
    }
    const info = await config.conversations.info(id, request.signal);
    const bot = info ? config.bots.find((candidate) => candidate.id === info.botId) : undefined;
    if (!info || !bot) return json({ transcript: [] });
    const read = historyReader(config.conversations) ?? itemHistory(config.conversations);
    const history = await read(id, {
      signal: request.signal,
      checked: checksOutput(bot.guardrails),
      knowledge: bot.knowledge?.index,
    });
    return json({
      messages: history.messages.map((message) => ({
        role: message.role,
        text: message.text,
        attachments: message.attachments,
        citations: message.citations,
      })),
    });
  };

  const runDashboard = async (
    request: Request,
    session: Session,
    action: string,
  ): Promise<Response> => {
    const handler =
      dashboard && Object.hasOwn(dashboard.handlers, action)
        ? dashboard.handlers[action]
        : undefined;
    if (!handler) throw new AskdareError('not_found');
    const store = requireStore().store;
    const input = await readJson(request, anyBody);
    const tokens = await config.tokens();
    let result: unknown;
    try {
      result = await handler({
        store,
        input,
        seal: (conversationId) => seal(session, conversationId),
        open: (reference) => tokens.openAdminReference(reference, session.session),
        signal: request.signal,
      });
    } catch (error) {
      throw dashboardError(error);
    }
    return json(result ?? null);
  };

  const serveFile = async (file: string): Promise<Response> => {
    const built = await loadAssets();
    const files = await dashboardFiles;
    const body =
      file === built.ADMIN_JS_FILE
        ? { content: built.ADMIN_JS, type: 'text/javascript; charset=utf-8' }
        : file === built.ADMIN_CSS_FILE
          ? { content: built.ADMIN_CSS, type: 'text/css; charset=utf-8' }
          : dashboard && files && file === files.script
            ? { content: dashboard.script, type: 'text/javascript; charset=utf-8' }
            : dashboard && files && file === files.style
              ? { content: dashboard.style, type: 'text/css; charset=utf-8' }
              : undefined;
    if (!body) throw new AskdareError('not_found');
    // The same for every install and holding no configuration, so they may be cached.
    return new Response(body.content, {
      headers: {
        ...CONSOLE_HEADERS,
        'Content-Type': body.type,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    });
  };

  const servePage = async (): Promise<Response> => {
    config.limits.checkAdmin();
    const built = await loadAssets();
    const base = `${config.basePath}/admin`;
    const files = await dashboardFiles;
    const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>askdare console</title>
<link rel="stylesheet" href="${base}/${built.ADMIN_CSS_FILE}">
<script type="module" src="${base}/${built.ADMIN_JS_FILE}"></script>
</head>
<body>
<main id="askdare-console" data-dashboard="${files ? `${files.script} ${files.style}` : ''}"><noscript>The askdare console needs JavaScript.</noscript></main>
</body>
</html>
`;
    return new Response(page, {
      headers: { ...CONSOLE_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
    });
  };

  const route = async (request: Request, path: string, method: string): Promise<Response> => {
    checkSetup();
    if (method === 'GET') {
      if (path === '') return servePage();
      const file = /^\/([a-z]+\.[0-9a-f]{6,16}\.(?:js|css))$/.exec(path);
      if (file?.[1]) return serveFile(file[1]);
    } else if (method === 'POST') {
      if (path === '/api/session') return signIn(request);
      const api = /^\/api\/([a-z-]+)(?:\/([^/]+))?$/.exec(path);
      if (api?.[1]) {
        const session = await authorize(request);
        const action = api[1];
        if (api[2] !== undefined) {
          if (action === 'dashboard' && ACTION.test(api[2])) {
            return runDashboard(request, session, api[2]);
          }
        } else if (action === 'config') {
          return configView();
        } else if (action === 'doctor') {
          return json(await dependencies.doctor());
        } else if (action === 'message') {
          return sendMessage(request, session);
        } else if (action === 'delete') {
          return deletePlayground(request, session);
        } else if (action === 'conversations') {
          return listConversations(request, session);
        } else if (action === 'conversation') {
          return readConversation(request, session);
        }
      }
    }
    throw new AskdareError('not_found');
  };

  return async (request, path, method) => {
    try {
      return await route(request, path, method);
    } catch (error) {
      const failure = toAskdareError(error);
      if (failure.status >= 500) report(failure);
      const response = errorResponse(failure);
      for (const [name, value] of Object.entries(CONSOLE_HEADERS)) {
        response.headers.set(name, value);
      }
      return response;
    }
  };
}
