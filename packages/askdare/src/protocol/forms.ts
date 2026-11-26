import type { HandoffState } from './handoff';

/*
 * Forms in the chat (ADR-0031) on the wire: the description the bot's public configuration
 * carries, the form's state in history, and `POST /forms`. Forms are defined in server code with
 * `defineForm` (src/forms/); the server maps a definition onto these shapes for the visitor's
 * language. Nothing here is for the model: a form's `description`, `toModel` and `model` never
 * reach the client.
 */

/** A form's name, unique in its bot. */
export const FORM_NAME: RegExp = /^[a-z0-9_]{1,32}$/;
/**
 * A field's name, the key of its value in `POST /forms`. It starts with a letter, so no field can
 * be called `__proto__`.
 */
export const FORM_FIELD_NAME: RegExp = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

/** The closed set of field types (ADR-0031, point 1). */
export const FORM_FIELD_TYPES = [
  'text',
  'email',
  'phone',
  'select',
  'textarea',
  'consent',
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/**
 * The longest value of each type that takes text, in UTF-16 code units, and so the highest
 * `maxLength` a field of that type may have.
 */
export const FORM_FIELD_MAX_LENGTH: Readonly<
  Record<'text' | 'email' | 'phone' | 'textarea', number>
> = { text: 200, email: 254, phone: 20, textarea: 2000 };

/** Why a form is shown: a lead, a handoff's contact details, or a message left for nobody. */
export const FORM_PURPOSES = ['lead', 'handoff', 'message'] as const;
export type FormPurpose = (typeof FORM_PURPOSES)[number];

/** A form under an answer, after a reload: still to fill in, sent, or past its handle's 24 hours. */
export const FORM_STATES = ['open', 'sent', 'expired'] as const;
export type FormState = (typeof FORM_STATES)[number];

/** Forms one bot may have. */
export const MAX_FORMS = 10;
/** Fields one form may have. */
export const MAX_FORM_FIELDS = 8;
/** Options of a `select`. */
export const MIN_FORM_OPTIONS = 2;
export const MAX_FORM_OPTIONS = 10;
/** A title, a label, an option's label, a placeholder or the submit button's text. */
export const MAX_FORM_LABEL = 120;
/** The text shown once the form is sent. */
export const MAX_FORM_DONE = 300;
/** An option's value. */
export const MAX_FORM_OPTION_VALUE = 200;
/** Forms one answer carries in history. */
export const MAX_MESSAGE_FORMS = 10;
/** A form handle, in events, history and `POST /forms`. */
export const MAX_FORM_HANDLE = 4096;
/**
 * The longest text value `POST /forms` takes at all. Each field's own limit is checked by the
 * form's validation, which answers with a field error; this only bounds the request.
 */
export const MAX_FORM_VALUE = 4000;

/** Error keys of fields in a refused submission. Clients show unknown keys as a generic error. */
export const FORM_ERROR_KEYS = [
  'error.form.required',
  'error.form.email',
  'error.form.phone',
  'error.form.tooLong',
  'error.form.option',
] as const;
/** Any field error key, including ones a later version adds. */
export const FORM_ERROR_KEY: RegExp = /^error\.form\.[a-zA-Z]{1,32}$/;

/** One option of a `select`. */
export interface ChatFormOption {
  /** Sent back in `POST /forms`. */
  readonly value: string;
  readonly label: string;
}

/** One field, in the visitor's language. Every text renders as plain text. */
export interface ChatFormField {
  readonly name: string;
  readonly type: FormFieldType;
  readonly label: string;
  /** For `consent`, the box must be ticked. */
  readonly required: boolean;
  /** `text`, `email`, `phone` and `textarea` only. */
  readonly placeholder?: string | undefined;
  /** `select` only, and always there: 2 to 10 options with distinct values. */
  readonly options?: readonly ChatFormOption[] | undefined;
  /** `text`, `email`, `phone` and `textarea` only; at most the type's own limit. */
  readonly maxLength?: number | undefined;
}

/**
 * A form as the bot's public configuration describes it (`GET /config/<bot>` and the chat
 * document), in the visitor's language. The `form` event and history name it by `name`.
 */
export interface ChatForm {
  readonly name: string;
  readonly title: string;
  /** 1 to 8, distinct names. */
  readonly fields: readonly ChatFormField[];
  /** The submit button. */
  readonly submit: string;
  /** Shown in place of the form once it is sent. */
  readonly done: string;
}

/** A form under an answer in `POST /history`. */
export interface HistoryForm {
  /** As in the `form` event. Opaque. */
  readonly callId: string;
  readonly name: string;
  readonly purpose: FormPurpose;
  readonly state: FormState;
  /** A fresh handle while the form is open. */
  readonly handle?: string | undefined;
}

/** The body of `POST /forms`. */
export interface FormRequest {
  readonly botId: string;
  readonly resumeToken: string;
  /** The form's handle, from the `form` event, history or `POST /handoff`. */
  readonly form: string;
  /** By field name: text for most fields, `true` or `false` for `consent`. */
  readonly values: Readonly<Record<string, string | boolean>>;
}

/** The answer of `POST /forms` when the form was sent. */
export interface FormResponse {
  readonly state: 'sent';
  /** For a handoff's form: the handoff's final state (ADR-0030). */
  readonly handoff?: HandoffState | undefined;
}

/**
 * With `400` `invalid_input`, the error of `POST /forms` names the refused fields in `fields`,
 * each with one error key. It never echoes a value.
 */
export type FormFieldErrors = Readonly<Record<string, string>>;
