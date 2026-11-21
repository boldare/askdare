import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { defineBot } from '../bot/define-bot';
import { AskdareError } from '../errors';
import type { ModelGateway, TurnRequest } from '../gateway';
import { memoryStore } from '../limits/store';
import type { ProtocolEvent } from '../protocol/events';
import { decodeEvent, SseParser } from '../protocol/sse';
import { TROUBLESHOOTING } from '../server/explain';
import type { ChatErrorReport } from './create-chat-handler';
import { createChatHandler } from './create-chat-handler';

const mocks = vi.hoisted(() => ({
  /** Work handed to Next's `after()`, so a test can wait for the hooks to finish. */
  pending: [] as Promise<unknown>[],
  createOpenAIGateway: vi.fn(),
}));

vi.mock('next/server.js', () => ({
  after: (work: Promise<unknown>) => {
    mocks.pending.push(work);
  },
}));

// The narrowest seam: the factory builds the gateway from the API key; the rest is real.
vi.mock('../openai/gateway', () => ({ createOpenAIGateway: mocks.createOpenAIGateway }));

const APP = 'https://app.example.com';
const BASE = `${APP}/api/chat`;
const SECRET = 'Y3JlYXRlLWNoYXQtaGFuZGxlci1zZWNyZXQtMTIzNDU2';
const OTHER_SECRET = 'b3RoZXItY2hhdC1oYW5kbGVyLXNlY3JldC05ODc2NTQz';
/** What a visitor typed, which a 400 from OpenAI can quote back. */
const VISITOR_TEXT = 'my private question about my medical history';

const bot = defineBot({ id: 'support', model: 'test-model', instructions: 'Be brief.' });

const turns: TurnRequest[] = [];
let runTurn: ModelGateway['runTurn'];

const gateway: ModelGateway = {
  createConversation: async () => 'conv_1',
  deleteConversation: async () => {},
  transcribe: async () => ({ text: '', seconds: 0 }),
  uploadFile: async () => 'file-1',
  listMessages: async () => [],
  diagnose: async () => [],
  runTurn: (request) => runTurn(request),
};

const completed: ModelGateway['runTurn'] = async (request) => {
  turns.push(request);
  request.emit({ type: 'text.delta', messageId: request.messageId, delta: 'Hello!' });
  return {
    reason: 'completed',
    usage: {
      inputTokens: 1,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1,
      reasoningTokens: 0,
    },
  };
};

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

async function accessToken(handle: (request: Request) => Promise<Response>): Promise<string> {
  const response = await handle(post('/session', { botId: 'support' }));
  expect(response.status).toBe(200);
  return ((await response.json()) as { accessToken: string }).accessToken;
}

async function chat(
  handle: (request: Request) => Promise<Response>,
  token: string,
): Promise<ProtocolEvent[]> {
  const response = await handle(
    post('/messages', { botId: 'support', text: 'Hi' }, { authorization: `Bearer ${token}` }),
  );
  return events(response);
}

/** Waits for everything handed to `after()`, including work queued while waiting. */
async function settle(): Promise<void> {
  while (mocks.pending.length > 0) {
    await Promise.allSettled(mocks.pending.splice(0));
  }
}

let errorLog: MockInstance<typeof console.error>;
let warnLog: MockInstance<typeof console.warn>;

beforeEach(() => {
  turns.length = 0;
  mocks.pending.length = 0;
  runTurn = completed;
  mocks.createOpenAIGateway.mockReset();
  mocks.createOpenAIGateway.mockReturnValue(gateway);
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('CHAT_SECRET', SECRET);
  vi.stubEnv('CHAT_SECRET_PREVIOUS', '');
  vi.stubEnv('OPENAI_API_KEY', 'sk-test-env-key');
  vi.stubEnv('IDENTITY_SECRET', '');
  vi.stubEnv('ASKDARE_DISABLED', '');
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnLog = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('createChatHandler setup', () => {
  it('needs no secrets until the first request, so importing the route never fails', () => {
    vi.stubEnv('CHAT_SECRET', '');
    vi.stubEnv('OPENAI_API_KEY', '');
    expect(() => createChatHandler({ bots: [bot] })).not.toThrow();
    expect(mocks.createOpenAIGateway).not.toHaveBeenCalled();
  });

  it('serves every method from one handler', () => {
    const handlers = createChatHandler({ bots: [bot] });
    expect(handlers.GET).toBe(handlers.POST);
    expect(handlers.DELETE).toBe(handlers.POST);
  });

  it('rejects a duplicate bot id', () => {
    expect(() =>
      createChatHandler({
        bots: [bot, defineBot({ id: 'other', model: 'test-model', instructions: 'Hi.' }), bot],
      }),
    ).toThrow('[askdare] Duplicate bot id "support".');
  });

  it('rejects an empty bot list', () => {
    expect(() => createChatHandler({ bots: [] })).toThrow('[askdare] Define at least one bot.');
  });

  it('rejects a basePath that is not a route path', () => {
    expect(() => createChatHandler({ bots: [bot], basePath: 'api/chat' })).toThrow(TypeError);
    expect(() => createChatHandler({ bots: [bot], basePath: '/api/chat/' })).toThrow(TypeError);
  });

  it('serves a custom basePath', async () => {
    const { GET } = createChatHandler({ bots: [bot], basePath: '/support/chat' });
    const response = await GET(new Request(`${APP}/support/chat/widget.js`));
    expect(response.status).toBe(200);
  });
});

describe('in-memory store warning', () => {
  it('warns in production that the default store is per instance', () => {
    vi.stubEnv('NODE_ENV', 'production');
    createChatHandler({ bots: [bot] });
    expect(warnLog).toHaveBeenCalledOnce();
    expect(String(warnLog.mock.calls[0]?.[0])).toContain('shared store');
  });

  it('stays quiet in production with a shared store', () => {
    vi.stubEnv('NODE_ENV', 'production');
    createChatHandler({ bots: [bot], limits: { store: { ...memoryStore(), shared: true } } });
    expect(warnLog).not.toHaveBeenCalled();
  });

  it('stays quiet outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    createChatHandler({ bots: [bot] });
    expect(warnLog).not.toHaveBeenCalled();
  });
});

describe('secret resolution', () => {
  it('reads CHAT_SECRET from the environment', async () => {
    const { POST } = createChatHandler({ bots: [bot] });
    expect(await accessToken(POST)).toEqual(expect.any(String));
  });

  it('prefers the secret option over the environment', async () => {
    vi.stubEnv('CHAT_SECRET', '');
    const { POST } = createChatHandler({ bots: [bot], secret: SECRET });
    expect(await accessToken(POST)).toEqual(expect.any(String));
  });

  it('reports a missing CHAT_SECRET as bot_unavailable with a fix', async () => {
    vi.stubEnv('CHAT_SECRET', '');
    const reports: ChatErrorReport[] = [];
    const { POST } = createChatHandler({
      bots: [bot],
      onError: (report) => void reports.push(report),
    });
    const response = await POST(post('/session', { botId: 'support' }));
    await settle();
    expect(response.status).toBe(503);
    expect(reports).toEqual([
      expect.objectContaining({
        code: 'bot_unavailable',
        message: expect.stringContaining('CHAT_SECRET is not set'),
      }),
    ]);
  });

  it('reports a weak CHAT_SECRET as a setup error and retries on the next request', async () => {
    vi.stubEnv('CHAT_SECRET', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const reports: ChatErrorReport[] = [];
    const { POST } = createChatHandler({
      bots: [bot],
      onError: (report) => void reports.push(report),
    });
    const response = await POST(post('/session', { botId: 'support' }));
    await settle();
    expect(response.status).toBe(503);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.code).toBe('bot_unavailable');
    expect(reports[0]?.message).toContain('CHAT_SECRET must be at least');
    expect(reports[0]?.cause).toBeInstanceOf(TypeError);

    // The failed token service is not cached: fixing the env takes effect without a restart.
    vi.stubEnv('CHAT_SECRET', SECRET);
    expect(await accessToken(POST)).toEqual(expect.any(String));
  });

  it('accepts tokens signed with a secret listed in CHAT_SECRET_PREVIOUS', async () => {
    const before = createChatHandler({ bots: [bot], secret: OTHER_SECRET });
    const token = await accessToken(before.POST);

    const rotated = createChatHandler({ bots: [bot], previousSecrets: [OTHER_SECRET] });
    const accepted = await chat(rotated.POST, token);
    expect(accepted.at(-1)).toMatchObject({ type: 'message.end' });

    const withoutPrevious = createChatHandler({ bots: [bot] });
    const rejected = await withoutPrevious.POST(
      post('/messages', { botId: 'support', text: 'Hi' }, { authorization: `Bearer ${token}` }),
    );
    expect(rejected.status).toBe(401);
  });

  it('reads previous secrets from a comma-separated CHAT_SECRET_PREVIOUS', async () => {
    const before = createChatHandler({ bots: [bot], secret: OTHER_SECRET });
    const token = await accessToken(before.POST);

    vi.stubEnv('CHAT_SECRET_PREVIOUS', ` , ${OTHER_SECRET} ,`);
    const rotated = createChatHandler({ bots: [bot] });
    const accepted = await chat(rotated.POST, token);
    expect(accepted.at(-1)).toMatchObject({ type: 'message.end' });
  });

  it('builds the gateway once, from OPENAI_API_KEY', async () => {
    const { POST } = createChatHandler({ bots: [bot] });
    const token = await accessToken(POST);
    await chat(POST, token);
    await chat(POST, token);
    expect(mocks.createOpenAIGateway).toHaveBeenCalledOnce();
    expect(mocks.createOpenAIGateway).toHaveBeenCalledWith({ apiKey: 'sk-test-env-key' });
    expect(turns).toHaveLength(2);
  });

  it('prefers the openaiApiKey option over the environment', async () => {
    const { POST } = createChatHandler({ bots: [bot], openaiApiKey: 'sk-test-option-key' });
    await chat(POST, await accessToken(POST));
    expect(mocks.createOpenAIGateway).toHaveBeenCalledWith({ apiKey: 'sk-test-option-key' });
  });

  it('reports a missing OPENAI_API_KEY as bot_unavailable', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const reports: ChatErrorReport[] = [];
    const { POST } = createChatHandler({
      bots: [bot],
      onError: (report) => void reports.push(report),
    });
    const token = await accessToken(POST);
    const response = await POST(
      post('/messages', { botId: 'support', text: 'Hi' }, { authorization: `Bearer ${token}` }),
    );
    await settle();
    expect(mocks.createOpenAIGateway).not.toHaveBeenCalled();
    expect(response.status).toBe(503);
    expect(reports).toContainEqual(
      expect.objectContaining({
        code: 'bot_unavailable',
        message: expect.stringContaining('OPENAI_API_KEY is not set'),
      }),
    );
  });

  it('reports a weak IDENTITY_SECRET as a setup error when a visitor identifies', async () => {
    vi.stubEnv('IDENTITY_SECRET', 'too-short');
    const reports: ChatErrorReport[] = [];
    const { POST } = createChatHandler({
      bots: [bot],
      onError: (report) => void reports.push(report),
    });
    const response = await POST(post('/session', { botId: 'support', identityToken: 'x.y.z' }));
    await settle();
    expect(response.status).toBe(503);
    expect(reports[0]).toMatchObject({ code: 'bot_unavailable' });
    expect(reports[0]?.cause).toBeInstanceOf(TypeError);
  });
});

describe('hook isolation', () => {
  it('finishes the turn when onUsage throws, and logs only the error name', async () => {
    const onUsage = vi.fn(() => {
      throw new Error(`leaked ${VISITOR_TEXT}`);
    });
    const { POST } = createChatHandler({ bots: [bot], onUsage });
    const stream = await chat(POST, await accessToken(POST));
    await settle();
    expect(stream.at(-1)).toMatchObject({ type: 'message.end', reason: 'completed' });
    expect(onUsage).toHaveBeenCalledOnce();
    const lines = errorLog.mock.calls.map((call) => call.join(' '));
    expect(lines).toContain('[askdare] the onUsage hook failed: Error');
    expect(lines.join('\n')).not.toContain(VISITOR_TEXT);
  });

  it('finishes the turn when an async onUsage rejects', async () => {
    const onUsage = vi.fn(async () => {
      throw new RangeError('nope');
    });
    const { POST } = createChatHandler({ bots: [bot], onUsage });
    const stream = await chat(POST, await accessToken(POST));
    await settle();
    expect(stream.at(-1)).toMatchObject({ type: 'message.end' });
    expect(errorLog).toHaveBeenCalledWith('[askdare] the onUsage hook failed: RangeError');
  });

  it('answers the request when onError throws', async () => {
    vi.stubEnv('CHAT_SECRET', '');
    const onError = vi.fn(() => {
      throw new Error('monitoring is down');
    });
    const { POST } = createChatHandler({ bots: [bot], onError });
    const response = await POST(post('/session', { botId: 'support' }));
    await settle();
    expect(response.status).toBe(503);
    expect(onError).toHaveBeenCalledOnce();
    expect(errorLog).toHaveBeenCalledWith('[askdare] the onError hook failed: Error');
  });

  it('ends a failed turn with an error event when onError rejects', async () => {
    runTurn = async () => {
      throw new AskdareError('upstream_error');
    };
    const onError = vi.fn(async () => {
      throw new Error('monitoring is down');
    });
    const { POST } = createChatHandler({ bots: [bot], onError });
    const stream = await chat(POST, await accessToken(POST));
    await settle();
    expect(stream).toContainEqual(
      expect.objectContaining({ type: 'error', code: 'upstream_error' }),
    );
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'upstream_error' }));
    expect(errorLog).toHaveBeenCalledWith('[askdare] the onError hook failed: Error');
  });
});

describe('default error log', () => {
  it('logs the cleaned cause, not the raw one, when there is no onError', async () => {
    const cause = Object.assign(
      new Error(`400 Invalid value for 'input': "${VISITOR_TEXT}". Key sk-proj-abcdefghijkl`),
      { status: 400, requestId: 'req_123', body: { input: VISITOR_TEXT } },
    );
    runTurn = async () => {
      throw new AskdareError('upstream_error', { cause });
    };
    const { POST } = createChatHandler({ bots: [bot] });
    await chat(POST, await accessToken(POST));
    await settle();

    const call = errorLog.mock.calls.find((args) => String(args[0]).includes('upstream_error'));
    expect(call).toBeDefined();
    const [line, logged] = call ?? [];
    expect(String(line)).toMatch(/^\[askdare\] upstream_error: /);
    expect(String(line)).toContain(`(see ${TROUBLESHOOTING})`);
    expect(logged).not.toBe(cause);
    expect(logged).toBeInstanceOf(Error);
    const error = logged as Error & Record<string, unknown>;
    expect(error.message).not.toContain(VISITOR_TEXT);
    expect(error.message).not.toContain('abcdefghijkl');
    expect(error.message).toContain("'input'");
    expect(error['status']).toBe(400);
    expect(error['requestId']).toBe('req_123');
    expect(error['body']).toBeUndefined();
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(VISITOR_TEXT);
  });

  it('logs a setup problem with its explanation and the cleaned string cause', async () => {
    vi.stubEnv('CHAT_SECRET', '');
    const { POST } = createChatHandler({ bots: [bot] });
    await POST(post('/session', { botId: 'support' }));
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringMatching(/^\[askdare\] bot_unavailable: CHAT_SECRET is not set\..*\(see /),
      'CHAT_SECRET is not configured.',
    );
  });

  it('logs one line when the error has no cause', async () => {
    runTurn = async () => {
      throw new AskdareError('upstream_error');
    };
    const { POST } = createChatHandler({ bots: [bot] });
    await chat(POST, await accessToken(POST));
    await settle();
    const call = errorLog.mock.calls.find((args) => String(args[0]).includes('upstream_error'));
    expect(call).toHaveLength(1);
  });
});
