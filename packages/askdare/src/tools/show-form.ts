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

/** The same for every call, so nothing the model wrote reaches it again. */
export const SHOW_FORM_OUTPUT: string = JSON.stringify({
  status: 'shown',
  note: 'The visitor sees the form under your answer. Do not ask for the same details in text; you will be told when it is sent, but not what it holds.',
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

/** Whether a stored call's output says the form was shown. */
export const formShown = (output: string | undefined): boolean => output === SHOW_FORM_OUTPUT;
