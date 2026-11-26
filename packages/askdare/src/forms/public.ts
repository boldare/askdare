import type { Form, FormFieldSpec, FormFieldType } from './define-form';
import { resolveFormText } from './form-text';

/*
 * The description of a form the widget renders (ADR-0031), in the bot's public configuration:
 * texts resolved for the visitor's language, and nothing for the server only (`description`,
 * `model`, `toModel`).
 */

export interface PublicFormOption {
  readonly value: string;
  readonly label: string;
}

export interface PublicFormField {
  readonly name: string;
  readonly type: FormFieldType;
  readonly label: string;
  readonly required: boolean;
  /** `text`, `email`, `phone` and `textarea` only, when set. */
  readonly placeholder?: string;
  /** `select` only. */
  readonly options?: readonly PublicFormOption[];
  /** Characters the value may have: `text`, `email`, `phone` and `textarea` only. */
  readonly maxLength?: number;
}

export interface PublicForm {
  readonly name: string;
  readonly title: string;
  readonly fields: readonly PublicFormField[];
  /** Absent: the chat shows its own `form.submit` text. */
  readonly submit?: string;
  /** Absent: the chat shows its own `form.done` text. */
  readonly done?: string;
}

function publicField(field: FormFieldSpec, locale: string): PublicFormField {
  const base = {
    name: field.name,
    type: field.type,
    label: resolveFormText(field.label, locale),
    required: field.required,
  };
  switch (field.type) {
    case 'select':
      return {
        ...base,
        options: field.options.map((option) => ({
          value: option.value,
          label: resolveFormText(option.label, locale),
        })),
      };
    case 'consent':
      return base;
    case 'text':
    case 'email':
    case 'phone':
    case 'textarea':
      return {
        ...base,
        ...(field.placeholder === undefined
          ? {}
          : { placeholder: resolveFormText(field.placeholder, locale) }),
        maxLength: field.maxLength,
      };
    default: {
      const unreachable: never = field;
      return unreachable;
    }
  }
}

/** What the widget gets of a form, for a visitor in `locale` (English, then the first, as fallback). */
export function publicForm(form: Form, locale: string): PublicForm {
  return {
    name: form.name,
    title: resolveFormText(form.title, locale),
    fields: form.fields.map((field) => publicField(field, locale)),
    ...(form.submit === undefined ? {} : { submit: resolveFormText(form.submit, locale) }),
    ...(form.done === undefined ? {} : { done: resolveFormText(form.done, locale) }),
  };
}
