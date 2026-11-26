import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryAdminStore } from '../admin/memory';
import type { AdminCountEvent } from '../admin/port';
import { type Bot, type BotDefinition, createBot } from '../bot/define-bot';
import { newItemId, visitorItem } from '../conversations/items';
import { memoryConversations } from '../conversations/memory';
import type { ConversationStore } from '../conversations/port';
import { defineForm } from '../forms/define-form';
import type { ChatLeadReport } from '../forms/lead-report';
import type { ModelGateway, TurnRequest } from '../gateway';
import type { ChatHandoffReport } from '../handoff/report';
import { createLimits } from '../limits/limits';
import { memoryStore } from '../limits/store';
import type { ProtocolEvent } from '../protocol/events';
import type { HistoryResponse } from '../protocol/history';
import { chatFormsSchema, historyResponseSchema } from '../protocol/schemas';
import { decodeEvent, SseParser } from '../protocol/sse';
import { createIdentityVerifier } from '../security/identity';
import { createTokenService, type TokenService } from '../security/tokens';
import { handoffOutput } from '../tools/handoff';
import { showFormOutput } from '../tools/show-form';
import { adminWriter } from './admin-records';
import type { EmbedAssets } from './embed-page';
import { createRequestHandler, type HandlerConfig, type RequestHandler } from './handler';
import { createHandoffs } from './handoff';

// Handoff (ADR-0030) and forms with leads (ADR-0031) through the handler. The gateway is a fake
// that does what the model would: it calls the turn's handoff and form hooks and stores the calls
// as the OpenAI gateway does; `openai/handoff-forms.test.ts` covers the model's side.

const APP = 'https://app.example.com';
const BASE = `${APP}/api/chat`;
const IDENTITY_SECRET = 'aGFuZG9mZi10ZXN0cy1pZGVudGl0eS1zZWNyZXQtMTIzNA';
/** A value that must never reach a log or an error. */
const SECRET_EMAIL = 'anna.secret@example.com';
const SECRET_TEXT = 'my-private-message-text';

const assets: EmbedAssets = {
  loaderJs: '',
  widgetJs: '',
  widgetCss: '',
  widgetJsFile: 'widget.a.js',
  widgetCssFile: 'widget.b.css',
  fontsCss: '',
  fontsCssFile: 'fonts.c.css',
  fontFiles: {},
  skinCss: '',
  skinCssFile: 'skin.d.css',
};

const contact = defineForm({
  name: 'contact',
  model: false,
  title: { en: 'Contact', pl: 'Kontakt' },
  fields: [
    { name: 'email', type: 'email', label: 'Email', required: true },
    { name: 'message', type: 'textarea', label: 'Message' },
  ],
});

const offer = defineForm({
  name: 'offer',
  description: 'Contact details for a sales offer.',
  title: 'Get an offer',
  fields: [
    { name: 'email', type: 'email', label: 'Email', required: true },
    {
      name: 'topic',
      type: 'select',
      label: { en: 'Topic', de: 'Thema' },
      toModel: true,
      options: [
        { value: 'pricing', label: 'Pricing' },
        { value: 'demo', label: 'A demo' },
      ],
    },
    { name: 'consent', type: 'consent', label: 'You may contact me.', required: true },
  ],
  submit: 'Send',
});

const usage = {
  inputTokens: 1,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 1,
  reasoningTokens: 0,
};

/** What the fake model does in a turn, after the visitor's message is stored. */
let script: (request: TurnRequest) => Promise<void>;
const turns: TurnRequest[] = [];

const gateway: ModelGateway = {
  deleteFiles: async () => {},
  transcribe: async () => ({ text: '', seconds: 0 }),
  uploadFile: async () => 'file-1',
  diagnose: async () => [],
  runTurn: async (request) => {
    turns.push(request);
    const store = request.conversations;
    await store.append(request.conversationId, [visitorItem(request)]);
    await script(request);
    await store.append(request.conversationId, [
      {
        id: newItemId(),
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        parts: [{ type: 'text', text: 'Answer.' }],
      },
    ]);
    request.emit({ type: 'text.delta', messageId: request.messageId, delta: 'Answer.' });
    return { reason: 'completed', usage };
  },
};

/** The calls a model handoff stores: the call and its fixed output. */
async function modelHandoff(request: TurnRequest, args: Record<string, unknown>) {
  const callId = `call_${turns.length}`;
  const json = JSON.stringify(args);
  const result = await request.handoff?.run({ callId, arguments: json });
  if (!result) throw new Error('no handoff in this turn');
  await request.conversations.append(request.conversationId, [
    { id: newItemId(), type: 'call', callId, name: 'handoff', arguments: json },
    {
      id: newItemId(),
      type: 'call_output',
      callId,
      output: handoffOutput(result.state, result.form),
    },
  ]);
  return result;
}

let tokens: TokenService;
let conversations: ConversationStore;
let handoffs: ChatHandoffReport[];
let leads: ChatLeadReport[];
let counts: AdminCountEvent[];
let errors: string[];
let pending: Promise<unknown>[];
let onHandoff: (report: ChatHandoffReport) => void | Promise<void>;
let onLead: (report: ChatLeadReport) => void | Promise<void>;
let logged: string[];

function makeHandler(bots: readonly Bot[], extra: Partial<HandlerConfig> = {}): RequestHandler {
  const writer = adminWriter(memoryAdminStore(), { transcripts: false, onError: () => {} });
  return createRequestHandler({
    bots,
    basePath: '/api/chat',
    assets,
    gateway: () => gateway,
    conversations,
    tokens: async () => tokens,
    limits: createLimits({ store: memoryStore() }),
    clientIp: (request) => request.headers.get('x-test-ip') ?? 'test',
    onError: (error) => errors.push(`${error.code}: ${error.message}`),
    identity: () => createIdentityVerifier({ secret: IDENTITY_SECRET }),
    onHandoff: (report) => onHandoff(report),
    onLead: (report) => onLead(report),
    waitUntil: (work) => pending.push(work),
    admin: {
      retentionDays: 30,
      writer: {
        ...writer,
        count: async (event) => {
          counts.push(event);
        },
      },
    },
    ...extra,
  });
}

const define = (definition: Partial<BotDefinition>): Bot =>
  createBot({ id: 'support', model: 'test-model', instructions: 'Help.', ...definition });

beforeEach(async () => {
  tokens = await createTokenService({ secret: 'aGFuZG9mZi10ZXN0cy1zZWNyZXQtMTIzNDU2Nzg5MGFi' });
  conversations = memoryConversations();
  handoffs = [];
  leads = [];
  counts = [];
  errors = [];
  pending = [];
  turns.length = 0;
  script = async () => {};
  onHandoff = (report) => {
    handoffs.push(report);
  };
  onLead = (report) => {
    leads.push(report);
  };
  logged = [];
  for (const method of ['error', 'warn', 'log', 'info'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

async function streamed(response: Response): Promise<ProtocolEvent[]> {
  const parser = new SseParser();
  return parser.push(await response.text()).flatMap((raw) => {
    const result = decodeEvent(raw);
    return result.ok ? [result.event] : [];
  });
}

interface Visitor {
  readonly auth: Record<string, string>;
  resumeToken: string;
}

/** A visitor with a conversation of one turn. */
async function converse(
  handler: RequestHandler,
  options: { readonly ip?: string; readonly identityToken?: string; readonly locale?: string } = {},
): Promise<Visitor & { events: ProtocolEvent[] }> {
  const headers = options.ip ? { 'x-test-ip': options.ip } : {};
  const session = (await (
    await handler(
      post(
        '/session',
        {
          botId: 'support',
          ...(options.identityToken ? { identityToken: options.identityToken } : {}),
        },
        headers,
      ),
    )
  ).json()) as { accessToken: string };
  const auth = { authorization: `Bearer ${session.accessToken}`, ...headers };
  const events = await streamed(
    await handler(
      post(
        '/messages',
        { botId: 'support', text: 'Hi', ...(options.locale ? { locale: options.locale } : {}) },
        auth,
      ),
    ),
  );
  const created = events.find((event) => event.type === 'conversation.created');
  if (created?.type !== 'conversation.created') throw new Error(JSON.stringify(events));
  await Promise.all(pending);
  return { auth, resumeToken: created.resumeToken, events };
}

async function again(handler: RequestHandler, visitor: Visitor): Promise<ProtocolEvent[]> {
  const events = await streamed(
    await handler(
      post(
        '/messages',
        { botId: 'support', text: 'More', resumeToken: visitor.resumeToken },
        visitor.auth,
      ),
    ),
  );
  await Promise.all(pending);
  return events;
}

const askForPerson = (handler: RequestHandler, visitor: Visitor) =>
  handler(post('/handoff', { botId: 'support', resumeToken: visitor.resumeToken }, visitor.auth));

const submit = (handler: RequestHandler, visitor: Visitor, form: string, values: unknown) =>
  handler(
    post(
      '/forms',
      { botId: 'support', resumeToken: visitor.resumeToken, form, values },
      visitor.auth,
    ),
  );

async function history(handler: RequestHandler, visitor: Visitor): Promise<HistoryResponse> {
  const response = await handler(
    post('/history', { botId: 'support', resumeToken: visitor.resumeToken }, visitor.auth),
  );
  expect(response.status).toBe(200);
  return historyResponseSchema.parse(await response.json()) as HistoryResponse;
}

/** Nothing the visitor typed reached a log line or an error report. */
function expectNoValues(...values: string[]): void {
  for (const value of values) {
    for (const line of [...logged, ...errors]) expect(line).not.toContain(value);
  }
}

describe('defineBot and the handler', () => {
  it('reserves the tool names and checks the handoff form', () => {
    expect(() => define({ handoff: { form: 'missing' }, forms: [contact] })).toThrow(
      /handoff\.form must name a form in forms/,
    );
    expect(() => define({ handoff: { model: false, button: false } })).toThrow(/model or button/);
    expect(() => define({ forms: [contact, contact] })).toThrow(/unique names/);
    expect(() => define({ forms: [{ ...contact }] as never })).toThrow(/defineForm/);
    const bot = define({ handoff: true });
    expect(bot.handoff).toMatchObject({
      model: true,
      button: true,
      content: 'none',
      limits: { perConversation: 1, perVisitorPerDay: 3, perBotPerDay: 100 },
    });
    expect(define({}).handoff).toBeUndefined();
  });

  it('refuses to start without someone to receive handoffs and leads', () => {
    expect(() => makeHandler([define({ handoff: true })], { onHandoff: undefined })).toThrow(
      /no onHandoff/,
    );
    expect(() => makeHandler([define({ forms: [offer] })], { onLead: undefined })).toThrow(
      /no onLead/,
    );
    // A form kept for the handoff needs no onLead.
    expect(() =>
      makeHandler([define({ handoff: { form: 'contact' }, forms: [contact] })], {
        onLead: undefined,
      }),
    ).not.toThrow();
  });

  it('describes the forms in the public configuration, never what is for the model', async () => {
    const handler = makeHandler([define({ forms: [offer, contact], widget: { locale: 'auto' } })]);
    const response = await handler(new Request(`${BASE}/config/support?lang=pl`));
    const body = (await response.json()) as { forms: unknown };
    expect(chatFormsSchema.safeParse(body.forms).success).toBe(true);
    expect(body.forms).toEqual([
      expect.objectContaining({ name: 'offer', title: 'Get an offer', submit: 'Send' }),
      expect.objectContaining({ name: 'contact', title: 'Kontakt' }),
    ]);
    const text = JSON.stringify(body);
    expect(text).not.toContain('sales offer');
    expect(text).not.toContain('toModel');
    expect(text).not.toContain('"model"');
  });
});

describe('a handoff the model asks for', () => {
  it('delivers it to onHandoff, records the state and offers no second one', async () => {
    const handler = makeHandler([define({ handoff: { content: 'summary' } })]);
    const states: string[] = [];
    script = async (request) => {
      expect(request.handoff?.offered).toBe(true);
      states.push(
        (await modelHandoff(request, { reason: 'complaint', summary: ' Wants a refund. ' })).state,
      );
    };
    const visitor = await converse(handler);
    expect(states).toEqual(['sent']);
    expect(handoffs).toEqual([
      expect.objectContaining({
        bot: 'support',
        trigger: 'model',
        reason: 'complaint',
        summary: 'Wants a refund.',
        available: true,
        id: expect.stringMatching(/^ho_[0-9a-f]{32}$/),
        conversationId: expect.any(String),
        visitor: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    ]);
    expect(handoffs[0]).not.toHaveProperty('contact');
    expect(counts).toEqual([
      expect.objectContaining({ kind: 'handoff', state: 'sent', source: 'chat' }),
    ]);

    script = async (request) => {
      expect(request.handoff?.offered).toBe(false);
    };
    await again(handler, visitor);
    const page = await history(handler, visitor);
    expect(page.messages[1]).toMatchObject({ role: 'assistant', handoff: { state: 'sent' } });
    expect(page.messages[3]?.handoff).toBeUndefined();
  });

  it('leaves the summary out unless the bot allows content, and fails without a throw reaching the turn', async () => {
    onHandoff = () => {
      throw new Error(`receiver said ${SECRET_TEXT}`);
    };
    const handler = makeHandler([define({ handoff: true })]);
    let result: unknown;
    script = async (request) => {
      result = await modelHandoff(request, { reason: 'sales', summary: SECRET_TEXT });
    };
    const visitor = await converse(handler);
    expect(result).toEqual({ state: 'failed' });
    expect(errors).toEqual(['internal_error: The onHandoff hook failed: Error.']);
    expectNoValues(SECRET_TEXT);
    expect(counts).toEqual([expect.objectContaining({ state: 'failed' })]);
    expect((await history(handler, visitor)).messages[1]?.handoff).toEqual({ state: 'failed' });
  });

  it('counts a delivery that runs past its deadline as failed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const reported: string[] = [];
      let called!: () => void;
      const delivering = new Promise<void>((resolve) => {
        called = resolve;
      });
      const handoffs = createHandoffs({
        limits: createLimits({ store: memoryStore() }),
        conversations,
        onHandoff: () => {
          called();
          return new Promise(() => {});
        },
        onError: (error) => reported.push(error.message),
        transcript: async () => [],
      });
      const bot = define({ handoff: true });
      const visitor = {
        visitorId: `v_${'a'.repeat(32)}`,
        key: undefined,
        identity: undefined,
        locale: 'en',
        clientIp: 'x',
      };
      const turn = await handoffs.forTurn(tokens, bot, visitor, 'conv_deadline');
      const result = turn?.run({ callId: 'call_x', arguments: '{"reason":"cannot_help"}' });
      await delivering;
      await vi.advanceTimersByTimeAsync(9_999);
      expect(reported).toEqual([]);
      await vi.advanceTimersByTimeAsync(2);
      await expect(result).resolves.toEqual({ state: 'failed' });
      expect(reported).toEqual(['The onHandoff hook failed: HandoffTimeoutError.']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the state of the handoff that ran when the model called it twice in one turn', async () => {
    const handler = makeHandler([define({ handoff: true })]);
    script = async (request) => {
      await modelHandoff(request, { reason: 'sales' });
      // turn.ts answers a second call in the same turn without running it.
      await request.conversations.append(request.conversationId, [
        {
          id: newItemId(),
          type: 'call',
          callId: 'call_again',
          name: 'handoff',
          arguments: '{"reason":"sales"}',
        },
        {
          id: newItemId(),
          type: 'call_output',
          callId: 'call_again',
          output: handoffOutput('limited'),
        },
      ]);
    };
    const visitor = await converse(handler);
    expect((await history(handler, visitor)).messages[1]?.handoff).toEqual({ state: 'sent' });
  });

  it('asks for contact details first, then hands the form values over', async () => {
    const handler = makeHandler([define({ handoff: { form: 'contact' }, forms: [contact] })]);
    let form: { name: string; handle: string; purpose: string } | undefined;
    script = async (request) => {
      const result = await modelHandoff(request, { reason: 'cannot_help' });
      expect(result.state).toBe('requested');
      form = result.form;
    };
    const visitor = await converse(handler);
    expect(form).toMatchObject({ name: 'contact', purpose: 'handoff' });
    expect(handoffs).toEqual([]);
    expect(counts).toEqual([]);
    const open = await history(handler, visitor);
    expect(open.messages[1]).toMatchObject({
      handoff: { state: 'requested' },
      forms: [{ name: 'contact', purpose: 'handoff', state: 'open', handle: expect.any(String) }],
    });

    const response = await submit(handler, visitor, form?.handle ?? '', {
      email: ` ${SECRET_EMAIL.toUpperCase().replace('EXAMPLE.COM', 'Example.COM')}`.replace(
        'ANNA.SECRET',
        'anna.secret',
      ),
      message: SECRET_TEXT,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: 'sent', handoff: 'sent' });
    expect(handoffs).toEqual([
      expect.objectContaining({
        trigger: 'model',
        reason: 'cannot_help',
        contact: { email: SECRET_EMAIL, message: SECRET_TEXT },
      }),
    ]);
    expect(counts).toEqual([expect.objectContaining({ kind: 'handoff', state: 'sent' })]);
    const sent = await history(handler, visitor);
    expect(sent.messages[1]).toMatchObject({
      handoff: { state: 'sent' },
      forms: [{ name: 'contact', state: 'sent' }],
    });
    expect(sent.messages[1]?.forms?.[0]?.handle).toBeUndefined();
    // The same form, sent again: already sent.
    const twice = await submit(handler, visitor, form?.handle ?? '', { email: SECRET_EMAIL });
    expect(twice.status).toBe(409);
    expect(await twice.json()).toMatchObject({ error: { key: 'error.form.sent' } });
    expectNoValues(SECRET_EMAIL, SECRET_TEXT);
  });

  it('skips the form for a signed-in visitor with an email', async () => {
    const handler = makeHandler([define({ handoff: { form: 'contact' }, forms: [contact] })]);
    const identityToken = await identity({ sub: 'u1', email: 'user@example.com' });
    let state: string | undefined;
    script = async (request) => {
      state = (await modelHandoff(request, { reason: 'visitor_asked' })).state;
    };
    await converse(handler, { identityToken });
    expect(state).toBe('sent');
    expect(handoffs[0]).toMatchObject({
      contact: { email: 'user@example.com' },
      identity: { id: 'u1' },
    });
  });
});

async function identity(claims: Record<string, unknown>): Promise<string> {
  const { SignJWT } = await import('jose');
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience('support')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(new TextEncoder().encode(IDENTITY_SECRET));
}

describe('POST /handoff', () => {
  it('answers 404 for a bot without the button', async () => {
    const handler = makeHandler([define({ handoff: { button: false } })]);
    const visitor = await converse(handler);
    expect((await askForPerson(handler, visitor)).status).toBe(404);
    const none = makeHandler([define({})]);
    const other = await converse(none);
    expect((await askForPerson(none, other)).status).toBe(404);
  });

  it('runs the steps without a model call and notes the state for the history', async () => {
    const handler = makeHandler([define({ handoff: true })]);
    const visitor = await converse(handler);
    const response = await askForPerson(handler, visitor);
    expect(await response.json()).toEqual({ state: 'sent' });
    expect(handoffs).toEqual([
      expect.objectContaining({ trigger: 'visitor', reason: 'visitor_asked' }),
    ]);
    expect(turns).toHaveLength(1);
    // A limit is a state the chat shows, not a 429.
    const second = await askForPerson(handler, visitor);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ state: 'limited' });
    expect(handoffs).toHaveLength(1);
    const page = await history(handler, visitor);
    expect(page.messages.at(-1)).toMatchObject({
      role: 'assistant',
      handoff: { state: 'limited' },
    });
    expect(counts.map((count) => count.kind === 'handoff' && count.state)).toEqual([
      'sent',
      'limited',
    ]);
    // The next turn's model reads the notes and isn't offered the tool any more.
    script = async (request) => {
      expect(request.handoff?.offered).toBe(false);
    };
    await again(handler, visitor);
  });

  it('limits handoffs per visitor a day across conversations, and per IP', async () => {
    const handler = makeHandler([
      define({ handoff: { limits: { perConversation: 5, perVisitorPerDay: 2 } } }),
    ]);
    const visitor = await converse(handler, { ip: '1.1.1.1' });
    const states: unknown[] = [];
    for (let index = 0; index < 3; index += 1) {
      states.push(await (await askForPerson(handler, visitor)).json());
    }
    expect(states).toEqual([{ state: 'sent' }, { state: 'sent' }, { state: 'limited' }]);
    // Another visitor behind the same IP.
    const neighbour = await converse(handler, { ip: '1.1.1.1' });
    expect(await (await askForPerson(handler, neighbour)).json()).toEqual({ state: 'limited' });
    const elsewhere = await converse(handler, { ip: '2.2.2.2' });
    expect(await (await askForPerson(handler, elsewhere)).json()).toEqual({ state: 'sent' });
  });

  it('tells the operator once when the bot runs out for the day', async () => {
    const exhausted: string[] = [];
    const handler = makeHandler([define({ handoff: { limits: { perBotPerDay: 1 } } })], {
      limits: createLimits({
        store: memoryStore(),
        onExhausted: (message) => exhausted.push(message),
      }),
    });
    const first = await converse(handler, { ip: '1.1.1.1' });
    const second = await converse(handler, { ip: '2.2.2.2' });
    const third = await converse(handler, { ip: '3.3.3.3' });
    expect(await (await askForPerson(handler, first)).json()).toEqual({ state: 'sent' });
    expect(await (await askForPerson(handler, second)).json()).toEqual({ state: 'limited' });
    expect(await (await askForPerson(handler, third)).json()).toEqual({ state: 'limited' });
    expect(exhausted).toEqual([expect.stringContaining('handoff.limits.perBotPerDay')]);
  });

  it('takes a message while nobody is available, and saves it through onLead', async () => {
    const handler = makeHandler([
      define({ handoff: { form: 'contact', available: () => false }, forms: [contact] }),
    ]);
    const visitor = await converse(handler);
    const asked = (await (await askForPerson(handler, visitor)).json()) as {
      state: string;
      form: { name: string; handle: string; purpose: string };
    };
    expect(asked).toMatchObject({
      state: 'requested',
      form: { name: 'contact', purpose: 'message' },
    });
    const response = await submit(handler, visitor, asked.form.handle, {
      email: SECRET_EMAIL,
      message: SECRET_TEXT,
    });
    expect(await response.json()).toEqual({ state: 'sent', handoff: 'saved' });
    expect(handoffs).toEqual([]);
    expect(leads).toEqual([
      expect.objectContaining({
        form: 'contact',
        values: { email: SECRET_EMAIL, message: SECRET_TEXT },
        source: {
          kind: 'handoff',
          reason: 'visitor_asked',
          trigger: 'visitor',
          delivered: false,
          why: 'unavailable',
        },
      }),
    ]);
    // Counted as a handoff saved, not as a lead (ADR-0032, decision 6).
    expect(counts).toEqual([expect.objectContaining({ kind: 'handoff', state: 'saved' })]);
    const page = await history(handler, visitor);
    expect(page.messages.at(-1)).toMatchObject({
      handoff: { state: 'saved' },
      forms: [{ name: 'contact', purpose: 'message', state: 'sent' }],
    });
  });

  it('says unavailable without a form, and treats a throwing availability check as unavailable', async () => {
    const handler = makeHandler([
      define({
        handoff: {
          available: () => {
            throw new Error(SECRET_TEXT);
          },
        },
      }),
    ]);
    const visitor = await converse(handler);
    expect(await (await askForPerson(handler, visitor)).json()).toEqual({ state: 'unavailable' });
    expect(handoffs).toEqual([]);
    expectNoValues(SECRET_TEXT);
  });

  it('saves the message through onLead when the delivery fails after the form', async () => {
    onHandoff = () => Promise.reject(new TypeError(SECRET_EMAIL));
    const handler = makeHandler([define({ handoff: { form: 'contact' }, forms: [contact] })]);
    const visitor = await converse(handler);
    const asked = (await (await askForPerson(handler, visitor)).json()) as {
      form: { handle: string };
    };
    const response = await submit(handler, visitor, asked.form.handle, { email: SECRET_EMAIL });
    expect(await response.json()).toEqual({ state: 'sent', handoff: 'saved' });
    expect(leads[0]?.source).toMatchObject({ kind: 'handoff', why: 'failed' });
    expect(errors).toEqual(['internal_error: The onHandoff hook failed: TypeError.']);
    expectNoValues(SECRET_EMAIL);
  });

  it("keeps a handoff form's toModel values out of the visible messages after a reload", async () => {
    const withTopic = defineForm({
      name: 'contact',
      model: false,
      title: 'Contact',
      fields: [
        { name: 'email', type: 'email', label: 'Email', required: true },
        { name: 'topic', type: 'text', label: 'Topic', toModel: true },
      ],
    });
    const handler = makeHandler([define({ handoff: { form: 'contact' }, forms: [withTopic] })]);
    const visitor = await converse(handler);
    const asked = (await (await askForPerson(handler, visitor)).json()) as {
      form: { handle: string };
    };
    const response = await submit(handler, visitor, asked.form.handle, {
      email: SECRET_EMAIL,
      topic: 'Billing',
    });
    expect(await response.json()).toEqual({ state: 'sent', handoff: 'sent' });
    const page = await history(handler, visitor);
    expect(page.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(page.messages[1]).toMatchObject({
      handoff: { state: 'sent' },
      forms: [{ name: 'contact', state: 'sent' }],
    });
    expect(JSON.stringify(page)).not.toContain('Billing');
  });
});

describe('POST /forms', () => {
  async function shownForm(handler: RequestHandler, locale?: string) {
    let handle: string | undefined;
    script = async (request) => {
      const shown = await request.showForm?.('offer', 'call_form');
      handle = shown?.handle;
      await request.conversations.append(request.conversationId, [
        {
          id: newItemId(),
          type: 'call',
          callId: 'call_form',
          name: 'show_form',
          arguments: '{"form":"offer"}',
        },
        {
          id: newItemId(),
          type: 'call_output',
          callId: 'call_form',
          output: showFormOutput(request.context.locale),
        },
      ]);
    };
    const visitor = await converse(handler, locale ? { locale } : {});
    if (!handle) throw new Error('no form was shown');
    return { visitor, handle };
  }

  it('refuses invalid values by field, never echoing them', async () => {
    const handler = makeHandler([define({ forms: [offer] })]);
    const { visitor, handle } = await shownForm(handler);
    const response = await submit(handler, visitor, handle, {
      email: `not-an-email ${SECRET_TEXT}`,
      topic: 'free',
      consent: false,
    });
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      error: {
        code: 'invalid_input',
        message: expect.any(String),
        fields: {
          email: 'error.form.email',
          topic: 'error.form.option',
          consent: 'error.form.required',
        },
      },
    });
    expect(text).not.toContain(SECRET_TEXT);
    expect(leads).toEqual([]);
    // An unknown key is refused as a whole.
    const unknown = await submit(handler, visitor, handle, {
      email: SECRET_EMAIL,
      consent: true,
      extra: 'x',
    });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ error: { fields: {} } });
    // A refused submission can be sent again.
    const fixed = await submit(handler, visitor, handle, {
      email: SECRET_EMAIL,
      topic: 'demo',
      consent: true,
    });
    expect(fixed.status).toBe(200);
  });

  it('hands a valid one to onLead after the response, and tells the model only what was marked', async () => {
    const handler = makeHandler([define({ forms: [offer] })]);
    const { visitor, handle } = await shownForm(handler);
    expect((await history(handler, visitor)).messages[1]).toMatchObject({
      forms: [
        {
          callId: 'call_form',
          name: 'offer',
          purpose: 'lead',
          state: 'open',
          handle: expect.any(String),
        },
      ],
    });
    const response = await submit(handler, visitor, handle, {
      email: SECRET_EMAIL,
      topic: 'pricing',
      consent: true,
    });
    expect(await response.json()).toEqual({ state: 'sent' });
    await Promise.all(pending);
    expect(leads).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^ld_/),
        bot: 'support',
        form: 'offer',
        locale: 'en',
        values: { email: SECRET_EMAIL, topic: 'pricing', consent: true },
        source: { kind: 'model' },
      }),
    ]);
    expect(counts).toEqual([expect.objectContaining({ kind: 'lead', source: 'chat' })]);
    // The conversation has the note and the toModel field, never the email.
    script = async (request) => {
      const context = await request.conversations.context(request.conversationId);
      const text = JSON.stringify(context);
      expect(text).toContain('[askdare:form] offer sent call_form');
      expect(text).toContain('[askdare:form-values]\\nTopic: pricing');
      expect(text).not.toContain(SECRET_EMAIL);
    };
    await again(handler, visitor);
    const page = await history(handler, visitor);
    // The values message is part of the form, not a visitor message.
    expect(page.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(page.messages[1]?.forms).toEqual([
      { callId: 'call_form', name: 'offer', purpose: 'lead', state: 'sent' },
    ]);
    expectNoValues(SECRET_EMAIL);
  });

  it('reports a failing onLead by name only', async () => {
    onLead = () => {
      throw new Error(`CRM refused ${SECRET_EMAIL}`);
    };
    const handler = makeHandler([define({ forms: [offer] })]);
    const { visitor, handle } = await shownForm(handler);
    const response = await submit(handler, visitor, handle, { email: SECRET_EMAIL, consent: true });
    expect(response.status).toBe(200);
    await Promise.all(pending);
    expect(errors).toEqual(['internal_error: The onLead hook failed: Error.']);
    expect(counts).toEqual([]);
    expectNoValues(SECRET_EMAIL);
  });

  it("answers 404 for another visitor's handle, another conversation's, and a forged one", async () => {
    const handler = makeHandler([define({ forms: [offer] })]);
    const { visitor, handle } = await shownForm(handler);
    const other = await converse(handler);
    const values = { email: SECRET_EMAIL, consent: true };
    // Someone else's session with the owner's resume token and handle.
    expect((await submit(handler, { ...visitor, auth: other.auth }, handle, values)).status).toBe(
      404,
    );
    // The owner's handle with another conversation.
    expect(
      (await submit(handler, { ...visitor, resumeToken: other.resumeToken }, handle, values))
        .status,
    ).toBe(404);
    expect((await submit(handler, visitor, 'forged', values)).status).toBe(404);
    expect(leads).toEqual([]);
  });

  it('limits submissions per visitor', async () => {
    const handler = makeHandler([define({ forms: [offer] })]);
    const { visitor, handle } = await shownForm(handler);
    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      statuses.push((await submit(handler, visitor, handle, { email: 'bad' })).status);
    }
    expect(statuses).toEqual([400, 400, 400, 400, 400, 429]);
  });

  it("keeps the visitor's language for a handle issued again after a reload", async () => {
    const handler = makeHandler([define({ forms: [offer], widget: { locale: 'auto' } })]);
    const { visitor } = await shownForm(handler, 'de');
    const reissued = (await history(handler, visitor)).messages[1]?.forms?.[0]?.handle;
    const response = await submit(handler, visitor, reissued ?? '', {
      email: SECRET_EMAIL,
      topic: 'demo',
      consent: true,
    });
    expect(response.status).toBe(200);
    await Promise.all(pending);
    expect(leads[0]?.locale).toBe('de');
    script = async (request) => {
      const text = JSON.stringify(await request.conversations.context(request.conversationId));
      expect(text).toContain('[askdare:form-values]\\nThema: demo');
    };
    await again(handler, visitor);
  });
});
