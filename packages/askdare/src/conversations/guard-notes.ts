import type { AnswerVerdict } from '../gateway';
import { newItemId } from './items';
import type { StoredItem } from './port';

/**
 * The fixed developer notes that settle a checked answer (ADR-0022). They carry no content: a
 * replacement is stored after its note as an assistant message, so text derived from model output
 * never gains developer authority.
 */
const NOTES = {
  allowed: "[askdare:allowed]\nThe site's checks passed your previous answer.",
  withheld:
    "[askdare:withheld]\nThe site's content policy withheld your previous answer: the visitor never saw it. Don't repeat it.",
  replaced:
    "[askdare:replaced]\nThe site's content policy replaced your previous answer with the assistant message that follows; the visitor saw only that one.",
} as const satisfies Record<AnswerVerdict['action'], string>;

/** The note a verdict writes. */
export const guardNote = (action: AnswerVerdict['action']): string => NOTES[action];

/** The action a note's text settles, if it is exactly one of the notes. */
export function guardNoteAction(text: string): AnswerVerdict['action'] | undefined {
  for (const action of ['allowed', 'withheld', 'replaced'] as const) {
    if (text === NOTES[action]) return action;
  }
  return undefined;
}

/**
 * The items that record what output checks decided, appended after the turn's items: history
 * shows the answer only once it is settled, and the next model call reads the note too.
 */
export function settledAnswerItems(verdict: AnswerVerdict): StoredItem[] {
  const items: StoredItem[] = [
    {
      id: newItemId(),
      type: 'message',
      role: 'developer',
      parts: [{ type: 'text', text: NOTES[verdict.action] }],
    },
  ];
  if (verdict.action === 'replaced') {
    items.push({
      id: newItemId(),
      type: 'message',
      role: 'assistant',
      parts: [{ type: 'text', text: verdict.text }],
    });
  }
  return items;
}
