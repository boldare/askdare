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

describe('the browser validator', () => {
  it('agrees with the zod schemas on every event', () => {
    for (const value of [...mutations(VALID_EVENTS), null, 'text', 42, []]) {
      const zod = protocolEventSchema.safeParse(value);
      expect(parseEvent(value), JSON.stringify(value)).toEqual(zod.success ? zod.data : undefined);
    }
  });

  it('agrees with the zod schemas on history', () => {
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
      const zod = historyResponseSchema.safeParse(value);
      expect(parseHistory(value), JSON.stringify(value)).toEqual(
        zod.success ? zod.data : undefined,
      );
    }
  });
});
