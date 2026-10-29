import { describe, expect, it } from 'vitest';
import { historyResponseSchema, protocolEventSchema } from './schemas';
import { parseEvent, parseHistory } from './validate';

const VALID_EVENTS: readonly Record<string, unknown>[] = [
  { type: 'conversation.created', resumeToken: 'r' },
  { type: 'user.ack', messageId: 'u1' },
  { type: 'message.start', messageId: 'm1' },
  { type: 'reasoning', messageId: 'm1', state: 'started' },
  { type: 'text.delta', messageId: 'm1', delta: '' },
  { type: 'citation', messageId: 'm1', index: 1, title: 'Pricing' },
  { type: 'citation', messageId: 'm1', index: 2, title: 'Docs', url: 'https://example.com/a?b=1' },
  { type: 'tool.status', messageId: 'm1', callId: 'c1', name: 'get_time', state: 'running' },
  { type: 'message.end', messageId: 'm1', reason: 'max_output_tokens' },
  { type: 'error', code: 'rate_limited', message: 'Slow down.', retryAfterMs: 1000 },
  {
    type: 'error',
    code: 'invalid_input',
    message: '',
    key: 'error.tooManyFiles',
    params: { count: 3, unit: 'files' },
  },
];

/** Values each field must be refused or accepted with, exactly as zod decides. */
const ODD_VALUES: readonly unknown[] = [
  undefined,
  null,
  '',
  'x'.repeat(129),
  'x'.repeat(600),
  0,
  -1,
  1.5,
  Number.NaN,
  true,
  [],
  {},
  'javascript:alert(1)',
  'ftp://example.com',
  'http://example.com',
  'not a url',
  'done',
  'internal_error',
  // URLs a browser would take but the protocol doesn't, and length counted in code units.
  'https:a.example',
  'http:/a.example',
  '\u00a0https://a.example',
  'https://a.example\u2028',
  '😀'.repeat(65),
  JSON.parse('{"__proto__": {"polluted": true}}'),
];

/** Every valid sample, then each field of it replaced by every odd value, plus an unknown field. */
function mutations(samples: readonly Record<string, unknown>[]): unknown[] {
  return samples.flatMap((sample) => [
    sample,
    { ...sample, extra: 'ignored' },
    ...Object.keys(sample).flatMap((field) =>
      ODD_VALUES.map((odd) => ({ ...sample, [field]: odd })),
    ),
  ]);
}

/** The browser may refuse more than zod, never accept more, and never change what it accepts. */
function expectNoMoreLenient(
  ours: unknown,
  zod: { success: boolean; data?: unknown },
  value: unknown,
) {
  if (ours !== undefined) expect(zod.success, JSON.stringify(value)).toBe(true);
  if (ours !== undefined) expect(ours, JSON.stringify(value)).toEqual(zod.data);
}

describe('the browser validator', () => {
  it('accepts every valid event exactly as zod does', () => {
    for (const value of VALID_EVENTS) {
      expect(parseEvent(value)).toEqual(protocolEventSchema.parse(value));
    }
  });

  it('is never more lenient than the zod schemas', () => {
    for (const value of [...mutations(VALID_EVENTS), null, 'text', 42, []]) {
      expectNoMoreLenient(parseEvent(value), protocolEventSchema.safeParse(value), value);
    }
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('is never more lenient than zod on history, and accepts a valid one', () => {
    const message = {
      id: 'm1',
      role: 'assistant',
      text: 'Hi',
      citations: [{ index: 1, title: 'Pricing', url: 'https://example.com' }],
      attachments: 0,
    };
    const values = [
      ...mutations([message]).map((item) => ({ messages: [item] })),
      ...mutations([message.citations[0] as Record<string, unknown>]).map((citation) => ({
        messages: [{ ...message, citations: [citation] }],
      })),
      { messages: [] },
      { messages: 'none' },
      {},
    ];
    for (const value of values) {
      expectNoMoreLenient(parseHistory(value), historyResponseSchema.safeParse(value), value);
    }
    expect(parseHistory({ messages: [message] })).toEqual(
      historyResponseSchema.parse({ messages: [message] }),
    );
  });
});
