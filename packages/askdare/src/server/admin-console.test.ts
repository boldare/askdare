import { SignJWT } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { memoryAdminStore } from '../admin/memory';
import type { AdminStore } from '../admin/port';
import { createBot } from '../bot/define-bot';
import { memoryConversations } from '../conversations/memory';
import type { ConversationStore } from '../conversations/port';
import type { ModelGateway, TurnRequest } from '../gateway';
import { createLimits } from '../limits/limits';
import { memoryStore } from '../limits/store';
import type { ProtocolEvent } from '../protocol/events';
import { decodeEvent, SseParser } from '../protocol/sse';
import { createIdentityVerifier } from '../security/identity';
import { createTokenService, type TokenService } from '../security/tokens';
import { defineTool } from '../tools/define-tool';
import { type AdminHandlerConfig, CONSOLE_HEADERS, type ConsoleAssets } from './admin-console';
import { adminWriter } from './admin-records';
import type { EmbedAssets } from './embed-page';
import { createRequestHandler, type HandlerConfig, type RequestHandler } from './handler';
import type { ChatUsageReport } from './usage-report';

const APP = 'https://app.example.com';
const BASE = `${APP}/api/chat`;
const CHAT_SECRET = 'YWRtaW4tY29uc29sZS10ZXN0cy1zZWNyZXQtMTIzNDU2';
const IDENTITY_SECRET = 'aWRlbnRpdHktY29uc29sZS10ZXN0cy1zZWNyZXQtOTg3NjU0';
const ADMIN_SECRET = 'YWRtaW4tc2VjcmV0LWZvci10aGUtY29uc29sZS0xMjM0NTY3';

const assets: EmbedAssets = {
  loaderJs: 'console.log(`__ASKDARE_LAUNCHERS__`)',
  widgetJs: '',
  widgetCss: '',
  widgetJsFile: 'widget.abc123.js',
  widgetCssFile: 'widget.def456.css',
  fontsCss: '',
  fontsCssFile: 'fonts.222.css',
  fontFiles: {},
  skinCss: '',
  skinCssFile: 'skin.333.css',
};
const consoleAssets: ConsoleAssets = {
  ADMIN_JS: 'console.log("console")',
  ADMIN_CSS: 'body{}',
  ADMIN_JS_FILE: 'console.0123456789ab.js',
  ADMIN_CSS_FILE: 'console.ba9876543210.css',
};

const bot = createBot({
  id: 'support',
  model: 'test-model',
  instructions: 'Be brief.',
  widget: { feedback: true },
  tools: [
    defineTool({
      name: 'lookup',
      description: 'Looks up',
      input: z.object({}),
      execute: () => 1,
    }),
  ],
  onInput: async () => ({ action: 'allow' }),
});
const knowledgeBot = createBot({
  id: 'docs',
  model: 'test-model',
  instructions: 'Read.',
  knowledge: { vectorStoreId: 'vs_docs' },
});

const turns: TurnRequest[] = [];
const deletedFiles: string[] = [];
const gateway: ModelGateway = {
  deleteFiles: async (fileIds) => {
    deletedFiles.push(...fileIds);
  },
  transcribe: async () => ({ text: '', seconds: 0 }),
  uploadFile: async () => 'file-1',
  diagnose: async () => [{ status: 'ok', title: 'Model is available.' }],
  runTurn: async (request) => {
    turns.push(request);
    request.emit({ type: 'text.delta', messageId: request.messageId, delta: 'Hello!' });
    return {
      reason: 'completed',
      answerItemId: `msg_${turns.length}`,
      usage: {
        inputTokens: 10,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 5,
        reasoningTokens: 0,
      },
    };
  },
};

let tokens: TokenService;
beforeAll(async () => {
  tokens = await createTokenService({ secret: CHAT_SECRET });
});

interface Setup {
  readonly handler: RequestHandler;
  readonly store: AdminStore;
  readonly conversations: ConversationStore;
  readonly usage: ChatUsageReport[];
  readonly errors: string[];
  readonly settled: Promise<unknown>[];
}

function setup(
  options: {
    admin?: Partial<AdminHandlerConfig> | false;
    console?: Partial<NonNullable<AdminHandlerConfig['console']>> | false;
    secret?: () => string | undefined;
    disabled?: () => boolean;
    store?: AdminStore;
    conversations?: ConversationStore;
    transcripts?: boolean;
    onFeedback?: HandlerConfig['onFeedback'];
    /** false: no IDENTITY_SECRET. */
    identity?: false;
  } = {},
): Setup {
  const store = options.store ?? memoryAdminStore();
  const conversations = options.conversations ?? memoryConversations();
  const usage: ChatUsageReport[] = [];
  const errors: string[] = [];
  const settled: Promise<unknown>[] = [];
  const onError = (error: { message: string }) => errors.push(error.message);
  const writer = adminWriter(store, { transcripts: options.transcripts ?? false, onError });
  const admin: AdminHandlerConfig | undefined =
    options.admin === false
      ? undefined
      : {
          writer,
          retentionDays: 30,
          console:
            options.console === false
              ? undefined
              : {
                  allow: ['owner-1'],
                  secret: options.secret ?? (() => ADMIN_SECRET),
                  assets: async () => consoleAssets,
                  ...options.console,
                },
          ...options.admin,
        };
  const handler = createRequestHandler({
    bots: [bot, knowledgeBot],
    basePath: '/api/chat',
    assets,
    gateway: () => gateway,
    conversations,
    tokens: async () => tokens,
    limits: createLimits({
      store: memoryStore(),
      ...(options.disabled ? { disabled: options.disabled } : {}),
    }),
    clientIp: (request) => request.headers.get('x-test-ip') ?? 'test',
    onError,
    onUsage: (report) => {
      usage.push(report);
    },
    onFeedback: options.onFeedback,
    identity: () =>
      options.identity === false
        ? undefined
        : createIdentityVerifier({ secret: IDENTITY_SECRET, chatSecret: CHAT_SECRET }),
    waitUntil: (work) => settled.push(work),
    admin,
  });
  return { handler, store, conversations, usage, errors, settled };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: APP,
      host: 'app.example.com',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function events(response: Response): Promise<ProtocolEvent[]> {
  return new SseParser().push(await response.text()).flatMap((raw) => {
    const result = decodeEvent(raw);
    return result.ok ? [result.event] : [];
  });
}

async function signIn(handler: RequestHandler, body: unknown = { secret: ADMIN_SECRET }) {
  const response = await handler(post('/admin/api/session', body));
  return {
    response,
    token: response.ok ? ((await response.json()) as { token: string }).token : undefined,
  };
}

const bearer = (token: string | undefined) => ({ authorization: `Bearer ${token}` });

const identityToken = (sub: string, { audience = 'askdare:admin', lifetime = 300 } = {}) => {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + lifetime)
    .sign(new TextEncoder().encode(IDENTITY_SECRET));
};

const today = () => new Date().toISOString().slice(0, 10);

describe('the admin console route', () => {
  it('answers 404 on every path while the console is off', async () => {
    const { handler } = setup({ console: false });
    expect((await handler(new Request(`${BASE}/admin`))).status).toBe(404);
    expect((await signIn(handler)).response.status).toBe(404);
  });

  it('serves the page and its assets with the console headers, and no data on GET', async () => {
    const { handler } = setup();
    const page = await handler(new Request(`${BASE}/admin`));
    expect(page.status).toBe(200);
    for (const [name, value] of Object.entries(CONSOLE_HEADERS)) {
      expect(page.headers.get(name)).toBe(value);
    }
    const html = await page.text();
    expect(html).toContain(`/api/chat/admin/${consoleAssets.ADMIN_JS_FILE}`);
    expect(html).not.toContain('Be brief.');
    const js = await handler(new Request(`${BASE}/admin/${consoleAssets.ADMIN_JS_FILE}`));
    expect(js.headers.get('cache-control')).toContain('immutable');
    expect(js.headers.get('content-security-policy')).toBe(
      CONSOLE_HEADERS['Content-Security-Policy'],
    );
    expect((await handler(new Request(`${BASE}/admin/api/config`))).status).toBe(404);
  });

  it('refuses every API request without an admin token, with the console headers', async () => {
    const { handler } = setup();
    for (const action of ['config', 'doctor', 'message', 'conversations', 'conversation']) {
      const response = await handler(post(`/admin/api/${action}`, {}));
      expect(response.status).toBe(401);
      expect(response.headers.get('x-robots-tag')).toBe('noindex');
    }
    // A chat access token is no admin token.
    const access = await tokens.issueAccess('support', `v_${'a'.repeat(32)}`);
    expect((await handler(post('/admin/api/config', {}, bearer(access.token)))).status).toBe(401);
    const doctor = await tokens.issueDoctor();
    expect((await handler(post('/admin/api/config', {}, bearer(doctor.token)))).status).toBe(401);
  });

  it('signs in with ADMIN_SECRET and refuses a wrong one', async () => {
    const { handler } = setup();
    expect((await signIn(handler, { secret: `${ADMIN_SECRET}x` })).response.status).toBe(401);
    const { token } = await signIn(handler);
    expect(token).toBeDefined();
    expect((await handler(post('/admin/api/config', {}, bearer(token)))).status).toBe(200);
  });

  it('refuses the secret path when no ADMIN_SECRET is set', async () => {
    const { handler } = setup({ secret: () => undefined });
    expect((await signIn(handler)).response.status).toBe(401);
  });

  it('ends a session when ADMIN_SECRET is rotated', async () => {
    let secret = ADMIN_SECRET;
    const { handler } = setup({ secret: () => secret });
    const { token } = await signIn(handler);
    secret = 'cm90YXRlZC1hZG1pbi1zZWNyZXQtZm9yLXRoZS1jb25zb2xl';
    expect((await handler(post('/admin/api/config', {}, bearer(token)))).status).toBe(401);
  });

  it('signs in an allowlisted identity and refuses others', async () => {
    const { handler } = setup();
    const { token } = await signIn(handler, { identity: await identityToken('owner-1') });
    expect((await handler(post('/admin/api/config', {}, bearer(token)))).status).toBe(200);

    const refused = [
      await identityToken('someone-else'),
      await identityToken('owner-1', { audience: 'support' }),
      // A chat identity token for a bot whose ID is `askdare-admin`, the audience before c5's fix.
      await identityToken('owner-1', { audience: 'askdare-admin' }),
      // Longer than the console's 10 minutes.
      await identityToken('owner-1', { lifetime: 3600 }),
    ];
    for (const identity of refused) {
      expect((await signIn(handler, { identity })).response.status).toBe(401);
    }
  });

  it('ends a session when its user is removed from allow', async () => {
    const before = setup();
    const { token } = await signIn(before.handler, {
      identity: await identityToken('owner-1'),
    });
    const after = setup({ console: { allow: ['owner-2'] } });
    expect((await after.handler(post('/admin/api/config', {}, bearer(token)))).status).toBe(401);
  });

  it('limits sign-ins to 5 a minute per IP', async () => {
    const { handler } = setup();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await handler(
        post('/admin/api/session', { secret: 'wrong' }, { 'x-test-ip': '1.2.3.4' }),
      );
      statuses.push(response.status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    expect((await signIn(handler)).response.status).toBe(200);
  });

  it('answers a setup error on first use while nobody could sign in', async () => {
    const { handler } = setup({ secret: () => undefined, console: { allow: [] } });
    expect((await handler(new Request(`${BASE}/admin`))).status).toBe(503);
    expect((await signIn(handler)).response.status).toBe(503);
    const noIdentity = setup({ secret: () => undefined, identity: false });
    expect((await noIdentity.handler(new Request(`${BASE}/admin`))).status).toBe(503);
  });

  it('says once that allow needs IDENTITY_SECRET, and still signs in with ADMIN_SECRET', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { handler } = setup({ identity: false });
      const identity = await signIn(handler, { identity: await identityToken('owner-1') });
      expect(identity.response.status).toBe(401);
      expect((await signIn(handler)).response.status).toBe(200);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('IDENTITY_SECRET');
    } finally {
      warn.mockRestore();
    }
  });

  it('is closed by the kill switch', async () => {
    let disabled = false;
    const { handler } = setup({ disabled: () => disabled });
    const { token } = await signIn(handler);
    disabled = true;
    expect((await handler(post('/admin/api/config', {}, bearer(token)))).status).toBe(503);
    expect((await signIn(handler)).response.status).toBe(503);
  });

  it('shows only allowlisted fields of each bot', async () => {
    const { handler } = setup();
    const { token } = await signIn(handler);
    const view = (await (await handler(post('/admin/api/config', {}, bearer(token)))).json()) as {
      bots: Record<string, unknown>[];
    };
    const support = view.bots[0] as Record<string, unknown>;
    expect(Object.keys(support).sort()).toEqual(
      [
        'attachments',
        'embedPath',
        'guardrails',
        'id',
        'instructions',
        'instructionsLocale',
        'knowledge',
        'limits',
        'model',
        'pageContext',
        'replies',
        'security',
        'tools',
        'voice',
        'widget',
      ].sort(),
    );
    expect(support['instructions']).toBe('Be brief.');
    expect(support['tools']).toEqual(['lookup']);
    // Hooks are shown as whether they are set, never as code.
    expect(support['guardrails']).toMatchObject({ onInput: true, onOutput: false });
    expect(JSON.stringify(view)).not.toContain('owner-1');
    expect(JSON.stringify(view)).not.toContain(CHAT_SECRET);
    expect(view.bots[1]?.['knowledge']).toEqual({
      kind: 'vector-store',
      vectorStoreId: 'vs_docs',
      maxResults: 5,
    });
  });

  it('runs doctor, with the admin store checks', async () => {
    const { handler } = setup();
    const { token } = await signIn(handler);
    const report = (await (await handler(post('/admin/api/doctor', {}, bearer(token)))).json()) as {
      bots: { checks: { title: string }[] }[];
    };
    expect(report.bots[0]?.checks.map((check) => check.title)).toContain(
      'The admin store "memory" keeps its retention.',
    );
  });
});

describe('the playground', () => {
  it('runs real turns marked console, owned by the admin, with sealed references', async () => {
    const { handler, store, conversations, usage, settled } = setup();
    const { token } = await signIn(handler);
    const first = await events(
      await handler(post('/admin/api/message', { botId: 'support', text: 'Hi' }, bearer(token))),
    );
    await Promise.all(settled);
    const created = first.find((event) => event.type === 'conversation.created');
    const reference = created?.type === 'conversation.created' ? created.resumeToken : '';
    expect(first.some((event) => event.type === 'text.delta')).toBe(true);
    expect(usage).toHaveLength(1);

    const day = today();
    const listed = await store.conversations({
      from: day,
      to: day,
      source: 'console',
      order: 'latest',
      limit: 10,
    });
    const id = listed.items[0]?.conversationId ?? '';
    expect(id).not.toBe('');
    // The browser never gets the raw ID, and the conversation is the admin's.
    expect(reference).not.toContain(id);
    expect((await conversations.info(id))?.owner).toMatch(/^admin:[0-9a-f]{64}$/);
    expect(
      (await store.conversations({ from: day, to: day, order: 'latest', limit: 10 })).items,
    ).toEqual([]);

    // The reference continues the conversation, and only in this session.
    await events(
      await handler(
        post(
          '/admin/api/message',
          { botId: 'support', text: 'Again', conversation: reference },
          bearer(token),
        ),
      ),
    );
    expect(turns.at(-1)?.conversationId).toBe(id);
    const other = (await signIn(handler)).token;
    const foreign = await handler(
      post(
        '/admin/api/message',
        { botId: 'support', text: 'Again', conversation: reference },
        bearer(other),
      ),
    );
    expect(foreign.status).toBe(404);

    // Closing the page deletes it, with its records.
    const deleted = await handler(
      post('/admin/api/delete', { conversation: reference }, bearer(token)),
    );
    expect(deleted.status).toBe(204);
    expect(await conversations.info(id)).toBeUndefined();
    expect(await store.transcript(id)).toEqual([]);
  });

  it('counts against the bot limits', async () => {
    const { handler } = setup();
    const { token } = await signIn(handler);
    const statuses: number[] = [];
    for (let turn = 0; turn < 11; turn += 1) {
      const response = await handler(
        post('/admin/api/message', { botId: 'docs', text: 'Hi' }, bearer(token)),
      );
      statuses.push(response.status);
      await response.text();
    }
    // messagesPerVisitorPerMinute defaults to 10.
    expect(statuses.at(-1)).toBe(429);
  });

  it('lists stored conversations and reviews one by reference', async () => {
    const { handler, settled } = setup({ transcripts: true });
    const { token } = await signIn(handler);
    await events(
      await handler(post('/admin/api/message', { botId: 'support', text: 'Hi' }, bearer(token))),
    );
    await Promise.all(settled);
    const list = (await (
      await handler(post('/admin/api/conversations', { source: 'console' }, bearer(token)))
    ).json()) as { items: { reference: string; conversationId?: string }[] };
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.conversationId).toBeUndefined();
    const review = (await (
      await handler(
        post('/admin/api/conversation', { conversation: list.items[0]?.reference }, bearer(token)),
      )
    ).json()) as { transcript: { input: string; answer: string; conversationId?: string }[] };
    expect(review.transcript).toMatchObject([{ input: 'Hi', answer: 'Hello!' }]);
    expect(review.transcript[0]?.conversationId).toBeUndefined();
  });
});

describe('the dashboard plug-in', () => {
  it('serves its assets and calls its handlers with sealed references', async () => {
    const seen: unknown[] = [];
    const { handler } = setup({
      console: {
        dashboard: {
          script: 'export function mount(){}',
          style: '.d{}',
          handlers: {
            echo: async ({ input, seal, open }) => {
              const reference = await seal('conv_x');
              seen.push(input, await open(reference), await open('forged'));
              return { reference };
            },
            bad: async () => {
              throw Object.assign(new Error('bad range'), { code: 'invalid_input' });
            },
            broken: async () => {
              throw new RangeError('stored content');
            },
          },
        },
      },
    });
    const html = await (await handler(new Request(`${BASE}/admin`))).text();
    const script = /data-dashboard="(dashboard\.[0-9a-f]+\.js) /.exec(html)?.[1];
    expect(script).toBeDefined();
    const served = await handler(new Request(`${BASE}/admin/${script}`));
    expect(await served.text()).toBe('export function mount(){}');

    expect((await handler(post('/admin/api/dashboard/echo', { a: 1 }))).status).toBe(401);
    const { token } = await signIn(handler);
    const answer = await handler(post('/admin/api/dashboard/echo', { a: 1 }, bearer(token)));
    expect(answer.status).toBe(200);
    expect(seen).toEqual([{ a: 1 }, 'conv_x', undefined]);
    expect((await handler(post('/admin/api/dashboard/missing', {}, bearer(token)))).status).toBe(
      404,
    );
    expect(
      (await handler(post('/admin/api/dashboard/hasOwnProperty', {}, bearer(token)))).status,
    ).toBe(404);
    expect((await handler(post('/admin/api/dashboard/bad', {}, bearer(token)))).status).toBe(400);
    const broken = await handler(post('/admin/api/dashboard/broken', {}, bearer(token)));
    expect(broken.status).toBe(500);
    expect(await broken.text()).not.toContain('stored content');
  });
});

describe('writes to the admin store', () => {
  async function chatTurn(handler: RequestHandler, botId = 'support') {
    const session = (await (await handler(post('/session', { botId }))).json()) as {
      accessToken: string;
    };
    const stream = await events(
      await handler(post('/messages', { botId, text: 'Hi' }, bearer(session.accessToken))),
    );
    return { accessToken: session.accessToken, stream };
  }

  it('writes turns marked chat, and transcripts only with transcripts on', async () => {
    for (const transcripts of [false, true]) {
      const { handler, store, settled } = setup({ transcripts, console: false });
      await chatTurn(handler);
      await chatTurn(handler, 'docs');
      await Promise.all(settled);
      const day = today();
      const { turns: rows } = await store.days({ from: day, to: day });
      expect(rows.map((row) => [row.bot, row.turns, row.unanswered])).toEqual([
        ['docs', 1, 1], // a knowledge bot that cited nothing
        ['support', 1, 0],
      ]);
      const { items } = await store.conversations({
        from: day,
        to: day,
        order: 'latest',
        limit: 10,
      });
      expect(items).toHaveLength(2);
      expect(items.every((item) => item.transcript === transcripts)).toBe(true);
    }
  });

  it('accepts ratings with a store and no onFeedback, and records them', async () => {
    const { handler, store, settled } = setup({ console: false });
    const { accessToken, stream } = await chatTurn(handler);
    const end = stream.find((event) => event.type === 'message.end');
    const feedback = end?.type === 'message.end' ? end.feedback?.handle : undefined;
    expect(feedback).toBeDefined();
    const rated = await handler(
      post(
        '/feedback',
        { botId: 'support', feedback, rating: 'down', comment: 'Wrong' },
        bearer(accessToken),
      ),
    );
    expect(rated.status).toBe(204);
    await Promise.all(settled);
    const day = today();
    const ratings = await store.ratings({ from: day, to: day, limit: 10 });
    expect(ratings.items).toMatchObject([{ rating: 'down', comment: 'Wrong', bot: 'support' }]);
  });

  it('reports a failing write to onError by class name, never failing the turn', async () => {
    const store = memoryAdminStore();
    store.recordTurn = async () => {
      throw new TypeError('secret content');
    };
    const { handler, errors, settled } = setup({ store, console: false });
    const { stream } = await chatTurn(handler);
    await Promise.all(settled);
    expect(stream.some((event) => event.type === 'message.end')).toBe(true);
    expect(errors.join(' ')).toContain('TypeError');
    expect(errors.join(' ')).not.toContain('secret content');
  });

  it('deletes a conversation: admin records, then the conversation, then its files', async () => {
    const calls: string[] = [];
    const store = memoryAdminStore();
    const deleteRecords = store.deleteConversation.bind(store);
    store.deleteConversation = async (id, signal) => {
      calls.push('admin');
      await deleteRecords(id, signal);
    };
    const conversations = memoryConversations();
    const deleteConversation = conversations.delete.bind(conversations);
    conversations.delete = async (id, signal) => {
      calls.push('conversation');
      await deleteConversation(id, signal);
      return { fileIds: ['file-9'] };
    };
    const { handler, settled } = setup({ store, conversations, console: false });
    const { accessToken, stream } = await chatTurn(handler);
    await Promise.all(settled);
    const created = stream.find((event) => event.type === 'conversation.created');
    const resumeToken = created?.type === 'conversation.created' ? created.resumeToken : '';
    deletedFiles.length = 0;
    const originalDeleteFiles = gateway.deleteFiles;
    gateway.deleteFiles = async (ids) => {
      calls.push('files');
      await originalDeleteFiles(ids);
    };
    try {
      const response = await handler(
        new Request(`${BASE}/conversation`, {
          method: 'DELETE',
          headers: {
            'content-type': 'application/json',
            origin: APP,
            host: 'app.example.com',
            ...bearer(accessToken),
          },
          body: JSON.stringify({ botId: 'support', resumeToken }),
        }),
      );
      expect(response.status).toBe(204);
    } finally {
      gateway.deleteFiles = originalDeleteFiles;
    }
    expect(calls).toEqual(['admin', 'conversation', 'files']);
    const day = today();
    expect(
      (await store.conversations({ from: day, to: day, order: 'latest', limit: 10 })).items,
    ).toEqual([]);
  });

  it('leaves the conversation in place when the admin delete fails', async () => {
    const store = memoryAdminStore();
    store.deleteConversation = vi.fn(async () => {
      throw new Error('down');
    });
    const conversations = memoryConversations();
    const { handler, settled } = setup({ store, conversations, console: false });
    const { accessToken, stream } = await chatTurn(handler);
    await Promise.all(settled);
    const created = stream.find((event) => event.type === 'conversation.created');
    const resumeToken = created?.type === 'conversation.created' ? created.resumeToken : '';
    const verified = await tokens.verifyResume(resumeToken, 'support');
    const response = await handler(
      new Request(`${BASE}/conversation`, {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json',
          origin: APP,
          host: 'app.example.com',
          ...bearer(accessToken),
        },
        body: JSON.stringify({ botId: 'support', resumeToken }),
      }),
    );
    expect(response.status).toBe(500);
    expect(await conversations.info(verified.conversationId)).toBeDefined();
  });
});
