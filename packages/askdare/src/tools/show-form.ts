import { z } from 'zod';
import type { Form } from '../forms/define-form';

/*
 * Forms in the chat (ADR-0031): a reserved tool the model calls with the name of one of the bot's
 * forms. It never passes fields or values; the server answers the call itself and the chat shows
 * the form from the bot's own definition.
 */

/** The reserved tool's name: `defineBot` refuses a bot tool with it. */
export const SHOW_FORM = 'show_form';

/** The forms the model may show: those not kept for a handoff only (`model: false`). */
export const modelForms = (forms: readonly Form[]): readonly Form[] =>
  forms.filter((form) => form.model);

/** Lists each form's name and description, which only the model reads. */
export function showFormDescription(forms: readonly Form[]): string {
  return [
    'Show the visitor one of the site’s forms under your answer, for details they type in themselves.',
    'Call it at most once per answer, after writing your answer. Never ask for the same details in text, and never suggest values.',
    'The forms:',
    ...modelForms(forms).map((form) => `- ${form.name}: ${form.description}`),
  ].join('\n');
}

/** The call's arguments as JSON Schema, for strict mode. */
export function showFormParameters(forms: readonly Form[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      form: { type: 'string', enum: modelForms(forms).map((form) => form.name) },
    },
    required: ['form'],
    additionalProperties: false,
  };
}

/** A BCP 47 tag as the server checked it, kept with a shown form. */
const LOCALE = /^[A-Za-z0-9-]{1,35}$/;

/**
 * The output of a call that showed a form. Nothing the model wrote reaches it again; the visitor's
 * language is kept with it, so a handle issued again after a reload keeps it (ADR-0031).
 */
export function showFormOutput(locale: string): string {
  return JSON.stringify({
    status: 'shown',
    ...(LOCALE.test(locale) ? { locale } : {}),
    note: 'The visitor sees the form under your answer. Do not ask for the same details in text; you will be told when it is sent, but not what it holds.',
  });
}

const shownOutput = z.object({
  status: z.literal('shown'),
  locale: z.string().regex(LOCALE).optional(),
});

/** For a second call in one answer, or a form the bot doesn't offer. */
export const SHOW_FORM_REFUSED: string = JSON.stringify({
  status: 'not_shown',
  note: 'No form was shown for this call: at most one form per answer, from the list.',
});

const args = z.object({ form: z.string() });

/** The form a call names, if the arguments parse. */
export function showFormName(json: string): string | undefined {
  try {
    const parsed = args.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data.form : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a stored call's output says the form was shown, with the visitor's language then;
 * undefined when it wasn't.
 */
export function formShown(
  output: string | undefined,
): { readonly locale?: string | undefined } | undefined {
  if (output === undefined) return undefined;
  try {
    const parsed = shownOutput.safeParse(JSON.parse(output));
    return parsed.success ? { locale: parsed.data.locale } : undefined;
  } catch {
    return undefined;
  }
}
