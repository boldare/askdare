import {
  type ComponentProps,
  type FormEvent,
  type ReactElement,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import type { MessageForm } from '../chat/state';
import type { TextKey } from '../i18n/texts';
import { type ChatFormField, FORM_FIELD_MAX_LENGTH } from '../protocol/forms';
import { useChatConfig, useMessage, useStore, useTexts } from './context';
import { Link } from './tool-results';

type Values = Record<string, string | boolean>;

/** As the server checks it (forms/validate.ts); the server has the last word. */
const EMAIL =
  /^[^\s@]{1,64}@(?=.{1,253}$)(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+\p{L}{2,63}$/u;
const PHONE = /^(?=.*\d)[0-9 +\-()]{6,}$/;

/** A field's own entry: a field may be called `constructor`. */
const own = <T,>(record: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;

/** What browsers may fill a field with (WCAG 1.3.5), by its type or a common name. */
const autocomplete = ({ type, name }: ChatFormField): string =>
  type === 'email'
    ? 'email'
    : type === 'phone'
      ? 'tel'
      : name === 'name' || name === 'organization'
        ? name
        : name === 'company'
          ? 'organization'
          : 'off';

const maxLength = (field: ChatFormField): number =>
  field.maxLength ??
  (field.type === 'select' || field.type === 'consent' ? 0 : FORM_FIELD_MAX_LENGTH[field.type]);

/** The error key for a value, checked by hand as the server would (ADR-0031), or '' when it passes. */
function check(field: ChatFormField, raw: string | boolean | undefined): string {
  if (field.type === 'consent') return field.required && raw !== true ? 'error.form.required' : '';
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value === '') return field.required ? 'error.form.required' : '';
  if (field.type === 'select') {
    return field.options?.some((option) => option.value === value) ? '' : 'error.form.option';
  }
  if (value.length > maxLength(field)) return 'error.form.tooLong';
  if (field.type === 'email' && !EMAIL.test(value)) return 'error.form.email';
  if (field.type === 'phone' && !PHONE.test(value)) return 'error.form.phone';
  return '';
}

export interface FormProps extends Omit<ComponentProps<'form'>, 'children' | 'onSubmit'> {
  /** One of the current message's `forms`. */
  readonly form: MessageForm;
}

/**
 * A form under an answer (ADR-0031), drawn from its description in the bot's configuration: a
 * `form` with its title, a `form-field` per field with a visible label, and the submit button.
 * Labels and options are plain text; a `consent` field links the bot's privacy policy. Values are
 * checked by hand first, then by the server: each error (`form-error`) is tied to its field with
 * `aria-describedby`, and the first field with an error gets focus. Once sent or expired, the
 * form becomes its `form-done` text (for a handoff's form, the handoff's outcome), which gets focus
 * if the visitor had just sent it. Use it inside `MessageList`, once per `useMessage().forms`.
 */
export function Form({ form, ...props }: FormProps): ReactElement | null {
  const { handoff } = useMessage();
  const config = useChatConfig();
  const { actions } = useStore();
  const t = useTexts();
  const id = useId();
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const inputs = useRef<Record<string, HTMLElement | null>>({});
  const done = useRef<HTMLParagraphElement>(null);
  /** The visitor sent it from here: focus follows the outcome. */
  const sent = useRef(false);
  const definition = config.forms?.find((item) => item.name === form.name);
  const fields = definition?.fields ?? [];

  const focusFirst = (refused: Readonly<Record<string, string>>): void => {
    const first = fields.find((field) => own(refused, field.name));
    if (first) inputs.current[first.name]?.focus();
  };
  // The server's errors, after a try: shown and focused like the chat's own.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when new errors arrive
  useEffect(() => {
    if (!form.errors) return;
    setErrors(form.errors);
    focusFirst(form.errors);
  }, [form.errors]);
  const closed = form.state === 'sent' || form.state === 'expired';
  useEffect(() => {
    if (closed && sent.current) done.current?.focus();
  }, [closed]);

  if (closed) {
    const email = fields.find((field) => field.type === 'email' && own(values, field.name));
    const text =
      form.state === 'expired'
        ? t('form.expired')
        : form.purpose !== 'lead' && handoff && handoff !== 'requested'
          ? handoff === 'sent' && email
            ? t('handoff.sentTo', { email: String(own(values, email.name)).trim() })
            : t(`handoff.${handoff}`)
          : (definition?.done ?? t('form.done'));
    return (
      <p ref={done} tabIndex={-1} data-ask-part="form-done" data-state={form.state} role="status">
        {text}
      </p>
    );
  }
  if (!definition) return null;

  const submitting = form.state === 'submitting';
  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (submitting || !form.handle) return;
    const refused: Record<string, string> = {};
    const out: Values = {};
    for (const field of fields) {
      const value = own(values, field.name) ?? (field.type === 'consent' ? false : '');
      out[field.name] = value;
      const key = check(field, value);
      if (key) refused[field.name] = key;
    }
    setErrors(refused);
    if (Object.keys(refused).length > 0) {
      focusFirst(refused);
      return;
    }
    sent.current = true;
    void actions.submitForm(form.handle, out);
  };
  const errorText = (field: ChatFormField, key: string): string => {
    const shown =
      field.type === 'consent' && key === 'error.form.required' ? 'error.form.consent' : key;
    const text = t(shown as TextKey, { max: maxLength(field) });
    // A key from a newer server that this chat doesn't know.
    return text === shown ? t('error.form.invalid') : text;
  };
  const title = form.purpose === 'message' ? t('handoff.unavailableTitle') : definition.title;
  const { disclosure } = config.widget;
  const privacyUrl = disclosure ? disclosure.privacyUrl : undefined;

  return (
    <form
      data-ask-part="form"
      data-ask-form={form.name}
      data-purpose={form.purpose}
      aria-labelledby={`${id}t`}
      aria-busy={submitting || undefined}
      noValidate
      onSubmit={onSubmit}
      {...props}
    >
      <p id={`${id}t`} data-ask-part="form-title">
        {title}
      </p>
      {fields.map((field) => {
        const fieldId = `${id}${field.name}`;
        const error = own(errors, field.name);
        const value = own(values, field.name);
        const control = {
          id: fieldId,
          name: field.name,
          ref: (element: HTMLElement | null) => {
            inputs.current[field.name] = element;
          },
          'aria-invalid': error ? true : undefined,
          'aria-describedby': error ? `${fieldId}e` : undefined,
          'aria-required': field.required || undefined,
        } as const;
        const set = (next: string | boolean): void => {
          setValues((current) => ({ ...current, [field.name]: next }));
          if (error) setErrors(({ [field.name]: _, ...rest }) => rest);
        };
        const consent = field.type === 'consent';
        // One element per type; `select` and `textarea` take no `type`.
        const Control = (
          field.type === 'select' ? 'select' : field.type === 'textarea' ? 'textarea' : 'input'
        ) as 'input';
        return (
          <div key={field.name} data-ask-part="form-field" data-type={field.type}>
            <label htmlFor={fieldId}>
              {field.label}
              {!field.required && !consent && (
                <span data-ask-part="form-optional"> {t('form.optional')}</span>
              )}
            </label>
            <Control
              {...control}
              {...(consent
                ? { checked: value === true }
                : { value: typeof value === 'string' ? value : '' })}
              type={
                consent
                  ? 'checkbox'
                  : field.type === 'phone'
                    ? 'tel'
                    : field.type === 'text' || field.type === 'email'
                      ? field.type
                      : undefined
              }
              autoComplete={Control === 'input' && !consent ? autocomplete(field) : undefined}
              placeholder={field.placeholder}
              onChange={(event) => set(consent ? event.target.checked : event.target.value)}
            >
              {field.options && (
                <>
                  <option value="">{t('form.choose')}</option>
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </>
              )}
            </Control>
            {consent && privacyUrl && <Link href={privacyUrl}>{t('disclosure.privacy')}</Link>}
            {error && (
              <p id={`${fieldId}e`} data-ask-part="form-error">
                {errorText(field, error)}
              </p>
            )}
          </div>
        );
      })}
      {form.error && (
        <p data-ask-part="form-error" role="alert">
          {form.error}
        </p>
      )}
      <button type="submit" data-ask-part="form-submit" aria-disabled={submitting || undefined}>
        {definition.submit ?? t('form.submit')}
      </button>
    </form>
  );
}
