import { z } from 'zod';
import { type Form, type FormFieldSpec, PHONE_MIN_LENGTH } from './define-form';

/*
 * Validation of a submitted form on the server (ADR-0031), with Zod, from the form's definition.
 * The widget checks the same rules by hand first, for quick errors; this is the authority. Errors
 * name a field and a text key, never the value.
 */

/** Why a field was refused: a key of the chat's texts. */
export const FORM_ERROR_KEYS = [
  'error.form.required',
  'error.form.email',
  'error.form.phone',
  'error.form.tooLong',
  'error.form.option',
  /** Not a string (or a boolean for `consent`), or control or invisible characters. */
  'error.form.invalid',
] as const;
export type FormErrorKey = (typeof FORM_ERROR_KEYS)[number];

/** Validated values by field name: every field of the form, `''` or `false` when left empty. */
export type FormValues = Readonly<Record<string, string | boolean>>;

export type FormValidation =
  | { readonly ok: true; readonly values: FormValues }
  /**
   * `fields` maps each refused field to its error. It is empty when the values weren't an object
   * of this form's fields at all (unknown keys, not an object), which no widget sends.
   */
  | { readonly ok: false; readonly fields: Readonly<Record<string, FormErrorKey>> };

/**
 * Control and format characters (zero-width, bidirectional overrides) and line or paragraph
 * separators. The zero-width joiner stays: emoji sequences need it.
 */
const INVISIBLE = /(?!‍)[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
/** The same, but line breaks are allowed: a `textarea` has several lines. */
const INVISIBLE_BUT_LINE_BREAKS = /(?![\n‍])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const PHONE = /^[0-9 +\-()]+$/;
/**
 * One `@`, a local part without spaces, and a domain of dot-separated labels with a final label
 * of at least two letters. Internationalized addresses pass; the receiver's CRM has the last word.
 */
const EMAIL =
  /^[^\s@]{1,64}@(?=.{1,253}$)(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+\p{L}{2,63}$/u;

const length = (value: string): number => [...value].length;

/** Any key; Zod reads the message as the error key. */
const fail = (context: z.RefinementCtx, key: FormErrorKey): never => {
  context.addIssue({ code: 'custom', message: key });
  return z.NEVER;
};

/** The value trimmed and in NFC, or the error key. */
function normalizeString(
  raw: string,
  field: FormFieldSpec & { readonly maxLength: number },
): { readonly value: string; readonly error?: undefined } | { readonly error: FormErrorKey } {
  // Refuse a huge value before normalizing it: NFC can grow a string, but not by this much.
  if (raw.length > field.maxLength * 4 + 64) return { error: 'error.form.tooLong' as const };
  const lines = field.type === 'textarea' ? raw.replace(/\r\n?/g, '\n') : raw;
  const value = lines.normalize('NFC').trim();
  const invisible = field.type === 'textarea' ? INVISIBLE_BUT_LINE_BREAKS : INVISIBLE;
  if (invisible.test(value)) return { error: 'error.form.invalid' as const };
  if (length(value) > field.maxLength) return { error: 'error.form.tooLong' as const };
  return { value };
}

/** The email with its domain lower-cased; the local part is the receiver's to interpret. */
function normalizeEmail(value: string): string {
  const at = value.lastIndexOf('@');
  return `${value.slice(0, at)}@${value.slice(at + 1).toLowerCase()}`;
}

function fieldSchema(field: FormFieldSpec): z.ZodType<string | boolean> {
  return z.unknown().transform((raw, context): string | boolean => {
    if (field.type === 'consent') {
      if (raw === undefined) return field.required ? fail(context, 'error.form.required') : false;
      if (typeof raw !== 'boolean') return fail(context, 'error.form.invalid');
      return raw || (field.required ? fail(context, 'error.form.required') : false);
    }
    if (raw === undefined) return field.required ? fail(context, 'error.form.required') : '';
    if (typeof raw !== 'string') return fail(context, 'error.form.invalid');
    if (field.type === 'select') {
      if (raw === '') return field.required ? fail(context, 'error.form.required') : '';
      return field.options.some((option) => option.value === raw)
        ? raw
        : fail(context, 'error.form.option');
    }
    const result = normalizeString(raw, field);
    if (result.error !== undefined) return fail(context, result.error);
    const { value } = result;
    if (value === '') return field.required ? fail(context, 'error.form.required') : '';
    switch (field.type) {
      case 'email':
        return EMAIL.test(value) ? normalizeEmail(value) : fail(context, 'error.form.email');
      case 'phone':
        return PHONE.test(value) && length(value) >= PHONE_MIN_LENGTH && /\d/.test(value)
          ? value
          : fail(context, 'error.form.phone');
      case 'text':
      case 'textarea':
        return value;
      default: {
        const unreachable: never = field;
        return unreachable;
      }
    }
  });
}

const schemas = new WeakMap<Form, z.ZodType<Record<string, string | boolean>>>();

/** The form's schema, built once per form: a strict object of its fields. */
function formSchema(form: Form): z.ZodType<Record<string, string | boolean>> {
  let schema = schemas.get(form);
  if (!schema) {
    schema = z.strictObject(
      Object.fromEntries(form.fields.map((field) => [field.name, fieldSchema(field)])),
    ) as z.ZodType<Record<string, string | boolean>>;
    schemas.set(form, schema);
  }
  return schema;
}

const isKey = (message: string): message is FormErrorKey =>
  (FORM_ERROR_KEYS as readonly string[]).includes(message);

/**
 * Validates the values a visitor sent for a form: unknown keys are refused, strings trimmed and
 * normalized (NFC), control and invisible characters refused (line breaks are allowed in a
 * `textarea`), the domain of an email lower-cased, a `select` value must be one of its options
 * and a required `consent` must be `true`. Never throws, and no error carries a value.
 */
export function validateForm(form: Form, values: unknown): FormValidation {
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    return { ok: false, fields: {} };
  }
  // Every field present, as `undefined` when left out, so each one's own rule decides.
  const all = Object.fromEntries(form.fields.map((field) => [field.name, undefined]));
  const result = formSchema(form).safeParse({ ...all, ...values });
  if (result.success) return { ok: true, values: Object.freeze(result.data) };
  const fields = new Map<string, FormErrorKey>();
  for (const issue of result.error.issues) {
    const name = issue.path[0];
    if (issue.code === 'unrecognized_keys' || typeof name !== 'string' || !isKey(issue.message)) {
      return { ok: false, fields: {} };
    }
    if (!fields.has(name)) fields.set(name, issue.message);
  }
  return { ok: false, fields: Object.fromEntries(fields) };
}
