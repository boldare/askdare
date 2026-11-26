import { z } from 'zod';
import { HANDOFF_REASONS } from '../handoff/report';
import type { HandoffState } from '../protocol/handoff';
import type { StoredToolCall } from './define-tool';

/*
 * Handoff to a person (ADR-0030): a reserved tool the model calls with a reason from a fixed list.
 * The server answers it itself, with the handoff's state; the model never chooses where the
 * request goes, who gets it or what it holds beyond the reason and, when the bot allows it, a
 * short summary.
 */

/** The reserved tool's name: `defineBot` refuses a bot tool with it. */
export const HANDOFF = 'handoff';

/** The longest summary passed on; the server cuts longer ones. */
export const MAX_HANDOFF_SUMMARY = 500;

export const HANDOFF_DESCRIPTION: string = [
  'Ask a person from the team to take over: they get a request and reply to the visitor outside this chat, usually by email.',
  'Call it when the visitor asks for a person, when you cannot help with what they need, for a complaint, for a sensitive matter, or for a sales enquiry a person should handle.',
  'Call it at most once per answer. Do not call it again after the conversation says a person was already asked.',
  'You will be told whether the request went through; tell the visitor in your own words.',
].join(' ');

/** The call's arguments as JSON Schema, for strict mode: every field required, `summary` nullable. */
export function handoffParameters(summary: boolean): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        enum: [...HANDOFF_REASONS],
        description:
          'visitor_asked: they asked for a person; cannot_help: you cannot answer or do what they need; complaint; sensitive: a personal or delicate matter; sales: a purchase or offer.',
      },
      ...(summary
        ? {
            summary: {
              type: ['string', 'null'],
              description: `A short note for the person, at most ${MAX_HANDOFF_SUMMARY} characters: what the visitor needs. Null when there is nothing to add.`,
            },
          }
        : {}),
    },
    required: summary ? ['reason', 'summary'] : ['reason'],
    additionalProperties: false,
  };
}

const args = z.object({
  reason: z.enum(HANDOFF_REASONS as [string, ...string[]]),
  summary: z.string().nullable().optional(),
});

export interface HandoffArguments {
  readonly reason: (typeof HANDOFF_REASONS)[number];
  readonly summary?: string | undefined;
}

/**
 * The call's arguments, checked again on the server. An unknown reason counts as `cannot_help`;
 * the summary is trimmed and cut to {@link MAX_HANDOFF_SUMMARY} characters.
 */
export function handoffArguments(json: string): HandoffArguments {
  let parsed: z.infer<typeof args> | undefined;
  try {
    const result = args.safeParse(JSON.parse(json));
    parsed = result.success ? result.data : undefined;
  } catch {
    parsed = undefined;
  }
  const reason = (parsed?.reason ?? 'cannot_help') as HandoffArguments['reason'];
  const summary = parsed?.summary?.trim();
  return summary
    ? { reason, summary: [...summary].slice(0, MAX_HANDOFF_SUMMARY).join('') }
    : { reason };
}

/** What the model is told about each state: fixed text, so nothing it wrote comes back. */
const SENTENCES: Readonly<Record<HandoffState, string>> = {
  requested:
    'The visitor sees a form for their contact details under your answer; the request goes to the team once they send it. Do not ask for those details in text.',
  sent: 'The request reached the team. A person will reply to the visitor, usually by email.',
  saved:
    'Nobody could take it now, so the visitor’s message was saved; a person will reply later, usually by email.',
  unavailable:
    'Nobody from the team is available right now, and there is no way to leave a message here. Say so, and keep helping if you can.',
  failed:
    'The request could not reach the team. Apologise, suggest trying again later, and keep helping if you can.',
  limited: 'A person was already asked in this conversation; they will get back to the visitor.',
};

/** The fixed output of a `handoff` call. */
export function handoffOutput(
  state: HandoffState,
  form?: { readonly name: string; readonly purpose: string },
): string {
  return JSON.stringify({
    state,
    ...(form ? { form: form.name, purpose: form.purpose } : {}),
    note: SENTENCES[state],
  });
}

const output = z.object({
  state: z.enum(['requested', 'sent', 'saved', 'unavailable', 'failed', 'limited']),
  form: z.string().optional(),
  purpose: z.enum(['handoff', 'message']).optional(),
});

/** A stored `handoff` call's state and form, read back from its fixed output for the history. */
export function readHandoffOutput(call: Pick<StoredToolCall, 'output'>):
  | {
      readonly state: HandoffState;
      readonly form?: string;
      readonly purpose?: 'handoff' | 'message';
    }
  | undefined {
  if (call.output === undefined) return undefined;
  try {
    const parsed = output.safeParse(JSON.parse(call.output));
    if (!parsed.success) return undefined;
    const { state, form, purpose } = parsed.data;
    return form && purpose ? { state, form, purpose } : { state };
  } catch {
    return undefined;
  }
}
