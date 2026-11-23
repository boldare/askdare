import { afterEach, describe, expect, it, vi } from 'vitest';
import { type BotDefinition, createBot } from '../bot/define-bot';
import { guardNoteAction } from '../conversations/guard-notes';
import { type FakeConversations, fakeConversations } from '../conversations/testing/fake-store';
import { AskdareError } from '../errors';
import type {
  AnswerVerdict,
  ModelGateway,
  ModerationRequest,
  ModerationResult,
  TurnRequest,
  TurnResult,
} from '../gateway';
import type { ProtocolEvent } from '../protocol/events';
import { decodeEvent, SseParser } from '../protocol/sse';
import { type StreamTurnOptions, streamTurn } from './stream-turn';

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

const BASE: BotDefinition = { id: 'support', model: 'test-model', instructions: 'Be brief.' };

interface FakeGateway extends ModelGateway {
  readonly turns: TurnRequest[];
  readonly moderated: ModerationRequest[];
  /** What the turn noted in the conversation (ADR-0022), read back from the appended items. */
  readonly settled: AnswerVerdict[];
  readonly created: number;
  readonly conversations: FakeConversations;
}

/** The verdicts that notes appended to a conversation record. */
function verdictsOf(appended: FakeConversations['appended']): AnswerVerdict[] {
  return appended.flatMap(({ items }): AnswerVerdict[] => {
    const [note, replacement] = items;
    const action =
      note?.type === 'message' && note.role === 'developer' && note.parts[0]?.type === 'text'
        ? guardNoteAction(note.parts[0].text)
        : undefined;
    if (action === 'replaced') {
      const part = replacement?.type === 'message' ? replacement.parts[0] : undefined;
      return [{ action, text: part?.type === 'text' ? part.text : '' }];
    }
    return action ? [{ action }] : [];
  });
}

/** A gateway whose turn streams `chunks`, and whose moderation flags texts containing "bad". */
function fakeGateway(
  chunks: readonly string[] = ['Hello ', 'there.'],
  overrides: Partial<ModelGateway> = {},
): FakeGateway {
  const turns: TurnRequest[] = [];
  const moderated: ModerationRequest[] = [];
  const conversations = fakeConversations();
  return {
    turns,
    moderated,
    get settled() {
      return verdictsOf(conversations.appended);
    },
    get created() {
      return conversations.created.length;
    },
    conversations,
    uploadFile: async () => 'file-1',
    deleteFiles: async () => {},
    transcribe: async () => ({ text: '', seconds: 0 }),
    diagnose: async () => [],
    runTurn: async (request) => {
      turns.push(request);
      request.emit({ type: 'reasoning', messageId: request.messageId, state: 'started' });
      for (const delta of chunks) {
        request.emit({ type: 'text.delta', messageId: request.messageId, delta });
      }
      request.emit({ type: 'citation', messageId: request.messageId, index: 1, title: 'Doc' });
      return { ...COMPLETED, answerItemId: 'msg_answer' };
    },
    moderate: async (request): Promise<ModerationResult> => {
      moderated.push(request);
      const hits = request.input.some((text) => text.includes('bad'));
      return { flagged: hits, categories: hits ? ['harassment'] : [] };
    },
    ...overrides,
  };
}

async function run(
  definition: Partial<BotDefinition>,
  gateway: FakeGateway,
  overrides: Partial<StreamTurnOptions> = {},
): Promise<{ events: ProtocolEvent[]; errors: AskdareError[] }> {
  let id = 0;
  const errors: AskdareError[] = [];
  const stream = streamTurn({
    gateway,
    conversations: gateway.conversations,
    owner: 'visitor:visitor-1',
    bot: createBot({ ...BASE, ...definition }),
    text: 'Hello',
    context: { locale: 'en' },
    visitorId: 'visitor-1',
    signal: new AbortController().signal,
    issueResumeToken: async (conversationId) => `resume:${conversationId}`,
    pseudonym: async (value) => `hmac(${value})`,
    onError: (error) => errors.push(error),
    generateId: () => `id_${++id}`,
    ...overrides,
  });
  const decoder = new TextDecoder();
  const parser = new SseParser();
  const events: ProtocolEvent[] = [];
  for await (const chunk of stream) {
    for (const frame of parser.push(decoder.decode(chunk, { stream: true }))) {
      const result = decodeEvent(frame);
      if (result.ok) events.push(result.event);
    }
  }
  return { events, errors };
}

const textOf = (events: readonly ProtocolEvent[]): string =>
  events.flatMap((event) => (event.type === 'text.delta' ? [event.delta] : [])).join('');
const errorOf = (events: readonly ProtocolEvent[]) =>
  events.find((event) => event.type === 'error');

const errorSpy = () => vi.spyOn(console, 'error').mockImplementation(() => {});
afterEach(() => vi.restoreAllMocks());

describe('a bot without guardrails', () => {
  it('resolves every option off', () => {
    expect(createBot(BASE).guardrails).toEqual({
      moderation: undefined,
      onInput: undefined,
      onOutput: undefined,
      toolResults: 'trusted',
    });
  });

  it('streams exactly as in 0.4: text as it comes, no moderation, nothing noted', async () => {
    const gateway = fakeGateway();
    const { events } = await run({}, gateway);
    expect(events.map((event) => event.type)).toEqual([
      'conversation.created',
      'user.ack',
      'message.start',
      'reasoning',
      'text.delta',
      'text.delta',
      'citation',
      'message.end',
    ]);
    expect(gateway.turns[0]?.text).toBe('Hello');
    expect(gateway.moderated).toEqual([]);
    expect(gateway.settled).toEqual([]);
  });

  it('streams each delta before the turn ends', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: string[] = [];
    const gateway = fakeGateway([], {
      runTurn: async (request) => {
        request.emit({ type: 'text.delta', messageId: request.messageId, delta: 'early' });
        await gate;
        return COMPLETED;
      },
    });
    const stream = streamTurn({
      gateway,
      conversations: gateway.conversations,
      owner: 'visitor:v',
      bot: createBot(BASE),
      text: 'Hi',
      context: { locale: 'en' },
      visitorId: 'v',
      signal: new AbortController().signal,
      issueResumeToken: async () => 'r',
      pseudonym: async (value) => value,
      onError: () => {},
    });
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    while (!seen.join('').includes('early')) {
      const { value } = await reader.read();
      seen.push(decoder.decode(value));
    }
    release();
    await reader.cancel();
  });
});

describe('onInput', () => {
  it('passes the message on when the hook allows it, or returns nothing', async () => {
    for (const verdict of [{ action: 'allow' } as const, undefined]) {
      const gateway = fakeGateway();
      const onInput = vi.fn(() => verdict);
      const { events } = await run({ onInput }, gateway);
      expect(onInput).toHaveBeenCalledWith('Hello', {
        bot: 'support',
        locale: 'en',
        identity: undefined,
      });
      expect(gateway.turns[0]?.text).toBe('Hello');
      expect(events.at(-1)?.type).toBe('message.end');
    }
  });

  it("blocks the turn before a conversation exists, with the hook's text", async () => {
    const gateway = fakeGateway();
    const { events, errors } = await run(
      { onInput: () => ({ action: 'block', message: 'Please keep it about our products.' }) },
      gateway,
    );
    expect(events).toEqual([
      {
        type: 'error',
        code: 'content_blocked',
        message: 'Please keep it about our products.',
      },
    ]);
    expect(gateway.created).toBe(0);
    expect(gateway.turns).toEqual([]);
    // The report names the check, never the message.
    expect(errors[0]?.code).toBe('content_blocked');
    expect(String(errors[0]?.cause)).toBe('input blocked by onInput');
    expect(String(errors[0]?.cause)).not.toContain('Hello');
  });

  it('blocks with the translated default text when the hook gives none', async () => {
    const { events } = await run({ onInput: () => ({ action: 'block' }) }, fakeGateway());
    expect(errorOf(events)).toMatchObject({
      code: 'content_blocked',
      key: 'error.content_blocked',
    });
  });

  it('sends the redacted text to the model instead of the original', async () => {
    const gateway = fakeGateway();
    await run(
      {
        onInput: (text) => ({
          action: 'redact',
          text: text.replace(/\d{4}-\d{4}/, '[card]'),
        }),
      },
      gateway,
      { text: 'My card is 1234-5678' },
    );
    expect(gateway.turns[0]?.text).toBe('My card is [card]');
  });

  it('blocks a message redacted to nothing', async () => {
    const gateway = fakeGateway();
    const { events } = await run({ onInput: () => ({ action: 'redact', text: ' ' }) }, gateway);
    expect(errorOf(events)?.code).toBe('content_blocked');
    expect(gateway.turns).toEqual([]);
  });

  it('lets the message through when the hook throws or returns nonsense, logging only its name', async () => {
    const log = errorSpy();
    for (const onInput of [
      () => {
        throw new RangeError('secret visitor text');
      },
      async () => Promise.reject(new Error('secret')),
      () => ({ action: 'shrug' }) as never,
    ]) {
      const gateway = fakeGateway();
      const { events } = await run({ onInput }, gateway);
      expect(gateway.turns[0]?.text).toBe('Hello');
      expect(events.at(-1)?.type).toBe('message.end');
    }
    const lines = log.mock.calls.map((call) => call.join(' '));
    expect(lines).toEqual([
      '[askdare] the onInput hook failed, so the message passed: RangeError',
      '[askdare] the onInput hook failed, so the message passed: Error',
      '[askdare] the onInput hook returned no valid verdict, so the message passed.',
    ]);
    expect(lines.join('\n')).not.toContain('secret');
  });

  it("doesn't call the hook for a message with only files", async () => {
    const onInput = vi.fn(() => ({ action: 'block' }) as const);
    const gateway = fakeGateway();
    await run({ onInput }, gateway, {
      text: '',
      attachments: [{ fileId: 'file_1', kind: 'image' }],
    });
    expect(onInput).not.toHaveBeenCalled();
    expect(gateway.turns).toHaveLength(1);
  });
});

describe('onOutput', () => {
  it('holds the answer back until it is checked, then sends it whole', async () => {
    const onOutput = vi.fn(() => ({ action: 'allow' }) as const);
    const gateway = fakeGateway();
    const { events } = await run({ onOutput }, gateway);
    expect(onOutput).toHaveBeenCalledWith(
      'Hello there.',
      expect.objectContaining({ bot: 'support' }),
    );
    // Progress still streams; the content comes after the check, in its order.
    expect(events.map((event) => event.type)).toEqual([
      'conversation.created',
      'user.ack',
      'message.start',
      'reasoning',
      'text.delta',
      'text.delta',
      'citation',
      'message.end',
    ]);
    expect(textOf(events)).toBe('Hello there.');
    // History shows it once this note is stored (ADR-0022).
    expect(gateway.settled).toEqual([{ action: 'allowed' }]);
  });

  it('holds back every delta while the turn runs', async () => {
    const emitted: ProtocolEvent['type'][] = [];
    let finish: () => void = () => {};
    const gateway = fakeGateway([], {
      runTurn: async (request) => {
        request.emit({ type: 'reasoning', messageId: request.messageId, state: 'started' });
        request.emit({ type: 'text.delta', messageId: request.messageId, delta: 'Secret' });
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return COMPLETED;
      },
    });
    const stream = streamTurn({
      gateway,
      conversations: gateway.conversations,
      owner: 'visitor:v',
      bot: createBot({ ...BASE, onOutput: () => undefined }),
      text: 'Hi',
      context: { locale: 'en' },
      visitorId: 'v',
      signal: new AbortController().signal,
      issueResumeToken: async () => 'r',
      pseudonym: async (value) => value,
      onError: () => {},
    });
    const reader = stream.getReader();
    const parser = new SseParser();
    const decoder = new TextDecoder();
    while (!emitted.includes('reasoning')) {
      const { value } = await reader.read();
      for (const frame of parser.push(decoder.decode(value))) {
        const result = decodeEvent(frame);
        if (result.ok) emitted.push(result.event.type);
      }
    }
    expect(emitted).not.toContain('text.delta');
    finish();
    await reader.cancel();
  });

  it('blocks the answer: no text reaches the client, and the conversation notes it', async () => {
    const settle = vi.fn();
    const gateway = fakeGateway();
    const { events, errors } = await run(
      { onOutput: () => ({ action: 'block', message: 'I can’t help with that here.' }) },
      gateway,
      { settle },
    );
    expect(events.some((event) => event.type === 'text.delta' || event.type === 'citation')).toBe(
      false,
    );
    expect(errorOf(events)).toEqual({
      type: 'error',
      code: 'content_blocked',
      message: 'I can’t help with that here.',
    });
    expect(gateway.settled).toEqual([{ action: 'withheld' }]);
    // The tokens were spent all the same.
    expect(settle).toHaveBeenCalledOnce();
    expect(String(errors[0]?.cause)).toBe('output blocked by onOutput');
  });

  it('sends the redacted answer in place of the original, and notes it', async () => {
    const gateway = fakeGateway(['Call me at ', '555-0100.']);
    const { events } = await run(
      { onOutput: (text) => ({ action: 'redact', text: text.replace(/\d{3}-\d{4}/, '[phone]') }) },
      gateway,
    );
    expect(textOf(events)).toBe('Call me at [phone].');
    expect(events.filter((event) => event.type === 'text.delta')).toHaveLength(1);
    expect(events.some((event) => event.type === 'citation')).toBe(true);
    expect(events.at(-1)?.type).toBe('message.end');
    expect(gateway.settled).toEqual([{ action: 'replaced', text: 'Call me at [phone].' }]);
  });

  it('drops the cards, reply options and rating handle of a redacted answer', async () => {
    const turn = async (request: TurnRequest): Promise<TurnResult> => {
      request.emit({ type: 'text.delta', messageId: request.messageId, delta: 'Secret 42' });
      request.emit({
        type: 'tool.ui',
        messageId: request.messageId,
        callId: 'call_1',
        name: 'order',
        data: { code: 42 },
      });
      request.emit({ type: 'citation', messageId: request.messageId, index: 1, title: 'Doc' });
      return { ...COMPLETED, answerItemId: 'msg_answer', replies: ['Show 42'] };
    };
    const issueFeedback = vi.fn(async () => ({ handle: 'h', key: 'ab'.repeat(8) }));
    const redacted = await run(
      { onOutput: () => ({ action: 'redact', text: 'Secret [hidden]' }) },
      fakeGateway([], { runTurn: turn }),
      { issueFeedback },
    );
    expect(redacted.events.map((event) => event.type)).toEqual([
      'conversation.created',
      'user.ack',
      'message.start',
      'text.delta',
      'citation',
      'message.end',
    ]);
    expect(issueFeedback).not.toHaveBeenCalled();
    // An allowed answer keeps them.
    const allowed = await run({ onOutput: () => undefined }, fakeGateway([], { runTurn: turn }), {
      issueFeedback,
    });
    expect(allowed.events.map((event) => event.type)).toEqual([
      'conversation.created',
      'user.ack',
      'message.start',
      'text.delta',
      'tool.ui',
      'citation',
      'replies',
      'message.end',
    ]);
    expect(issueFeedback).toHaveBeenCalledOnce();
  });

  it('lets the answer through when the hook throws', async () => {
    const log = errorSpy();
    const { events } = await run(
      {
        onOutput: () => {
          throw new TypeError('boom');
        },
      },
      fakeGateway(),
    );
    expect(textOf(events)).toBe('Hello there.');
    expect(log).toHaveBeenCalledWith(
      '[askdare] the onOutput hook failed, so the message passed: TypeError',
    );
  });

  it('still ends the turn when noting the verdict fails', async () => {
    const log = errorSpy();
    const gateway = fakeGateway(['x']);
    gateway.conversations.append = async () => {
      throw new Error('down');
    };
    const { events } = await run({ onOutput: () => ({ action: 'block' }) }, gateway);
    expect(errorOf(events)?.code).toBe('content_blocked');
    expect(log).toHaveBeenCalledWith(
      '[askdare] could not note the checked answer in the conversation, so a reload hides it: Error',
    );
  });
});

describe('moderation', () => {
  it('is off unless configured', async () => {
    const gateway = fakeGateway(['bad words']);
    const { events } = await run({}, gateway, { text: 'bad question' });
    expect(gateway.moderated).toEqual([]);
    expect(textOf(events)).toBe('bad words');
  });

  it('checks input by default, with the configured model and the page description', async () => {
    const gateway = fakeGateway(['bad words']);
    const { events } = await run({ moderation: { model: 'omni-moderation-latest' } }, gateway, {
      pageContext: 'Pricing page',
    });
    expect(gateway.moderated.map(({ model, input }) => ({ model, input }))).toEqual([
      { model: 'omni-moderation-latest', input: ['Hello', 'Pricing page'] },
    ]);
    // Output isn't checked, so it streams as before.
    expect(textOf(events)).toBe('bad words');
  });

  it('blocks a flagged message before the model sees it', async () => {
    const gateway = fakeGateway();
    const { events, errors } = await run(
      { moderation: { model: 'omni-moderation-latest', message: 'Let’s keep it friendly.' } },
      gateway,
      { text: 'a bad message' },
    );
    expect(events).toEqual([
      { type: 'error', code: 'content_blocked', message: 'Let’s keep it friendly.' },
    ]);
    expect(gateway.turns).toEqual([]);
    expect(String(errors[0]?.cause)).toBe('input blocked by moderation (harassment)');
  });

  it('blocks only the configured categories', async () => {
    const gateway = fakeGateway();
    const { events } = await run(
      { moderation: { model: 'omni-moderation-latest', categories: ['self-harm/intent'] } },
      gateway,
      { text: 'a bad message' },
    );
    expect(gateway.turns).toHaveLength(1);
    expect(events.at(-1)?.type).toBe('message.end');
  });

  it('checks the answer, and its reply options, when output is on', async () => {
    const gateway = fakeGateway(['some bad ', 'answer'], {});
    const { events } = await run(
      { moderation: { model: 'omni-moderation-latest', check: 'output' } },
      gateway,
      { text: 'innocent bad question' },
    );
    expect(gateway.moderated.map((request) => request.input)).toEqual([['some bad answer']]);
    expect(textOf(events)).toBe('');
    expect(errorOf(events)?.code).toBe('content_blocked');
    expect(gateway.settled).toEqual([{ action: 'withheld' }]);
  });

  it('checks both, and moderates the text a hook redacted', async () => {
    const gateway = fakeGateway(['fine answer']);
    await run(
      {
        moderation: { model: 'omni-moderation-latest', check: 'both' },
        onInput: () => ({ action: 'redact', text: 'cleaned' }),
      },
      gateway,
      { text: 'bad' },
    );
    expect(gateway.moderated.map((request) => request.input)).toEqual([
      ['cleaned'],
      ['fine answer'],
    ]);
    expect(gateway.turns[0]?.text).toBe('cleaned');
  });

  it('lets the message through when moderation fails, logging only the code', async () => {
    const log = errorSpy();
    const gateway = fakeGateway(['ok'], {
      moderate: async () => {
        throw new Error('network down: bad message');
      },
    });
    const { events } = await run({ moderation: { model: 'm', check: 'both' } }, gateway, {
      text: 'bad',
    });
    expect(textOf(events)).toBe('ok');
    expect(log).toHaveBeenCalledWith('[askdare] moderation failed, so the message passed: Error');
  });

  it('validates its settings', () => {
    expect(() => createBot({ ...BASE, moderation: { model: '' } })).toThrow(
      /moderation\.model is required/,
    );
    expect(() => createBot({ ...BASE, moderation: { model: 'm', check: 'all' as never } })).toThrow(
      /moderation\.check/,
    );
    expect(() => createBot({ ...BASE, onInput: 'no' as never })).toThrow(
      /onInput must be a function/,
    );
    expect(() => createBot({ ...BASE, toolResults: 'maybe' as never })).toThrow(/toolResults/);
    expect(
      createBot({ ...BASE, moderation: { model: ' m ', check: 'output' } }).guardrails,
    ).toMatchObject({
      moderation: { model: 'm', input: false, output: true, categories: undefined },
    });
  });
});

describe('one turn at a time per conversation', () => {
  it('takes a resumed conversation before the turn and releases it after', async () => {
    const order: string[] = [];
    const gateway = fakeGateway(['ok'], {
      runTurn: async (request) => {
        order.push('turn');
        request.emit({ type: 'text.delta', messageId: request.messageId, delta: 'ok' });
        return COMPLETED;
      },
    });
    await run({ onOutput: () => undefined }, gateway, {
      conversationId: 'conv_old',
      lockConversation: async (id) => {
        order.push(`lock ${id}`);
        return async () => {
          order.push(`release ${id}`);
        };
      },
    });
    await vi.waitFor(() => expect(order).toEqual(['lock conv_old', 'turn', 'release conv_old']));
  });

  it('takes a new conversation before its handle reaches the client', async () => {
    const seen: string[] = [];
    const { events } = await run({ onOutput: () => undefined }, fakeGateway(), {
      issueResumeToken: async (id) => {
        seen.push('token');
        return `resume:${id}`;
      },
      lockConversation: async (id) => {
        seen.push(`lock ${id}`);
        return async () => {};
      },
    });
    expect(seen.slice(0, 2)).toEqual(['lock conv_new', 'token']);
    expect(events[0]?.type).toBe('conversation.created');
  });

  it('refuses a second turn while one holds the conversation', async () => {
    const gateway = fakeGateway();
    const { events } = await run({ onOutput: () => undefined }, gateway, {
      conversationId: 'conv_busy',
      lockConversation: async () => {
        throw new AskdareError('rate_limited', { key: 'error.rate_limited', message: 'Wait.' });
      },
    });
    expect(errorOf(events)).toMatchObject({ code: 'rate_limited', key: 'error.rate_limited' });
    expect(gateway.turns).toEqual([]);
  });
});
