import { type FormText, formTextProblem, normalizeFormText } from './form-text';

/*
 * Forms in the chat (ADR-0031): defined once in server code, from a closed set of fields the
 * server can validate and the widget can draw without the site's code.
 */

/** The field types, a closed set; each addition is a minor release with its validation rule. */
export const FORM_FIELD_TYPES = [
  'text',
  'email',
  'phone',
  'select',
  'textarea',
  'consent',
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/** A form's name: what the model picks it by, and what the protocol and `onLead` carry. */
export const FORM_NAME: RegExp = /^[a-z0-9_]{1,32}$/;
/**
 * A field's name, the key of its value: it starts with a letter (as the protocol requires), so
 * no field can be called `__proto__`.
 */
export const FORM_FIELD_NAME: RegExp = /^[a-z][a-z0-9_]{0,31}$/;
/** Whether a form's name fits `FORM_NAME` and can't change an object's prototype as a key. */
const isFormName = (name: unknown): name is string =>
  typeof name === 'string' && FORM_NAME.test(name) && name !== '__proto__';
const isFieldName = (name: unknown): name is string =>
  typeof name === 'string' && FORM_FIELD_NAME.test(name);
/** Fields one form may have. */
export const MAX_FORM_FIELDS = 8;
/** Forms one bot may have; `defineBot` checks it. */
export const MAX_BOT_FORMS = 10;
/**
 * Characters of a title, label, placeholder, option label or `submit`, in every language. Every
 * length here counts UTF-16 code units, as the protocol and the browser do (an emoji is 2).
 */
export const MAX_FORM_LABEL = 120;
/** Characters of `done`, in every language. */
export const MAX_FORM_DONE = 300;
/** Characters of the model-facing `description`. */
export const MAX_FORM_DESCRIPTION = 1000;
/** Characters of a `select` option's value. */
export const MAX_FORM_OPTION_VALUE = 100;
/** Options of a `select` field. */
export const MIN_FORM_OPTIONS = 2;
export const MAX_FORM_OPTIONS = 10;

/** Characters a value of each string type may have; `text` and `textarea` may set fewer. */
export const FORM_MAX_LENGTH: Readonly<Record<'text' | 'email' | 'phone' | 'textarea', number>> =
  Object.freeze({ text: 200, email: 254, phone: 20, textarea: 2000 });
/** Characters of a phone number, at least. */
export const PHONE_MIN_LENGTH = 6;

interface BaseField<Type extends FormFieldType> {
  readonly type: Type;
  /** `[a-z][a-z0-9_]{0,31}`, unique in the form: the key of the value in `onLead`. */
  readonly name: string;
  /** Shown above the field as plain text, at most 120 characters. */
  readonly label: FormText;
  /** For `consent`: the box must be ticked. Default `false`. */
  readonly required?: boolean;
  /**
   * Whether the model sees this field's value after the form is sent, in a user message
   * (ADR-0031). Default `false`: the model learns only that the form was sent. Mark fields the
   * bot needs to go on helping (a topic, a product), not contact details.
   */
  readonly toModel?: boolean;
}

interface PlaceholderField {
  /** Shown in the empty field, at most 120 characters. */
  readonly placeholder?: FormText;
}

/** One line of text, at most 200 characters, or `maxLength`. */
export interface FormTextField extends BaseField<'text'>, PlaceholderField {
  readonly maxLength?: number;
}
/** An email address, at most 254 characters; the domain is lower-cased. */
export interface FormEmailField extends BaseField<'email'>, PlaceholderField {}
/** Digits, spaces, `+`, `-`, `(` and `)`, 6 to 20 characters. No country rules. */
export interface FormPhoneField extends BaseField<'phone'>, PlaceholderField {}
/** Several lines, at most 2,000 characters, or `maxLength`. */
export interface FormTextareaField extends BaseField<'textarea'>, PlaceholderField {
  readonly maxLength?: number;
}
/** One of 2 to 10 options; the visitor can send only a `value` given here. */
export interface FormSelectField extends BaseField<'select'> {
  readonly options: readonly FormSelectOption[];
}
export interface FormSelectOption {
  /** What `onLead` gets, 1 to 100 characters, unique in the field. */
  readonly value: string;
  readonly label: FormText;
}
/** A checkbox with the site's own wording; it links the bot's `privacyUrl` when one is set. */
export interface FormConsentField extends BaseField<'consent'> {}

/** A field of a form, from the closed set of types. */
export type FormField =
  | FormTextField
  | FormEmailField
  | FormPhoneField
  | FormTextareaField
  | FormSelectField
  | FormConsentField;

export interface FormDefinition<Name extends string = string> {
  /** `[a-z0-9_]{1,32}`, unique in the bot: what the model picks the form by. */
  readonly name: Name;
  /**
   * For the model only, never sent to the browser: what the form is for and when to show it.
   * Required unless `model` is `false`.
   */
  readonly description?: string;
  /**
   * Whether the model may show the form with the `show_form` tool. Default `true`. A form with
   * `false` serves a handoff only (ADR-0030).
   */
  readonly model?: boolean;
  /** Shown above the fields, at most 120 characters. */
  readonly title: FormText;
  /** 1 to 8 fields, in the order shown. */
  readonly fields: readonly FormField[];
  /** The button's text, at most 120 characters; the chat's own by default. */
  readonly submit?: FormText;
  /** Shown in place of the form once it is sent, at most 300 characters; the chat's own by default. */
  readonly done?: FormText;
}

/** A checked, normalized field: defaults filled in, texts trimmed. */
export type FormFieldSpec =
  | (FormTextField & FieldDefaults & { readonly maxLength: number })
  | (FormEmailField & FieldDefaults & { readonly maxLength: number })
  | (FormPhoneField & FieldDefaults & { readonly maxLength: number })
  | (FormTextareaField & FieldDefaults & { readonly maxLength: number })
  | (FormSelectField & FieldDefaults)
  | (FormConsentField & FieldDefaults);

interface FieldDefaults {
  readonly required: boolean;
  readonly toModel: boolean;
}

/** A form a bot can show, as `defineForm` returns it. */
export interface Form<Name extends string = string> {
  readonly name: Name;
  /** Empty when `model` is `false` and none was given. */
  readonly description: string;
  readonly model: boolean;
  readonly title: FormText;
  readonly fields: readonly FormFieldSpec[];
  readonly submit?: FormText | undefined;
  readonly done?: FormText | undefined;
}

const isFieldType = (value: unknown): value is FormFieldType =>
  (FORM_FIELD_TYPES as readonly unknown[]).includes(value);

const isMaxLengthField = (type: FormFieldType): type is 'text' | 'textarea' =>
  type === 'text' || type === 'textarea';

/** What is wrong with a text option, prefixed with where it is. */
function textProblems(where: string, text: unknown, max: number, optional: boolean): string[] {
  if (text === undefined && optional) return [];
  const problem = formTextProblem(text, max);
  return problem === undefined ? [] : [`${where} ${problem}`];
}

function optionProblems(where: string, options: unknown): string[] {
  if (!Array.isArray(options)) return [`${where}.options must be an array`];
  if (options.length < MIN_FORM_OPTIONS || options.length > MAX_FORM_OPTIONS) {
    return [`${where}.options must have ${MIN_FORM_OPTIONS} to ${MAX_FORM_OPTIONS} options`];
  }
  const problems: string[] = [];
  const values = new Set<string>();
  options.forEach((option: unknown, index) => {
    const at = `${where}.options[${index}]`;
    if (typeof option !== 'object' || option === null) {
      problems.push(`${at} must be an object with value and label`);
      return;
    }
    const { value, label } = option as { value?: unknown; label?: unknown };
    if (
      typeof value !== 'string' ||
      value.trim() === '' ||
      value !== value.trim() ||
      value.length > MAX_FORM_OPTION_VALUE
    ) {
      problems.push(
        `${at}.value must be 1-${MAX_FORM_OPTION_VALUE} characters without surrounding spaces`,
      );
    } else if (values.has(value)) {
      problems.push(`${at}.value "${value}" is used twice`);
    } else {
      values.add(value);
    }
    problems.push(...textProblems(`${at}.label`, label, MAX_FORM_LABEL, false));
  });
  return problems;
}

function fieldProblems(field: unknown, index: number, names: Set<string>): string[] {
  const where = `fields[${index}]`;
  if (typeof field !== 'object' || field === null) return [`${where} must be an object`];
  const raw = field as Record<string, unknown>;
  const { type, name } = raw;
  if (!isFieldType(type)) return [`${where}.type must be one of ${FORM_FIELD_TYPES.join(', ')}`];
  const problems: string[] = [];
  if (!isFieldName(name)) {
    problems.push(`${where}.name must be 1-32 lowercase letters, digits or "_", from a letter`);
  } else if (names.has(name)) {
    problems.push(`${where}.name "${name}" is used twice`);
  } else {
    names.add(name);
  }
  problems.push(...textProblems(`${where}.label`, raw['label'], MAX_FORM_LABEL, false));
  for (const flag of ['required', 'toModel'] as const) {
    if (raw[flag] !== undefined && typeof raw[flag] !== 'boolean') {
      problems.push(`${where}.${flag} must be a boolean`);
    }
  }
  const placeholder = type !== 'select' && type !== 'consent';
  if (placeholder) {
    problems.push(
      ...textProblems(`${where}.placeholder`, raw['placeholder'], MAX_FORM_LABEL, true),
    );
  } else if (raw['placeholder'] !== undefined) {
    problems.push(`${where}.placeholder is not supported by ${type} fields`);
  }
  if (isMaxLengthField(type)) {
    const maxLength = raw['maxLength'];
    const limit = FORM_MAX_LENGTH[type];
    if (
      maxLength !== undefined &&
      (typeof maxLength !== 'number' ||
        !Number.isInteger(maxLength) ||
        maxLength < 1 ||
        maxLength > limit)
    ) {
      problems.push(`${where}.maxLength must be an integer from 1 to ${limit}`);
    }
  } else if (raw['maxLength'] !== undefined) {
    problems.push(`${where}.maxLength is not supported by ${type} fields`);
  }
  if (type === 'select') problems.push(...optionProblems(where, raw['options']));
  else if (raw['options'] !== undefined) {
    problems.push(`${where}.options is supported by select fields only`);
  }
  return problems;
}

function normalizeField(field: FormField): FormFieldSpec {
  const base = {
    name: field.name,
    label: normalizeFormText(field.label),
    required: field.required ?? false,
    toModel: field.toModel ?? false,
  };
  switch (field.type) {
    case 'select':
      return Object.freeze({
        ...base,
        type: field.type,
        options: Object.freeze(
          field.options.map((option) =>
            Object.freeze({ value: option.value, label: normalizeFormText(option.label) }),
          ),
        ),
      });
    case 'consent':
      return Object.freeze({ ...base, type: field.type });
    case 'text':
    case 'email':
    case 'phone':
    case 'textarea': {
      const maxLength =
        (field.type === 'text' || field.type === 'textarea' ? field.maxLength : undefined) ??
        FORM_MAX_LENGTH[field.type];
      return Object.freeze({
        ...base,
        type: field.type,
        maxLength,
        ...(field.placeholder === undefined
          ? {}
          : { placeholder: normalizeFormText(field.placeholder) }),
      });
    }
    default: {
      const unreachable: never = field;
      return unreachable;
    }
  }
}

/**
 * Declares a form the bot can show in the chat (ADR-0031). The definition is checked here, at
 * startup: an invalid form throws with every reason, like an invalid bot. The visitor types every
 * value; askdare validates them on the server and passes them to `onLead`, storing none.
 */
export function defineForm<const Name extends string>(
  definition: FormDefinition<Name>,
): Form<Name> {
  const problems: string[] = [];
  const { name } = definition;
  if (!isFormName(name)) {
    problems.push('name must be 1-32 lowercase letters, digits or "_"');
  }
  const model = definition.model ?? true;
  if (typeof model !== 'boolean') problems.push('model must be a boolean');
  const description = definition.description;
  if (description !== undefined && typeof description !== 'string') {
    problems.push('description must be a string');
  } else if (model && (description === undefined || description.trim() === '')) {
    problems.push('description must tell the model when to show the form (or set model: false)');
  } else if (description !== undefined && description.trim().length > MAX_FORM_DESCRIPTION) {
    problems.push(`description must be at most ${MAX_FORM_DESCRIPTION} characters`);
  }
  problems.push(...textProblems('title', definition.title, MAX_FORM_LABEL, false));
  problems.push(...textProblems('submit', definition.submit, MAX_FORM_LABEL, true));
  problems.push(...textProblems('done', definition.done, MAX_FORM_DONE, true));
  const fields: unknown = definition.fields;
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > MAX_FORM_FIELDS) {
    problems.push(`fields must have 1 to ${MAX_FORM_FIELDS} fields`);
  } else {
    const names = new Set<string>();
    fields.forEach((field: unknown, index) => {
      problems.push(...fieldProblems(field, index, names));
    });
  }
  if (problems.length > 0) {
    throw new TypeError(`[askdare] Invalid form "${String(name)}": ${problems.join('; ')}`);
  }
  return Object.freeze({
    name,
    description: description?.trim() ?? '',
    model,
    title: normalizeFormText(definition.title),
    fields: Object.freeze(definition.fields.map(normalizeField)),
    submit: definition.submit === undefined ? undefined : normalizeFormText(definition.submit),
    done: definition.done === undefined ? undefined : normalizeFormText(definition.done),
  });
}
