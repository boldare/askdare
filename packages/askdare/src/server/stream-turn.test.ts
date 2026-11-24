import { describe, expect, it, vi } from 'vitest';
import { type Bot, createBot } from '../bot/define-bot';
import { type FakeConversations, fakeConversations } from '../conversations/testing/fake-store';
import { AskdareError } from '../errors';
import type { ModelGateway, TurnRequest, TurnResult } from '../gateway';
import type { ProtocolEvent } from '../protocol/events';
import { decodeEvent, SseParser } from '../protocol/sse';
import { STREAM_HEADERS, type StreamTurnOptions, streamTurn } from './stream-turn';
import type { ChatTranscriptReport } from './transcript-report';
import type { ChatUsageReport } from './usage-report';

const bot: Bot = {
  ...createBot({ id: 'support', model: 'test-model', instructions: 'Be brief.' }),
  limits: {
    ...createBot({ id: 'support', model: 'test-model', instructions: 'x' }).limits,
    maxOutputTokens: 256,
    maxInputChars: 1000,
    maxSteps: 3,
    turnTimeoutMs: 5_000,
  },
};

const COMPLETED: TurnResult = {
  reason: 'completed',
  usage: {
    inputTokens: 10,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 5,
    reasoningTokens: 0,
  },
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function fakeGateway(runTurn: (request: TurnRequest) => Promise<TurnResult>): ModelGateway & {
  /** The conversations the turn created, as `bot/owner`. */
  readonly created: string[];
  requests: TurnRequest[];
  conversations: FakeConversations;
} {
  const conversations = fakeConversations();
  const requests: TurnRequest[] = [];
  return {
    get created() {
      return conversations.created.map(({ botId, owner }) => `${botId}/${owner}`);
    },
    requests,
    conversations,
    uploadFile: async () => 'file-1',
    deleteFiles: async () => {},
    transcribe: async () => ({ text: '', seconds: 0 }),
    diagnose: async () => [],
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
  const gateway = overrides.gateway ?? fakeGateway(async () => COMPLETED);
  return {
    gateway,
    conversations:
      (gateway as Partial<ReturnType<typeof fakeGateway>>).conversations ?? fakeConversations(),
    owner: 'visitor:visitor-1',
    bot,
    text: 'Hello',
    context: { locale: 'en' },
    visitorId: 'visitor-1',
    signal: new AbortController().signal,
    issueResumeToken: async (conversationId) => `resume:${conversationId}`,
    pseudonym: async (value) => `hmac(${value})`,
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
    const { raw, events } = await collect(streamTurn(options({ gateway, settle: onUsage })));

    expect(raw.startsWith(': ok\n\n')).toBe(true);
    expect(events).toEqual([
      { type: 'conversation.created', resumeToken: 'resume:conv_new' },
      { type: 'user.ack', messageId: 'id_1' },
      { type: 'message.start', messageId: 'id_2' },
      { type: 'text.delta', messageId: 'id_2', delta: 'Hi!' },
      { type: 'message.end', messageId: 'id_2', reason: 'completed' },
    ]);
    expect(gateway.created).toEqual(['support/visitor:visitor-1']);
    expect(onUsage).toHaveBeenCalledWith(COMPLETED.usage, 'conv_new');
  });

  it('sends the cleaned-up reply options before the end of the answer, or none', async () => {
    const offering = (replies: readonly string[]) =>
      fakeGateway(async () => ({ ...COMPLETED, replies }));
    const { events } = await collect(
      streamTurn(
        options({
          gateway: offering([
            '  Yes,\n book it ',
            'Yes, book it',
            'See https://example.com',
            'x'.repeat(81),
            'Show prices',
            'Talk to a person',
            'Something else',
            'One too many',
          ]),
        }),
      ),
    );
    expect(events.slice(-2)).toEqual([
      {
        type: 'replies',
        messageId: 'id_2',
        items: ['Yes, book it', 'Show prices', 'Talk to a person', 'Something else'],
      },
      { type: 'message.end', messageId: 'id_2', reason: 'completed' },
    ]);
    const none = await collect(
      streamTurn(options({ gateway: offering(['www.example.com', ' ']) })),
    );
    expect(none.events.map((event) => event.type)).not.toContain('replies');
  });

  it('passes at most four UI payloads per answer, each call once, and logs the dropped tool once', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const gateway = fakeGateway(async (request) => {
      for (const callId of ['c1', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6']) {
        request.emit({
          type: 'tool.ui',
          messageId: request.messageId,
          callId,
          name: 'find_slots',
          data: { callId },
        });
      }
      return COMPLETED;
    });
    const { events } = await collect(streamTurn(options({ gateway })));
    expect(events.flatMap((event) => (event.type === 'tool.ui' ? [event.callId] : []))).toEqual([
      'c1',
      'c2',
      'c3',
      'c4',
    ]);
    const drops = logged.mock.calls.filter((args) => String(args[0]).includes('at most 4'));
    expect(drops).toEqual([
      ['[askdare] ui of tool "find_slots" was dropped: an answer shows at most 4.'],
    ]);
    logged.mockRestore();
  });

  it('continues an existing conversation without creating a new one', async () => {
    const gateway = fakeGateway(async () => COMPLETED);
    const { events } = await collect(streamTurn(options({ gateway, conversationId: 'conv_old' })));
    expect(gateway.created).toEqual([]);
    expect(gateway.requests[0]?.conversationId).toBe('conv_old');
    expect(events.map((event) => event.type)).toEqual(['user.ack', 'message.start', 'message.end']);
    // A fresh handle, so an active conversation stays reachable 30 days after its last message.
    expect(events.at(-1)).toMatchObject({ type: 'message.end', resumeToken: 'resume:conv_old' });
  });

  it("passes a pseudonym of the visitor's ID as the safety identifier", async () => {
    const gateway = fakeGateway(async () => COMPLETED);
    await collect(streamTurn(options({ gateway })));
    expect(gateway.requests[0]?.safetyIdentifier).toBe('hmac(visitor-1)');
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
    const failure = new AskdareError('upstream_error', { retryAfterMs: 1000, cause: 'secret' });
    const gateway = fakeGateway(async () => {
      throw failure;
    });
    const { events } = await collect(streamTurn(options({ gateway, onError })));
    expect(events.at(-1)).toEqual({
      type: 'error',
      code: 'upstream_error',
      key: 'error.upstream_error',
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

  it('finishes a started turn after the visitor leaves and reports its real usage', async () => {
    const visitor = new AbortController();
    const onUsage = vi.fn();
    const onError = vi.fn();
    let work: Promise<unknown> | undefined;
    const gateway = fakeGateway(async (request) => {
      visitor.abort();
      await sleep(20);
      expect(request.signal.aborted).toBe(false);
      return {
        ...COMPLETED,
        usage: {
          inputTokens: 40,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 7,
          reasoningTokens: 0,
        },
      };
    });
    const stream = streamTurn(
      options({
        gateway,
        signal: visitor.signal,
        settle: onUsage,
        onError,
        waitUntil: (promise) => {
          work = promise;
        },
      }),
    );
    const reader = stream.getReader();
    await reader.read();
    await reader.cancel();
    await work;
    expect(onUsage).toHaveBeenCalledWith(
      {
        inputTokens: 40,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 7,
        reasoningTokens: 0,
      },
      'conv_new',
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports the turn once its stream has ended: tokens, steps, tools and pseudonyms', async () => {
    const step = { ...COMPLETED.usage, cacheWriteTokens: 3, reasoningTokens: 2 };
    const gateway = fakeGateway(async (request) => {
      request.onStep?.({ model: 'test-model-2026', usage: step });
      request.onToolCall?.({ name: 'lookup', startedAt: 1, durationMs: 4, outcome: 'ok' });
      request.onStep?.({ model: 'test-model-2026', usage: step });
      return COMPLETED;
    });
    const reports: ChatUsageReport[] = [];
    let work: Promise<unknown> | undefined;
    await collect(
      streamTurn(
        options({
          gateway,
          report: (report) => {
            reports.push(report);
          },
          waitUntil: (promise) => {
            work = promise;
          },
        }),
      ),
    );
    await work;
    expect(reports).toEqual([
      {
        bot: 'support',
        model: 'test-model-2026',
        conversation: 'hmac(conversation:conv_new)',
        visitor: 'hmac(visitor-1)',
        startedAt: expect.any(Number),
        durationMs: expect.any(Number),
        outcome: 'completed',
        finishReason: 'completed',
        usage: {
          inputTokens: 20,
          cachedInputTokens: 0,
          cacheWriteTokens: 6,
          outputTokens: 10,
          reasoningTokens: 4,
        },
        steps: 2,
        tools: [{ name: 'lookup', startedAt: 1, durationMs: 4, outcome: 'ok' }],
      },
    ]);
  });

  it('reports a failed turn with what it spent before failing', async () => {
    const gateway = fakeGateway(async (request) => {
      request.onStep?.({ model: undefined, usage: COMPLETED.usage });
      throw new AskdareError('upstream_error');
    });
    const report = vi.fn();
    let work: Promise<unknown> | undefined;
    await collect(
      streamTurn(
        options({
          gateway,
          conversationId: 'conv_old',
          report,
          waitUntil: (promise) => {
            work = promise;
          },
        }),
      ),
    );
    await work;
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'test-model',
        conversation: 'hmac(conversation:conv_old)',
        outcome: 'failed',
        errorCode: 'upstream_error',
        usage: COMPLETED.usage,
        steps: 1,
      }),
    );
    expect(report.mock.calls[0]?.[0]).not.toHaveProperty('finishReason');
  });

  it('logs a failing usage hook by name only and still ends the answer', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let work: Promise<unknown> | undefined;
    const { events } = await collect(
      streamTurn(
        options({
          report: () => {
            throw new TypeError('secret detail');
          },
          waitUntil: (promise) => {
            work = promise;
          },
        }),
      ),
    );
    await work;
    expect(events.at(-1)).toMatchObject({ type: 'message.end' });
    expect(consoleError).toHaveBeenCalledWith('[askdare] the onUsage hook failed: TypeError');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('secret detail');
    consoleError.mockRestore();
  });

  it('reports nothing when the visitor left before anything was spent', async () => {
    const visitor = new AbortController();
    visitor.abort();
    const report = vi.fn();
    let work: Promise<unknown> | undefined;
    await collect(
      streamTurn(
        options({
          signal: visitor.signal,
          report,
          waitUntil: (promise) => {
            work = promise;
          },
        }),
      ),
    );
    await work;
    expect(report).not.toHaveBeenCalled();
  });

  it('calls nothing upstream when the visitor left before the turn started', async () => {
    const visitor = new AbortController();
    visitor.abort();
    const gateway = fakeGateway(async () => COMPLETED);
    await collect(streamTurn(options({ gateway, signal: visitor.signal })));
    expect(gateway.created).toEqual([]);
    expect(gateway.requests).toEqual([]);
  });

  it('deletes a new conversation when the visitor leaves while its handle is issued', async () => {
    const visitor = new AbortController();
    const gateway = fakeGateway(async () => COMPLETED);
    await collect(
      streamTurn(
        options({
          gateway,
          signal: visitor.signal,
          issueResumeToken: async (id) => {
            visitor.abort();
            return `resume:${id}`;
          },
        }),
      ),
    );
    expect(gateway.conversations.deleted).toEqual(['conv_new']);
    expect(gateway.requests).toEqual([]);
  });

  it('still streams when keeping the turn alive is not possible', async () => {
    const { events } = await collect(
      streamTurn(
        options({
          waitUntil: () => {
            throw new Error('after() outside a request scope');
          },
        }),
      ),
    );
    expect(events.at(-1)).toMatchObject({ type: 'message.end' });
  });

  it('deletes a new conversation whose handle never reached the visitor', async () => {
    const visitor = new AbortController();
    const gateway = fakeGateway(async () => COMPLETED);
    const conversations = fakeConversations({
      id: () => {
        visitor.abort();
        return 'conv_orphan';
      },
    });
    await collect(streamTurn(options({ gateway, conversations, signal: visitor.signal })));
    expect(conversations.deleted).toEqual(['conv_orphan']);
    expect(gateway.requests).toEqual([]);
  });

  describe('transcript', () => {
    /** Runs one turn and waits for its after-the-response work, hooks included. */
    async function turn(overrides: Partial<StreamTurnOptions>): Promise<{
      events: ProtocolEvent[];
      reports: ChatTranscriptReport[];
    }> {
      const reports: ChatTranscriptReport[] = [];
      let work: Promise<unknown> | undefined;
      const { events } = await collect(
        streamTurn(
          options({
            transcript: (report) => {
              reports.push(report);
            },
            waitUntil: (promise) => {
              work = promise;
            },
            ...overrides,
          }),
        ),
      );
      await work;
      return { events, reports };
    }

    const answering = fakeGateway(async (request) => {
      request.emit({ type: 'text.delta', messageId: request.messageId, delta: 'See ' });
      request.emit({
        type: 'tool.ui',
        messageId: request.messageId,
        callId: 'c1',
        name: 'card',
        data: {},
      });
      request.emit({ type: 'text.delta', messageId: request.messageId, delta: 'the docs [1].' });
      request.emit({
        type: 'citation',
        messageId: request.messageId,
        index: 1,
        title: 'Docs',
        url: 'https://example.com/docs',
      });
      return { ...COMPLETED, reason: 'max_steps', answerItemId: 'msg_answer', replies: ['More'] };
    });

    it('is called once per turn with the text and the answer the visitor saw', async () => {
      const identity = { id: 'user-7', claims: {} };
      const { reports } = await turn({
        gateway: answering,
        conversationId: 'conv_old',
        text: 'Where are the docs?',
        attachments: [{ fileId: 'file-1', kind: 'image' }],
        context: { locale: 'en', identity },
      });
      expect(reports).toEqual([
        {
          bot: 'support',
          visitor: 'hmac(user:user-7)',
          identity,
          conversationId: 'conv_old',
          itemId: 'msg_answer',
          startedAt: expect.any(Number),
          input: 'Where are the docs?',
          attachments: 1,
          answer: 'See the docs [1].',
          citations: [{ index: 1, title: 'Docs', url: 'https://example.com/docs' }],
          reason: 'max_steps',
        },
      ]);
    });

    it('gives the same start time and visitor as the usage report', async () => {
      const usage: ChatUsageReport[] = [];
      const { reports } = await turn({
        report: (report) => {
          usage.push(report);
        },
      });
      expect(reports[0]).toMatchObject({
        startedAt: usage[0]?.startedAt,
        visitor: usage[0]?.visitor,
        conversationId: 'conv_new',
        answer: '',
        citations: [],
      });
      expect(reports[0]).not.toHaveProperty('identity');
      expect(reports[0]).not.toHaveProperty('check');
    });

    it('still reports the answer of a visitor who left: it is in the conversation', async () => {
      const visitor = new AbortController();
      const gateway = fakeGateway(async (request) => {
        visitor.abort();
        request.emit({ type: 'text.delta', messageId: request.messageId, delta: 'Done.' });
        return COMPLETED;
      });
      const { reports } = await turn({ gateway, signal: visitor.signal });
      expect(reports).toMatchObject([{ answer: 'Done.', reason: 'completed' }]);
    });

    it('is not called for a turn that failed or never started', async () => {
      const failing = fakeGateway(async (request) => {
        request.emit({ type: 'text.delta', messageId: request.messageId, delta: 'Half' });
        throw new AskdareError('upstream_error');
      });
      expect((await turn({ gateway: failing })).reports).toEqual([]);
      const visitor = new AbortController();
      visitor.abort();
      expect((await turn({ signal: visitor.signal })).reports).toEqual([]);
    });

    it("doesn't let a slow hook hold the answer or the conversation", async () => {
      let finish: () => void = () => {};
      const slow = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const released = vi.fn(async () => {});
      let work: Promise<unknown> | undefined;
      const { events } = await collect(
        streamTurn(
          options({
            gateway: answering,
            conversationId: 'conv_old',
            lockConversation: async () => released,
            transcript: () => slow,
            waitUntil: (promise) => {
              work = promise;
            },
          }),
        ),
      );
      expect(events.at(-1)).toMatchObject({ type: 'message.end', reason: 'max_steps' });
      await vi.waitFor(() => expect(released).toHaveBeenCalledOnce());
      finish();
      await work;
    });

    it('reports a throwing hook to onError by its name only, and still ends the answer', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const errors: AskdareError[] = [];
      const usage = vi.fn();
      const { events } = await turn({
        text: 'my secret question',
        transcript: () => {
          throw new RangeError('could not store "my secret question"');
        },
        report: usage,
        onError: (error) => errors.push(error),
      });
      expect(events.at(-1)).toMatchObject({ type: 'message.end' });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ code: 'internal_error' });
      expect(errors[0]?.message).toBe('The onTranscript hook failed: RangeError.');
      expect(errors[0]?.cause).toBeUndefined();
      expect(JSON.stringify([errors, consoleError.mock.calls])).not.toContain('secret');
      // The other hooks still run.
      expect(usage).toHaveBeenCalledOnce();
      consoleError.mockRestore();
    });

    it('runs the turn and the other hooks as before when no hook is set', async () => {
      const usage = vi.fn();
      const { events } = await turn({ gateway: answering, transcript: undefined, report: usage });
      expect(events.at(-1)).toMatchObject({ type: 'message.end' });
      expect(usage).toHaveBeenCalledOnce();
    });

    it('logs a throwing hook by its name only when there is no onError', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      await turn({
        text: 'my secret question',
        onError: undefined,
        transcript: () => {
          throw new TypeError('my secret question');
        },
      });
      expect(consoleError.mock.calls).toEqual([
        ['[askdare] The onTranscript hook failed: TypeError.'],
      ]);
      consoleError.mockRestore();
    });
  });

  it('declares the streaming headers including the protocol version', () => {
    expect(STREAM_HEADERS).toMatchObject({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'x-askdare-protocol': '1',
    });
  });
});
