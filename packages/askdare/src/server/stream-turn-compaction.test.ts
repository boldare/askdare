import { describe, expect, it, vi } from 'vitest';
import { type Bot, type BotDefinition, createBot } from '../bot/define-bot';
import { fakeConversations } from '../conversations/testing/fake-store';
import type { AskdareError } from '../errors';
import type {
  CompactionRequest,
  CompactionResult,
  ModelGateway,
  TokenUsage,
  TurnRequest,
  TurnResult,
} from '../gateway';
import { ZERO_USAGE } from '../usage';
import { type StreamTurnOptions, streamTurn } from './stream-turn';
import type { ChatUsageReport } from './usage-report';

/**
 * The compaction after a turn (ADR-0029): when it runs, what it is given, and how it is charged and
 * reported. The gateway is a fake; `openai/compaction.test.ts` covers the request itself.
 */
const usage = (inputTokens: number): TokenUsage => ({
  ...ZERO_USAGE,
  inputTokens,
  outputTokens: 5,
});

const COMPACTED: CompactionResult = {
  outcome: 'compacted',
  usage: { ...ZERO_USAGE, inputTokens: 30_000, cachedInputTokens: 29_000, outputTokens: 900 },
};

function makeBot(definition: Partial<BotDefinition> = {}): Bot {
  return createBot({
    id: 'support',
    model: 'test-model',
    instructions: 'Be brief.',
    limits: { compactAt: 20_000 },
    ...definition,
  });
}

interface Setup {
  /** The input of each model call of the turn. */
  readonly steps?: readonly number[];
  /** The version the turn reports; undefined for a provider store. */
  readonly version?: number | undefined;
  readonly compact?: ((request: CompactionRequest) => Promise<CompactionResult>) | undefined;
}

function gatewayFor(setup: Setup): ModelGateway & { compactions: CompactionRequest[] } {
  const compactions: CompactionRequest[] = [];
  const compact = setup.compact ?? (async () => COMPACTED);
  return {
    compactions,
    uploadFile: async () => 'file-1',
    deleteFiles: async () => {},
    transcribe: async () => ({ text: '', seconds: 0 }),
    diagnose: async () => [],
    runTurn: async (request: TurnRequest): Promise<TurnResult> => {
      let total = ZERO_USAGE;
      for (const input of setup.steps ?? [25_000]) {
        request.onStep?.({ model: 'test-model', usage: usage(input) });
        total = { ...total, inputTokens: total.inputTokens + input };
      }
      request.emit({ type: 'text.delta', messageId: request.messageId, delta: 'Hi!' });
      return {
        reason: 'completed',
        usage: total,
        ...('version' in setup ? { version: setup.version } : { version: 7 }),
      };
    },
    compact: async (request) => {
      compactions.push(request);
      return compact(request);
    },
  };
}

/** Runs a turn to the end of its `waitUntil` work, and returns its report. */
async function run(
  gateway: ModelGateway,
  overrides: Partial<StreamTurnOptions> = {},
): Promise<ChatUsageReport | undefined> {
  let work: Promise<unknown> = Promise.resolve();
  let report: ChatUsageReport | undefined;
  const stream = streamTurn({
    gateway,
    conversations: fakeConversations(),
    owner: 'visitor:visitor-1',
    bot: makeBot(),
    text: 'Hello',
    context: { locale: 'en' },
    visitorId: 'visitor-1',
    signal: new AbortController().signal,
    issueResumeToken: async (id) => `resume:${id}`,
    pseudonym: async (value) => `hmac(${value})`,
    onError: () => {},
    report: (value) => {
      report = value;
    },
    waitUntil: (promise) => {
      work = promise;
    },
    ...overrides,
  });
  for await (const _ of stream) {
    // Drain.
  }
  await work;
  return report;
}

describe('compaction after a turn', () => {
  it('compacts once the last model call reached compactAt, with the turn’s identity and version', async () => {
    const gateway = gatewayFor({ steps: [5_000, 20_000] });
    const report = await run(gateway);

    expect(gateway.compactions).toHaveLength(1);
    expect(gateway.compactions[0]).toMatchObject({
      conversationId: 'conv_new',
      version: 7,
      context: { locale: 'en' },
      safetyIdentifier: 'hmac(visitor-1)',
    });
    expect(report?.compaction).toEqual({
      outcome: 'compacted',
      usage: COMPACTED.usage,
      durationMs: expect.any(Number),
    });
    // Apart from the turn's own usage.
    expect(report?.usage.inputTokens).toBe(25_000);
  });

  it('compares the last call only, not the turn’s sum', async () => {
    const gateway = gatewayFor({ steps: [15_000, 19_999] });
    const report = await run(gateway);
    expect(gateway.compactions).toHaveLength(0);
    expect(report?.compaction).toBe(undefined);
  });

  it('does nothing without compactAt', async () => {
    const gateway = gatewayFor({ steps: [200_000] });
    const report = await run(gateway, { bot: makeBot({ limits: {} }) });
    expect(gateway.compactions).toHaveLength(0);
    expect(report).not.toHaveProperty('compaction');
  });

  it('does nothing when the provider keeps the conversation (no version)', async () => {
    const gateway = gatewayFor({ steps: [200_000], version: undefined });
    await run(gateway);
    expect(gateway.compactions).toHaveLength(0);
  });

  it('runs after the stream closed and the conversation’s lock was released', async () => {
    const order: string[] = [];
    const gateway = gatewayFor({
      compact: async () => {
        order.push('compact');
        return COMPACTED;
      },
    });
    const conversations = fakeConversations();
    conversations.own('conv_1', { botId: 'support', owner: 'visitor:visitor-1' });
    await run(gateway, {
      conversations,
      conversationId: 'conv_1',
      bot: makeBot({ onOutput: () => ({ action: 'allow' }) }),
      lockConversation: async () => async () => {
        order.push('release');
      },
    });
    expect(order).toEqual(['release', 'compact']);
  });

  it('expects the version after the note of the output checks', async () => {
    const gateway = gatewayFor({ version: 7 });
    const conversations = { ...fakeConversations(), append: async () => 9 };
    await run(gateway, {
      conversations,
      bot: makeBot({ onOutput: () => ({ action: 'allow' }) }),
    });
    expect(gateway.compactions[0]?.version).toBe(9);
  });

  it('skips the compaction when the note could not be stored', async () => {
    const gateway = gatewayFor({ version: 7 });
    const conversations = {
      ...fakeConversations(),
      append: async () => {
        throw new Error('down');
      },
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await run(gateway, {
      conversations,
      bot: makeBot({ onOutput: () => ({ action: 'allow' }) }),
    });
    expect(gateway.compactions).toHaveLength(0);
    vi.restoreAllMocks();
  });

  it('never compacts after a withheld answer that ended the turn with an error', async () => {
    const gateway = gatewayFor({});
    await run(gateway, {
      bot: makeBot({ onOutput: () => ({ action: 'block' }) }),
    });
    expect(gateway.compactions).toHaveLength(0);
  });

  it('holds its budget first and settles it with what it used', async () => {
    const gateway = gatewayFor({ steps: [24_000] });
    const settle = vi.fn(async () => {});
    const reserveCompaction = vi.fn(async () => ({ settle }));
    await run(gateway, { reserveCompaction });
    expect(reserveCompaction).toHaveBeenCalledWith(24_000);
    expect(settle).toHaveBeenCalledWith(COMPACTED.usage);
  });

  it('skips it when a budget can’t cover it', async () => {
    const gateway = gatewayFor({});
    const report = await run(gateway, { reserveCompaction: async () => undefined });
    expect(gateway.compactions).toHaveLength(0);
    expect(report?.compaction).toMatchObject({ outcome: 'skipped', usage: ZERO_USAGE });
  });

  it('reports a failed compaction without its error’s content, and keeps the estimate charged', async () => {
    const errors: AskdareError[] = [];
    const settle = vi.fn(async () => {});
    const gateway = gatewayFor({
      compact: async () => {
        throw new Error('upstream said: visitor text');
      },
    });
    const report = await run(gateway, {
      onError: (error) => errors.push(error),
      reserveCompaction: async () => ({ settle }),
    });
    expect(report?.compaction?.outcome).toBe('failed');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('internal_error');
    expect(errors[0]?.message).not.toContain('visitor text');
    expect(settle).not.toHaveBeenCalled();
  });

  it('reports a dropped compaction as a conflict', async () => {
    const gateway = gatewayFor({
      compact: async () => ({ outcome: 'conflict', usage: COMPACTED.usage }),
    });
    const report = await run(gateway);
    expect(report?.compaction?.outcome).toBe('conflict');
  });
});
