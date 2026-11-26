import { describe, expect, it } from 'vitest';
import { defineForm, type FormField } from './define-form';
import { validateForm } from './validate';

const form = defineForm({
  name: 'contact',
  description: 'Contact details.',
  title: 'Contact',
  fields: [
    { name: 'name', type: 'text', label: 'Name', required: true },
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
    },
    { name: 'message', type: 'textarea', label: 'Message' },
    { name: 'consent', type: 'consent', label: 'I agree.', required: true },
  ],
});

const valid = { name: 'Anna', email: 'anna@example.com', consent: true };

/** A form with one field, to test that field alone. */
const single = (field: FormField) =>
  defineForm({ name: 'single', model: false, title: 'T', fields: [field] });

/** The error for one value of a single-field form, or the normalized value. */
function check(field: FormField, value: unknown): unknown {
  const result = validateForm(single(field), value === undefined ? {} : { [field.name]: value });
  return result.ok ? result.values[field.name] : result.fields[field.name];
}

describe('validateForm', () => {
  it('accepts a valid submission and fills in every field', () => {
    expect(validateForm(form, valid)).toEqual({
      ok: true,
      values: {
        name: 'Anna',
        email: 'anna@example.com',
        phone: '',
        topic: '',
        message: '',
        consent: true,
      },
    });
  });

  it('reports every refused field, by error key', () => {
    expect(validateForm(form, { email: 'nope', phone: 'call me', topic: 'other' })).toEqual({
      ok: false,
      fields: {
        name: 'error.form.required',
        email: 'error.form.email',
        phone: 'error.form.phone',
        topic: 'error.form.option',
        consent: 'error.form.required',
      },
    });
  });

  it('never echoes a value in an error', () => {
    const secret = 'secret-value-123';
    const result = validateForm(form, {
      name: `${secret}\u0000`,
      email: secret,
      phone: secret,
      topic: secret,
      message: secret.repeat(1000),
      consent: secret,
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('refuses unknown keys and anything that is not an object', () => {
    expect(validateForm(form, { ...valid, extra: 'x' })).toEqual({ ok: false, fields: {} });
    expect(validateForm(form, JSON.parse('{"__proto__": {"x": 1}, "name": "A"}'))).toEqual({
      ok: false,
      fields: {},
    });
    for (const values of [null, undefined, 'x', 42, [valid], true]) {
      expect(validateForm(form, values)).toEqual({ ok: false, fields: {} });
    }
  });

  it('refuses values of the wrong type', () => {
    expect(validateForm(form, { ...valid, name: 42, phone: null, consent: 'true' })).toEqual({
      ok: false,
      fields: {
        name: 'error.form.invalid',
        phone: 'error.form.invalid',
        consent: 'error.form.invalid',
      },
    });
  });

  describe('text', () => {
    const text: FormField = { name: 'a', type: 'text', label: 'A', required: true };

    it('trims and normalizes to NFC', () => {
      expect(check(text, '  Anna  ')).toBe('Anna');
      expect(check(text, 'Zoé')).toBe('Zoé');
    });

    it('counts characters, up to 200 or maxLength', () => {
      expect(check(text, 'x'.repeat(200))).toBe('x'.repeat(200));
      expect(check(text, 'x'.repeat(201))).toBe('error.form.tooLong');
      expect(check(text, '😀'.repeat(200))).toBe('😀'.repeat(200));
      expect(check({ ...text, maxLength: 5 }, 'abcdef')).toBe('error.form.tooLong');
      expect(check(text, 'x'.repeat(100_000))).toBe('error.form.tooLong');
    });

    it('refuses control and invisible characters, line breaks too', () => {
      for (const bad of ['a\nb', 'a\tb', 'a\u0000b', 'a​b', 'a‮b', 'a b', 'a﻿b']) {
        expect(check(text, bad)).toBe('error.form.invalid');
      }
      // The zero-width joiner holds emoji sequences together.
      expect(check(text, '👩‍💻')).toBe('👩‍💻');
    });

    it('needs a value only when required', () => {
      expect(check(text, undefined)).toBe('error.form.required');
      expect(check(text, '   ')).toBe('error.form.required');
      expect(check({ ...text, required: false }, undefined)).toBe('');
      expect(check({ ...text, required: false }, ' ')).toBe('');
    });
  });

  describe('textarea', () => {
    const textarea: FormField = { name: 'a', type: 'textarea', label: 'A' };

    it('keeps line breaks, as \\n', () => {
      expect(check(textarea, ' one\r\ntwo\rthree\n ')).toBe('one\ntwo\nthree');
    });

    it('refuses other control characters', () => {
      expect(check(textarea, 'a\tb')).toBe('error.form.invalid');
      expect(check(textarea, 'a b')).toBe('error.form.invalid');
    });

    it('allows 2,000 characters, or maxLength', () => {
      expect(check(textarea, 'x'.repeat(2000))).toBe('x'.repeat(2000));
      expect(check(textarea, 'x'.repeat(2001))).toBe('error.form.tooLong');
      expect(check({ ...textarea, maxLength: 10 }, 'x'.repeat(11))).toBe('error.form.tooLong');
    });
  });

  describe('email', () => {
    const email: FormField = { name: 'a', type: 'email', label: 'A', required: true };

    it('accepts addresses and lower-cases only the domain', () => {
      expect(check(email, ' Anna.Nowak+Leads@Example.COM ')).toBe('Anna.Nowak+Leads@example.com');
      expect(check(email, 'jan@sub.example.co.uk')).toBe('jan@sub.example.co.uk');
      expect(check(email, 'zoë@bücher.de')).toBe('zoë@bücher.de');
    });

    it('refuses what is not an address', () => {
      for (const bad of [
        'anna',
        'anna@',
        '@example.com',
        'anna@example',
        'anna@@example.com',
        'an na@example.com',
        'anna@-example.com',
        'anna@example..com',
        'anna@example.c',
        'anna@exa_mple.com',
        `${'x'.repeat(65)}@example.com`,
      ]) {
        expect(check(email, bad)).toBe('error.form.email');
      }
    });

    it('allows 254 characters', () => {
      const long = `a@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.${'e'.repeat(60)}.com`;
      expect(long.length).toBeGreaterThan(245);
      expect(check(email, `${'a'.repeat(254 - long.length + 1)}${long}`)).toBe(
        'error.form.tooLong',
      );
      expect(check(email, `${'a'.repeat(254 - long.length)}${long}`)).not.toBe(
        'error.form.tooLong',
      );
    });
  });

  describe('phone', () => {
    const phone: FormField = { name: 'a', type: 'phone', label: 'A', required: true };

    it('accepts digits, spaces, +, -, ( and ), 6 to 20 characters', () => {
      expect(check(phone, '+48 (12) 345-67-89')).toBe('+48 (12) 345-67-89');
      expect(check(phone, '123456')).toBe('123456');
      expect(check(phone, '1'.repeat(20))).toBe('1'.repeat(20));
    });

    it('refuses anything else', () => {
      for (const bad of ['12345', '+48 123 abc', '123.456.789', '------', '123/456']) {
        expect(check(phone, bad)).toBe('error.form.phone');
      }
      expect(check(phone, '1'.repeat(21))).toBe('error.form.tooLong');
    });
  });

  describe('select', () => {
    const select: FormField = {
      name: 'a',
      type: 'select',
      label: 'A',
      required: true,
      options: [
        { value: 'pricing', label: 'Pricing' },
        { value: 'demo', label: 'Demo' },
      ],
    };

    it('accepts only the values of its options, exactly', () => {
      expect(check(select, 'demo')).toBe('demo');
      for (const bad of ['Demo', ' demo', 'Pricing', 'other']) {
        expect(check(select, bad)).toBe('error.form.option');
      }
    });

    it('needs a value only when required', () => {
      expect(check(select, '')).toBe('error.form.required');
      expect(check(select, undefined)).toBe('error.form.required');
      expect(check({ ...select, required: false }, '')).toBe('');
    });
  });

  describe('consent', () => {
    const consent: FormField = { name: 'a', type: 'consent', label: 'A', required: true };

    it('must be ticked when required', () => {
      expect(check(consent, true)).toBe(true);
      expect(check(consent, false)).toBe('error.form.required');
      expect(check(consent, undefined)).toBe('error.form.required');
    });

    it('may stay unticked otherwise', () => {
      expect(check({ ...consent, required: false }, false)).toBe(false);
      expect(check({ ...consent, required: false }, undefined)).toBe(false);
    });

    it('takes booleans only', () => {
      for (const bad of ['true', 'on', 1]) expect(check(consent, bad)).toBe('error.form.invalid');
    });
  });
});
