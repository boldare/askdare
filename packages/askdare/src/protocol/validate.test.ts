import { describe, expect, it } from 'vitest';
import {
  chatFormsSchema,
  formFieldErrorsSchema,
  formRequestSchema,
  formResponseSchema,
  handoffRequestSchema,
  handoffResponseSchema,
  historyResponseSchema,
  protocolEventSchema,
} from './schemas';
import {
  parseEvent,
  parseFormFieldErrors,
  parseFormResponse,
  parseForms,
  parseHandoffResponse,
  parseHistory,
} from './validate';

const VALID_EVENTS: readonly Record<string, unknown>[] = [
  { type: 'conversation.created', resumeToken: 'r' },
  { type: 'user.ack', messageId: 'u1' },
  { type: 'message.start', messageId: 'm1' },
  { type: 'reasoning', messageId: 'm1', state: 'started' },
  { type: 'text.delta', messageId: 'm1', delta: '' },
  { type: 'citation', messageId: 'm1', index: 1, title: 'Pricing' },
  { type: 'citation', messageId: 'm1', index: 2, title: 'Docs', url: 'https://example.com/a?b=1' },
  { type: 'tool.status', messageId: 'm1', callId: 'c1', name: 'get_time', state: 'running' },
  { type: 'replies', messageId: 'm1', items: ['Yes, book it', 'Show prices', 'Talk to a person'] },
  {
    type: 'tool.ui',
    messageId: 'm1',
    callId: 'c1',
    name: 'find_slots',
    data: { slots: [{ at: '9:00', free: true }], note: null },
  },
  { type: 'tool.ui', messageId: 'm1', callId: 'c2', name: 'get-time', data: '9:00' },
  { type: 'handoff', messageId: 'm1', state: 'requested' },
  { type: 'handoff', messageId: 'm1', state: 'limited' },
  { type: 'form', messageId: 'm1', callId: 'c3', name: 'contact', handle: 'h.f', purpose: 'lead' },
  { type: 'form', messageId: 'm1', callId: 'c4', name: 'call_me', handle: 'h', purpose: 'message' },
  { type: 'message.end', messageId: 'm1', reason: 'max_output_tokens' },
  {
    type: 'message.end',
    messageId: 'm1',
    reason: 'completed',
    feedback: { handle: 'h.a.n.d.le', key: '0123456789abcdef' },
  },
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

/** Reply option lists each side must refuse (ADR-0015), or accept exactly as zod does. */
const ODD_REPLIES: readonly unknown[] = [
  [],
  ['One', 'Two', 'Three', 'Four', 'Five'],
  ['Same', 'Same'],
  [' Padded'],
  ['Two\nlines'],
  ['Right-to-left \u202eoverride'],
  // Invisible text that would ride along with a click: tag characters spelling "cancel order",
  // zero-width and byte-order marks, a left-to-right mark, private use.
  [
    `Yes, please${[...'cancel order'].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join('')}`,
  ],
  ['Yes\u200b, please'],
  ['\ufeffYes'],
  ['Yes\u200e'],
  ['Yes \ue000'],
  // An emoji built with the zero-width joiner is fine.
  ['Ask a \ud83d\udc69\u200d\ud83d\udcbb'],
  ['x'.repeat(81)],
  ['x'.repeat(80)],
  ['😀'.repeat(41)],
  [''],
  [42],
  [null],
  'Yes',
  ['See https://example.com'],
  ['Go to www.example.com'],
  ['Visit example.com'],
  ['Email mailto:sales@example.com'],
  ['javascript:alert(1)'],
  ['Call 10.0.0.1'],
  ['[Click](https://evil.example)'],
  ['Yes, please', 'Prices from €9.99', 'e.g. a demo'],
];

const MESSAGE = {
  id: 'm1',
  role: 'assistant',
  text: 'Hi',
  citations: [{ index: 1, title: 'Pricing', url: 'https://example.com' }],
  attachments: 0,
};

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

  it('is never more lenient than zod on reply options', () => {
    for (const items of ODD_REPLIES) {
      const value = { type: 'replies', messageId: 'm1', items };
      expectNoMoreLenient(parseEvent(value), protocolEventSchema.safeParse(value), value);
      const history = { messages: [{ ...MESSAGE, replies: items }] };
      expectNoMoreLenient(parseHistory(history), historyResponseSchema.safeParse(history), history);
    }
    expect(parseEvent({ type: 'replies', messageId: 'm1', items: ['Visit example.com'] })).toBe(
      undefined,
    );
    expect(parseEvent({ type: 'replies', messageId: 'm1', items: ['Same', 'Same'] })).toBe(
      undefined,
    );
    expect(
      parseEvent({ type: 'replies', messageId: 'm1', items: ['Prices from €9.99', 'e.g. a demo'] }),
    ).toEqual({ type: 'replies', messageId: 'm1', items: ['Prices from €9.99', 'e.g. a demo'] });
  });

  it('is never more lenient than zod on tool UI payloads', () => {
    const card = { callId: 'c1', name: 'find_slots', data: { slots: ['9:00'] } };
    let deep: unknown = 'leaf';
    for (let level = 0; level < 9; level += 1) deep = [deep];
    const payloads: unknown[] = [
      card,
      { ...card, data: 'x'.repeat(9000) },
      { ...card, data: deep },
      { ...card, data: null },
      { ...card, data: Number.POSITIVE_INFINITY },
      { ...card, name: 'find slots' },
      { ...card, callId: '' },
    ];
    for (const payload of payloads) {
      const value = { type: 'tool.ui', messageId: 'm1', ...(payload as object) };
      expectNoMoreLenient(parseEvent(value), protocolEventSchema.safeParse(value), value);
      for (const ui of [[payload], [card, card], [card, payload]]) {
        const history = { messages: [{ ...MESSAGE, ui }] };
        expectNoMoreLenient(
          parseHistory(history),
          historyResponseSchema.safeParse(history),
          history,
        );
      }
    }
    const offered = { messages: [{ ...MESSAGE, ui: [card] }] };
    expect(parseHistory(offered)).toEqual(historyResponseSchema.parse(offered));
    expect(parseEvent({ type: 'tool.ui', messageId: 'm1', ...card, extra: 1 })).toEqual({
      type: 'tool.ui',
      messageId: 'm1',
      ...card,
    });
  });

  it('is never more lenient than zod on history, and accepts a valid one', () => {
    const message = MESSAGE;
    const feedback = { handle: 'h.a.n.d.le', key: '0123456789abcdef0123456789abcdef' };
    const values = [
      ...mutations([message, { ...message, feedback }, { ...message, replies: ['Yes', 'No'] }]).map(
        (item) => ({ messages: [item] }),
      ),
      ...mutations([message.citations[0] as Record<string, unknown>]).map((citation) => ({
        messages: [{ ...message, citations: [citation] }],
      })),
      ...mutations([feedback]).map((handle) => ({
        messages: [{ ...message, feedback: handle }],
      })),
      ...mutations([{ messages: [message], before: 'eyJhbGciOiJkaXIifQ.cursor' }]),
      { messages: [message], before: '' },
      { messages: [message], before: 'x'.repeat(4097) },
      { messages: [message], before: null },
      { messages: [{ ...message, feedback: { ...feedback, key: 'ABCDEF0123456789' } }] },
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
    const offered = { messages: [{ ...message, replies: ['Yes', 'No'] }] };
    expect(parseHistory(offered)).toEqual(historyResponseSchema.parse(offered));
    const paged = { messages: [message], before: 'x'.repeat(4096) };
    expect(parseHistory(paged)).toEqual(historyResponseSchema.parse(paged));
  });
});

/** A form as ADR-0031's example describes it, in English. */
const CONTACT = {
  name: 'contact',
  title: 'Get an offer',
  fields: [
    { name: 'name', type: 'text', label: 'Name', required: true, maxLength: 80 },
    {
      name: 'email',
      type: 'email',
      label: 'Email',
      required: true,
      placeholder: 'you@example.com',
    },
    { name: 'phone', type: 'phone', label: 'Phone', required: false },
    {
      name: 'topic',
      type: 'select',
      label: 'Topic',
      required: false,
      options: [
        { value: 'pricing', label: 'Pricing' },
        { value: 'demo', label: 'A demo' },
      ],
    },
    { name: 'message', type: 'textarea', label: 'Message', required: false, maxLength: 2000 },
    { name: 'consent', type: 'consent', label: 'I agree to be contacted.', required: true },
  ],
  submit: 'Send',
  done: "Thanks! We'll be in touch.",
} as const;

const fieldOf = (name: string) =>
  CONTACT.fields.find((field) => field.name === name) as unknown as Record<string, unknown>;

/** The forms in the configuration: the valid one, each field and form mutated, and lists. */
function formLists(): unknown[] {
  const fields = CONTACT.fields as unknown as Record<string, unknown>[];
  const withField = (field: unknown) => [{ ...CONTACT, fields: [field] }];
  const topic = fieldOf('topic');
  const options = topic['options'] as Record<string, unknown>[];
  return [
    [CONTACT],
    ...mutations([CONTACT]).map((form) => [form]),
    ...fields.flatMap((field) => mutations([field]).map(withField)),
    ...mutations(options).map((option) => withField({ ...topic, options: [option, options[1]] })),
    withField({ ...topic, options: [options[0]] }),
    withField({ ...topic, options: [options[0], options[0]] }),
    withField({
      ...topic,
      options: Array.from({ length: 11 }, (_, i) => ({ value: `${i}`, label: 'x' })),
    }),
    // Options and limits that don't belong to the type are dropped, not refused.
    withField({ ...fieldOf('consent'), options, placeholder: 'x', maxLength: 3 }),
    withField({ ...topic, placeholder: 'Pick one', maxLength: 3 }),
    withField({ ...fieldOf('name'), options }),
    withField({ ...fieldOf('name'), maxLength: 201 }),
    withField({ ...fieldOf('email'), maxLength: 254 }),
    withField({ ...fieldOf('phone'), maxLength: 21 }),
    withField({ ...fieldOf('message'), maxLength: 2001 }),
    withField({ ...fieldOf('name'), type: 'date' }),
    withField({ ...fieldOf('name'), name: '__proto__' }),
    withField({ ...fieldOf('name'), name: 'firstName' }),
    withField({ ...fieldOf('name'), label: 'x'.repeat(121) }),
    [{ ...CONTACT, fields: [] }],
    [{ ...CONTACT, fields: [...fields, ...fields.slice(0, 3)] }],
    [{ ...CONTACT, fields: [fields[0], fields[0]] }],
    [{ ...CONTACT, name: 'Contact' }],
    [{ ...CONTACT, name: 'x'.repeat(33) }],
    [{ ...CONTACT, done: 'x'.repeat(300) }],
    [{ ...CONTACT, done: 'x'.repeat(301) }],
    [CONTACT, CONTACT],
    [CONTACT, { ...CONTACT, name: 'callback' }],
    Array.from({ length: 11 }, (_, i) => ({ ...CONTACT, name: `form_${i}` })),
    [],
    CONTACT,
    null,
  ];
}

describe('handoff and forms on the wire', () => {
  it('reads the forms of the public configuration exactly as zod does', () => {
    expect(parseForms([CONTACT])).toEqual([CONTACT]);
    expect(chatFormsSchema.parse([CONTACT])).toEqual([CONTACT]);
    for (const value of formLists()) {
      const ours = parseForms(value);
      const zod = chatFormsSchema.safeParse(value);
      expect(ours !== undefined, JSON.stringify(value)).toBe(zod.success);
      if (ours !== undefined) expect(ours).toEqual(zod.data);
    }
    expect(
      parseForms([{ ...CONTACT, fields: [{ ...fieldOf('consent'), options: [], maxLength: 3 }] }]),
    ).toEqual([{ ...CONTACT, fields: [fieldOf('consent')] }]);
    expect(parseForms([{ ...CONTACT, description: 'For the model', extra: 1 }])).toEqual([CONTACT]);
  });

  it('reads handoff and forms in history no more leniently than zod', () => {
    const form = { callId: 'c1', name: 'contact', purpose: 'lead', state: 'open', handle: 'h' };
    const sent = { callId: 'c2', name: 'contact', purpose: 'handoff', state: 'sent' };
    const handoff = { state: 'sent' };
    const values = [
      ...mutations([{ ...MESSAGE, handoff, forms: [form] }]).map((item) => ({ messages: [item] })),
      ...mutations([form, sent, handoff]).map((item) => ({
        messages: [{ ...MESSAGE, forms: [item], handoff: item }],
      })),
      ...[
        [],
        [form, form],
        [form, sent],
        Array.from({ length: 11 }, (_, i) => ({ ...sent, callId: `${i}` })),
      ].map((forms) => ({ messages: [{ ...MESSAGE, forms }] })),
    ];
    for (const value of values) {
      expectNoMoreLenient(parseHistory(value), historyResponseSchema.safeParse(value), value);
    }
    const page = { messages: [{ ...MESSAGE, handoff, forms: [form, sent] }] };
    expect(parseHistory(page)).toEqual(page);
    expect(parseHistory(page)).toEqual(historyResponseSchema.parse(page));
  });

  it('reads the answers of POST /handoff and POST /forms exactly as zod does', () => {
    const form = { name: 'contact', handle: 'h', purpose: 'handoff' };
    const handoffAnswers = [
      ...mutations([{ state: 'sent' }, { state: 'requested', form }]),
      ...mutations([form]).map((item) => ({ state: 'requested', form: item })),
      { state: 'sent', form },
      { state: 'requested', form: { ...form, purpose: 'lead' } },
      { state: 'requested', form: { ...form, purpose: 'message' } },
      null,
    ];
    for (const value of handoffAnswers) {
      const ours = parseHandoffResponse(value);
      const zod = handoffResponseSchema.safeParse(value);
      expect(ours !== undefined, JSON.stringify(value)).toBe(zod.success);
      if (ours !== undefined) expect(ours).toEqual(zod.data);
    }
    expect(parseHandoffResponse({ state: 'requested', form })).toEqual({
      state: 'requested',
      form,
    });

    const formAnswers = [
      ...mutations([{ state: 'sent' }, { state: 'sent', handoff: 'saved' }]),
      { state: 'sent', handoff: 'requested' },
      { state: 'open' },
      null,
    ];
    for (const value of formAnswers) {
      const ours = parseFormResponse(value);
      const zod = formResponseSchema.safeParse(value);
      expect(ours !== undefined, JSON.stringify(value)).toBe(zod.success);
      if (ours !== undefined) expect(ours).toEqual(zod.data);
    }
  });

  it('reads field errors exactly as zod does, whatever key a later version adds', () => {
    const errors = { email: 'error.form.email', consent: 'error.form.required' };
    const values = [
      errors,
      { email: 'error.form.somethingNew' },
      { email: 'error.network' },
      { email: 'Please enter a valid email: anna@' },
      { email: 1 },
      { '': 'error.form.required' },
      Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`f${i}`, 'error.form.required'])),
      JSON.parse('{"__proto__": "error.form.required"}'),
      {},
      [],
      null,
    ];
    for (const value of values) {
      const ours = parseFormFieldErrors(value);
      const zod = formFieldErrorsSchema.safeParse(value);
      expect(ours !== undefined, JSON.stringify(value)).toBe(zod.success);
      if (ours !== undefined) expect(ours).toEqual(zod.data);
    }
    expect(parseFormFieldErrors(errors)).toEqual(errors);
  });
});

describe('the request schemas', () => {
  it('takes a handoff with the bot and the conversation only', () => {
    const body = { botId: 'support', resumeToken: 'r.t' };
    expect(handoffRequestSchema.parse({ ...body, reason: 'complaint', model: 'x' })).toEqual(body);
    expect(handoffRequestSchema.safeParse({ botId: 'support' }).success).toBe(false);
    expect(handoffRequestSchema.safeParse({ ...body, resumeToken: '' }).success).toBe(false);
  });

  it('takes form values as text or booleans by field name, and nothing that names the form', () => {
    const body = {
      botId: 'support',
      resumeToken: 'r.t',
      form: 'h.f',
      values: { name: 'Anna', email: 'anna@example.com', consent: true },
    };
    expect(formRequestSchema.parse({ ...body, name: 'contact', conversationId: 'c' })).toEqual(
      body,
    );
    const refused = [
      { ...body, form: '' },
      { ...body, form: 'x'.repeat(4097) },
      { ...body, values: [] },
      { ...body, values: { name: 1 } },
      { ...body, values: { name: null } },
      { ...body, values: { name: { first: 'Anna' } } },
      { ...body, values: { name: 'x'.repeat(4001) } },
      { ...body, values: { 'first name': 'Anna' } },
      { ...body, values: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`f${i}`, 'x'])) },
      { botId: 'support', resumeToken: 'r.t', form: 'h.f' },
    ];
    for (const value of refused) {
      expect(formRequestSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
    expect(formRequestSchema.safeParse({ ...body, values: {} }).success).toBe(true);
    // zod drops a `__proto__` key rather than setting the prototype; the form's validation then
    // finds its fields missing.
    const polluted = formRequestSchema.parse({ ...body, values: JSON.parse('{"__proto__": "x"}') });
    expect(polluted.values).toEqual({});
  });
});
