import { describe, expect, it, vi } from 'vitest';
import { type Bot, defineBot } from '../bot/define-bot';
import { ChatdockError } from '../errors';
import type { ModelGateway, TurnRequest, TurnResult } from '../gateway';
import type { ProtocolEvent } from '../protocol/events';
import { decodeEvent, SseParser } from '../protocol/sse';
import { STREAM_HEADERS, type StreamTurnOptions, streamTurn } from './stream-turn';

const bot: Bot = {
  ...defineBot({ id: 'support', model: 'test-model', instructions: 'Be brief.' }),
  limits: {
    ...defineBot({ id: 'support', model: 'test-model', instructions: 'x' }).limits,
    maxOutputTokens: 256,
    maxInputChars: 1000,
    maxSteps: 3,
    turnTimeoutMs: 5_000,
  },
};

const COMPLETED: TurnResult = {
  reason: 'completed',
  usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5 },
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function fakeGateway(runTurn: (request: TurnRequest) => Promise<TurnResult>): ModelGateway & {
  created: string[];
  requests: TurnRequest[];
} {
  const created: string[] = [];
  const requests: TurnRequest[] = [];
  return {
    created,
    requests,
    createConversation: async ({ botId, visitorId }) => {
      created.push(`${botId}/${visitorId}`);
      return 'conv_new';
    },
    deleteConversation: async () => {},
    runTurn: (request) => {
      requests.push(request);
      return runTurn(request);
    },
  };
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<{
  raw: string;
  events: ProtocolEvent[];
}> {
  const decoder = new TextDecoder();
  const parser = new SseParser();
  const events: ProtocolEvent[] = [];
  let raw = '';
  for await (const chunk of stream) {
    const text = decoder.decode(chunk, { stream: true });
    raw += text;
    for (const frame of parser.push(text)) {
      const result = decodeEvent(frame);
      if (result.ok) events.push(result.event);
    }
  }
  return { raw, events };
}

function options(overrides: Partial<StreamTurnOptions> = {}): StreamTurnOptions {
  let id = 0;
  return {
    gateway: fakeGateway(async () => COMPLETED),
    bot,
    text: 'Hello',
    context: { locale: 'en' },
    visitorId: 'visitor-1',
    signal: new AbortController().signal,
    issueResumeToken: async (conversationId) => `resume:${conversationId}`,
    onError: () => {},
    generateId: () => `id_${++id}`,
    ...overrides,
  };
}

describe('streamTurn', () => {
  it('sends a comment before anything else and a full event sequence', async () => {
    const gateway = fakeGateway(async (request) => {
      request.emit({ type: 'text.delta', messageId: request.messageId, delta: 'Hi!' });
      return COMPLETED;
    });
    const onUsage = vi.fn();
    const { raw, events } = await collect(streamTurn(options({ gateway, onUsage })));

    expect(raw.startsWith(': ok\n\n')).toBe(true);
    expect(events).toEqual([
      { type: 'conversation.created', resumeToken: 'resume:conv_new' },
      { type: 'user.ack', messageId: 'id_1' },
      { type: 'message.start', messageId: 'id_2' },
      { type: 'text.delta', messageId: 'id_2', delta: 'Hi!' },
      { type: 'message.end', messageId: 'id_2', reason: 'completed' },
    ]);
    expect(gateway.created).toEqual(['support/visitor-1']);
    expect(onUsage).toHaveBeenCalledWith(COMPLETED.usage);
  });

  it('continues an existing conversation without creating a new one', async () => {
    const gateway = fakeGateway(async () => COMPLETED);
    const { events } = await collect(streamTurn(options({ gateway, conversationId: 'conv_old' })));
    expect(gateway.created).toEqual([]);
    expect(gateway.requests[0]?.conversationId).toBe('conv_old');
    expect(events.map((event) => event.type)).toEqual(['user.ack', 'message.start', 'message.end']);
  });

  it('passes a hashed visitor ID as the safety identifier', async () => {
    const gateway = fakeGateway(async () => COMPLETED);
    await collect(streamTurn(options({ gateway })));
    const safetyIdentifier = gateway.requests[0]?.safetyIdentifier;
    expect(safetyIdentifier).toMatch(/^[0-9a-f]{64}$/);
    expect(safetyIdentifier).not.toContain('visitor-1');
  });

  it('sends heartbeats while the model is slow', async () => {
    const gateway = fakeGateway(async () => {
      await sleep(60);
      return COMPLETED;
    });
    const { raw } = await collect(streamTurn(options({ gateway, heartbeatIntervalMs: 10 })));
    expect(raw.match(/: ping\n\n/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('turns gateway failures into a client-safe error event and reports them', async () => {
    const onError = vi.fn();
    const failure = new ChatdockError('upstream_error', { retryAfterMs: 1000, cause: 'secret' });
    const gateway = fakeGateway(async () => {
      throw failure;
    });
    const { events } = await collect(streamTurn(options({ gateway, onError })));
    expect(events.at(-1)).toEqual({
      type: 'error',
      code: 'upstream_error',
      message: failure.message,
      retryAfterMs: 1000,
    });
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('hides unexpected errors behind internal_error', async () => {
    const gateway = fakeGateway(async () => {
      throw new Error('database password is hunter2');
    });
    const { raw, events } = await collect(streamTurn(options({ gateway })));
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'internal_error' });
    expect(raw).not.toContain('hunter2');
  });

  it('enforces the bot deadline', async () => {
    const gateway = fakeGateway(
      (request) =>
        new Promise((_, reject) => {
          request.signal.addEventListener('abort', () => reject(request.signal.reason));
        }),
    );
    const slowBot: Bot = { ...bot, limits: { ...bot.limits, turnTimeoutMs: 30 } };
    const { events } = await collect(streamTurn(options({ gateway, bot: slowBot })));
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'timeout' });
  });

  it('ends silently when the visitor disconnects', async () => {
    const controller = new AbortController();
    const onError = vi.fn();
    const gateway = fakeGateway(
      (request) =>
        new Promise((_, reject) => {
          request.signal.addEventListener('abort', () => reject(request.signal.reason));
          setTimeout(() => controller.abort(), 10);
        }),
    );
    const { events } = await collect(
      streamTurn(options({ gateway, signal: controller.signal, onError })),
    );
    expect(events.some((event) => event.type === 'error')).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it('declares the streaming headers including the protocol version', () => {
    expect(STREAM_HEADERS).toMatchObject({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'x-chatdock-protocol': '1',
    });
  });
});
