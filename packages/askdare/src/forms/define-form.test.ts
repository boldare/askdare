import { describe, expect, it } from 'vitest';
import { defineForm, type FormDefinition, type FormField } from './define-form';

const contact = {
  name: 'contact',
  description: 'Contact details for a sales follow-up.',
  title: { en: 'Get an offer', pl: 'Zapytaj o ofertę' },
  fields: [
    { name: 'name', type: 'text', label: { en: 'Name', pl: 'Imię' }, required: true },
    { name: 'email', type: 'email', label: 'Email', required: true },
    { name: 'phone', type: 'phone', label: 'Phone' },
    {
      name: 'topic',
      type: 'select',
      label: 'Topic',
      options: [
        { value: 'pricing', label: 'Pricing' },
        { value: 'demo', label: 'A demo' },
      ],
      toModel: true,
    },
    { name: 'message', type: 'textarea', label: 'Message', maxLength: 500 },
    { name: 'consent', type: 'consent', label: 'I agree to be contacted.', required: true },
  ],
  submit: 'Send',
  done: "Thanks! We'll be in touch.",
} as const satisfies FormDefinition;

/** The message `defineForm` throws for a definition, or undefined when it passes. */
function problem(definition: unknown): string | undefined {
  try {
    defineForm(definition as FormDefinition);
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}

const withField = (field: unknown): unknown => ({ ...contact, fields: [field] });

describe('defineForm', () => {
  it('accepts every field type and fills in the defaults', () => {
    const form = defineForm(contact);
    expect(form.name).toBe('contact');
    expect(form.model).toBe(true);
    expect(form.fields.map((field) => field.type)).toEqual([
      'text',
      'email',
      'phone',
      'select',
      'textarea',
      'consent',
    ]);
    expect(form.fields.map((field) => [field.name, field.required, field.toModel])).toEqual([
      ['name', true, false],
      ['email', true, false],
      ['phone', false, false],
      ['topic', false, true],
      ['message', false, false],
      ['consent', true, false],
    ]);
    expect(
      form.fields.map((field) => ('maxLength' in field ? field.maxLength : undefined)),
    ).toEqual([200, 254, 20, undefined, 500, undefined]);
    expect(Object.isFrozen(form)).toBe(true);
    expect(Object.isFrozen(form.fields[0])).toBe(true);
  });

  it('keeps the literal name for typing', () => {
    const form = defineForm(contact);
    const name: 'contact' = form.name;
    expect(name).toBe('contact');
  });

  it('trims texts and canonicalizes language tags', () => {
    const form = defineForm({
      ...contact,
      description: '  For sales.  ',
      title: { 'PL-pl': ' Oferta ', en: 'Offer' },
    });
    expect(form.description).toBe('For sales.');
    expect(form.title).toEqual({ 'pl-PL': 'Oferta', en: 'Offer' });
  });

  it('needs a description unless the model never sees the form', () => {
    const { description: _, ...rest } = contact;
    expect(problem(rest)).toMatch(/description must tell the model/);
    expect(problem({ ...rest, description: '  ' })).toMatch(/description must tell the model/);
    const handoffOnly = defineForm({ ...rest, model: false });
    expect(handoffOnly.model).toBe(false);
    expect(handoffOnly.description).toBe('');
    expect(problem({ ...contact, description: 'x'.repeat(1001) })).toMatch(/at most 1000/);
  });

  it('refuses bad names, for the form and its fields', () => {
    for (const name of ['', 'Contact', 'con-tact', 'x'.repeat(33), '__proto__', 7]) {
      expect(problem({ ...contact, name })).toMatch(/name must be 1-32 lowercase/);
      expect(problem(withField({ name, type: 'text', label: 'X' }))).toMatch(
        /fields\[0\]\.name must be/,
      );
    }
    expect(problem({ ...contact, name: 'a_1' })).toBeUndefined();
  });

  it('starts a field name with a letter, as the protocol requires', () => {
    for (const name of ['_x', '1a', '_']) {
      expect(problem(withField({ name, type: 'text', label: 'X' }))).toMatch(
        /fields\[0\]\.name must be .*from a letter/,
      );
      // A form's name may start with anything the model can send.
      expect(problem({ ...contact, name })).toBeUndefined();
    }
    expect(problem(withField({ name: 'a_1', type: 'text', label: 'X' }))).toBeUndefined();
  });

  it('refuses a field name used twice', () => {
    const field = { name: 'email', type: 'email', label: 'Email' };
    expect(problem({ ...contact, fields: [field, field] })).toMatch(/"email" is used twice/);
  });

  it('allows 1 to 8 fields', () => {
    const fields = (count: number): FormField[] =>
      Array.from({ length: count }, (_, index) => ({
        name: `f${index}`,
        type: 'text',
        label: `F${index}`,
      }));
    expect(problem({ ...contact, fields: [] })).toMatch(/1 to 8 fields/);
    expect(problem({ ...contact, fields: fields(8) })).toBeUndefined();
    expect(problem({ ...contact, fields: fields(9) })).toMatch(/1 to 8 fields/);
    expect(problem({ ...contact, fields: undefined })).toMatch(/1 to 8 fields/);
  });

  it('refuses a type outside the closed set', () => {
    for (const type of ['date', 'number', 'file', 'TEXT', undefined]) {
      expect(problem(withField({ name: 'x', type, label: 'X' }))).toMatch(
        /type must be one of text, email, phone, select, textarea, consent/,
      );
    }
  });

  it('limits labels, titles, submit and done', () => {
    expect(problem({ ...contact, title: 'x'.repeat(120) })).toBeUndefined();
    expect(problem({ ...contact, title: 'x'.repeat(121) })).toMatch(/title must be at most 120/);
    expect(problem({ ...contact, title: { en: 'ok', pl: 'x'.repeat(121) } })).toMatch(
      /title must be at most 120/,
    );
    expect(problem({ ...contact, submit: 'x'.repeat(121) })).toMatch(/submit must be at most 120/);
    expect(problem({ ...contact, done: 'x'.repeat(300) })).toBeUndefined();
    expect(problem({ ...contact, done: 'x'.repeat(301) })).toMatch(/done must be at most 300/);
    expect(problem(withField({ name: 'x', type: 'text', label: 'x'.repeat(121) }))).toMatch(
      /fields\[0\]\.label must be at most 120/,
    );
    expect(
      problem(withField({ name: 'x', type: 'text', label: 'X', placeholder: 'x'.repeat(121) })),
    ).toMatch(/placeholder must be at most 120/);
    // UTF-16 code units, as the protocol counts them: an emoji is 2.
    expect(problem({ ...contact, title: '😀'.repeat(60) })).toBeUndefined();
    expect(problem({ ...contact, title: '😀'.repeat(61) })).toMatch(/title must be at most 120/);
  });

  it('refuses empty texts and bad language maps', () => {
    expect(problem({ ...contact, title: ' ' })).toMatch(/title must not be empty/);
    expect(problem({ ...contact, title: {} })).toMatch(/title must have at least one language/);
    expect(problem({ ...contact, title: { 'not a tag!': 'x' } })).toMatch(/BCP 47/);
    expect(problem({ ...contact, title: { pl: 'a', PL: 'b' } })).toMatch(/same language twice/);
    expect(problem({ ...contact, title: { en: 'a', pl: '' } })).toMatch(/must not be empty/);
    expect(problem({ ...contact, title: 42 })).toMatch(/must be a string or a map/);
    const many = Object.fromEntries(
      [
        'en',
        'pl',
        'de',
        'fr',
        'es',
        'it',
        'cs',
        'sk',
        'uk',
        'nl',
        'sv',
        'da',
        'nb',
        'fi',
        'pt',
        'ro',
        'hu',
        'el',
        'tr',
        'ja',
        'ko',
      ].map((tag) => [tag, 'x']),
    );
    expect(problem({ ...contact, title: many })).toMatch(/more than 20 languages/);
  });

  it('lets text and textarea lower maxLength, and only them', () => {
    expect(problem(withField({ name: 'x', type: 'text', label: 'X', maxLength: 50 }))).toBe(
      undefined,
    );
    for (const maxLength of [0, 201, 1.5, '50']) {
      expect(problem(withField({ name: 'x', type: 'text', label: 'X', maxLength }))).toMatch(
        /maxLength must be an integer from 1 to 200/,
      );
    }
    expect(
      problem(withField({ name: 'x', type: 'textarea', label: 'X', maxLength: 2001 })),
    ).toMatch(/from 1 to 2000/);
    expect(problem(withField({ name: 'x', type: 'email', label: 'X', maxLength: 50 }))).toMatch(
      /maxLength is not supported by email fields/,
    );
  });

  it('allows placeholders on string fields only', () => {
    expect(
      problem(withField({ name: 'x', type: 'consent', label: 'X', placeholder: 'p' })),
    ).toMatch(/placeholder is not supported by consent fields/);
  });

  it('checks the options of a select', () => {
    const select = (options: unknown): unknown =>
      withField({ name: 'x', type: 'select', label: 'X', options });
    const option = (value: string): unknown => ({ value, label: value });
    expect(problem(select([option('a')]))).toMatch(/2 to 10 options/);
    expect(problem(select(Array.from({ length: 11 }, (_, i) => option(`v${i}`))))).toMatch(
      /2 to 10 options/,
    );
    expect(problem(select(Array.from({ length: 10 }, (_, i) => option(`v${i}`))))).toBe(undefined);
    expect(problem(select([option('a'), option('a')]))).toMatch(/"a" is used twice/);
    expect(problem(select([option('a'), option(' b')]))).toMatch(/without surrounding spaces/);
    expect(problem(select([option('a'), option('x'.repeat(101))]))).toMatch(/1-100 characters/);
    expect(problem(select([option('a'), { value: 'b', label: '' }]))).toMatch(
      /options\[1\]\.label must not be empty/,
    );
    expect(problem(select(undefined))).toMatch(/options must be an array/);
    expect(problem(withField({ name: 'x', type: 'text', label: 'X', options: [] }))).toMatch(
      /options is supported by select fields only/,
    );
  });

  it('checks the flags', () => {
    expect(
      problem(withField({ name: 'x', type: 'text', label: 'X', required: 'yes', toModel: 1 })),
    ).toMatch(/required must be a boolean.*toModel must be a boolean/);
    expect(problem({ ...contact, model: 'no' })).toMatch(/model must be a boolean/);
  });

  it('reports every problem at once, without the model-facing description', () => {
    const message = problem({
      ...contact,
      description: 'secret instructions',
      title: '',
      fields: [{ name: 'X', type: 'date', label: 'X' }],
    });
    expect(message).toMatch(/^\[askdare\] Invalid form "contact": title must not be empty; /);
    expect(message).toMatch(/type must be one of/);
    expect(message).not.toMatch(/secret/);
  });
});
