import type { FormPurpose } from '../protocol/forms';
import { HANDOFF_STATES, type HandoffState } from '../protocol/handoff';
import { newItemId } from './items';
import type { StoredItem } from './port';

/*
 * The fixed developer notes that record a handoff (ADR-0030) and a form (ADR-0031) in the
 * conversation, as ADR-0022's notes do for checked answers. Their first line is machine-readable
 * and carries only what the server decided (a state, a form's name, a call's ID); the sentence
 * after it is fixed. The next model call reads them, and the history rebuilds the states from them.
 * Only developer messages count, which only the server writes.
 */

const HANDOFF_SENTENCES: Readonly<Record<HandoffState, string>> = {
  requested: 'The visitor asked for a person and sees a form for their contact details.',
  sent: 'A request for a person was sent to the team; they will reply to the visitor, usually by email. Do not offer it again.',
  saved:
    'Nobody could take the visitor’s request, so their message was saved; a person will reply later. Do not offer it again.',
  unavailable: 'The visitor asked for a person, but nobody from the team is available right now.',
  failed: 'The visitor’s request for a person could not reach the team.',
  limited: 'The visitor asked for a person again; one was already asked in this conversation.',
};

const FORM_SENT =
  'The visitor sent the form. You do not see what it holds unless it follows as [askdare:form-values]; do not ask for the same details again.';
const FORM_SHOWN = 'The visitor sees a form under your previous answer.';

/** The marker of the user message with a form's `toModel` values (ADR-0031, decision 5). */
export const FORM_VALUES_MARKER = '[askdare:form-values]';

const CALL = /^[A-Za-z0-9_-]{1,128}$/;
const NAME = /^[a-z0-9_]{1,32}$/;
const HANDOFF_LINE = /^\[askdare:handoff\] ([a-z]+)(?: ([A-Za-z0-9_-]{1,128}))?$/;
const FORM_LINE =
  /^\[askdare:form\] ([a-z0-9_]{1,32}) (shown|sent) ([A-Za-z0-9_-]{1,128})(?: (lead|handoff|message))?$/;

const developer = (text: string): StoredItem => ({
  id: newItemId(),
  type: 'message',
  role: 'developer',
  parts: [{ type: 'text', text }],
});

/**
 * A handoff's state; with `callId`, the form it continues, so the history puts the state on the
 * answer that form is under.
 */
export function handoffNote(state: HandoffState, callId?: string): StoredItem {
  const id = callId !== undefined && CALL.test(callId) ? ` ${callId}` : '';
  return developer(`[askdare:handoff] ${state}${id}\n${HANDOFF_SENTENCES[state]}`);
}

/** A form the server showed outside a model call: the one a visitor's handoff asks for. */
export function formShownNote(name: string, callId: string, purpose: FormPurpose): StoredItem {
  return developer(`[askdare:form] ${name} shown ${callId} ${purpose}\n${FORM_SHOWN}`);
}

/** A form was sent; it never holds a value. */
export function formSentNote(name: string, callId: string): StoredItem {
  return developer(`[askdare:form] ${name} sent ${callId}\n${FORM_SENT}`);
}

/**
 * The values of a form's `toModel` fields, as a user message after its note, so what the visitor
 * typed never carries developer authority.
 */
export function formValuesItem(lines: readonly (readonly [string, string])[]): StoredItem {
  return {
    id: newItemId(),
    type: 'message',
    role: 'user',
    parts: [
      {
        type: 'text',
        text: [FORM_VALUES_MARKER, ...lines.map(([label, value]) => `${label}: ${value}`)].join(
          '\n',
        ),
      },
    ],
  };
}

export type HandoffNote =
  | { readonly kind: 'handoff'; readonly state: HandoffState; readonly callId?: string | undefined }
  | {
      readonly kind: 'form';
      readonly name: string;
      readonly state: 'shown' | 'sent';
      readonly callId: string;
      readonly purpose?: FormPurpose | undefined;
    };

const textOf = (item: StoredItem): string | undefined => {
  if (item.type !== 'message') return undefined;
  let text = '';
  for (const part of item.parts) if (part.type === 'text') text += part.text;
  return text;
};

/** What a stored developer note records, if it is one of these notes. */
export function storedHandoffNote(item: StoredItem): HandoffNote | undefined {
  if (item.type !== 'message' || item.role !== 'developer') return undefined;
  const [line] = (textOf(item) ?? '').split('\n', 1);
  if (line === undefined) return undefined;
  const handoff = HANDOFF_LINE.exec(line);
  if (handoff) {
    const state = handoff[1] as HandoffState;
    if (!HANDOFF_STATES.includes(state)) return undefined;
    return handoff[2] === undefined
      ? { kind: 'handoff', state }
      : { kind: 'handoff', state, callId: handoff[2] };
  }
  const form = FORM_LINE.exec(line);
  if (form?.[1] && NAME.test(form[1]) && form[3]) {
    return {
      kind: 'form',
      name: form[1],
      state: form[2] as 'shown' | 'sent',
      callId: form[3],
      ...(form[4] ? { purpose: form[4] as FormPurpose } : {}),
    };
  }
  return undefined;
}

/** Whether a stored user message is a form's values, which the history doesn't show. */
export function isFormValues(item: StoredItem): boolean {
  return (
    item.type === 'message' &&
    item.role === 'user' &&
    (textOf(item) ?? '').startsWith(`${FORM_VALUES_MARKER}\n`)
  );
}
