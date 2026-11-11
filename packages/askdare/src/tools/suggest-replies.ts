import { z } from 'zod';
import type { StoredToolCall } from './define-tool';

/*
 * Model-suggested reply options (ADR-0015, variant A): a built-in tool the model calls with a few
 * next messages for the visitor. The server answers the call itself and never runs bot code.
 */

/** The built-in tool's name, reserved: `defineBot` refuses a bot tool with it. */
export const SUGGEST_REPLIES = 'suggest_replies';

/** Tells the model when options help and what makes a good one. */
export const SUGGEST_REPLIES_DESCRIPTION: string = [
  'Show the visitor 2 to 4 short replies they can click instead of typing, under your answer.',
  'Call it at most once per answer, in the same response, after you have written your full answer; never instead of answering.',
  'Call it only when a few clear next steps would help: a choice you asked the visitor to make, a natural follow-up question, or the next step of a task.',
  'Skip it for greetings, small talk, and answers that need no follow-up.',
  'Write each reply as the visitor would say it, in the language of your answer: a few words, plain text, no links, emoji or formatting.',
  'Offer only things you can actually answer or do in this chat.',
  'When the visitor seems stuck, one reply may be a way out, such as asking for a person, if your instructions say how to reach one.',
].join(' ');

/** The call's arguments as JSON Schema, for strict mode. Limits are enforced on the server. */
export const SUGGEST_REPLIES_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      description: '2 to 4 replies in the visitor’s words, each under 80 characters.',
      items: { type: 'string' },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

/**
 * What the model gets back. It is the same for every call, so nothing the model wrote reaches it
 * again, and it keeps the model from listing the options in its answer.
 */
export const SUGGEST_REPLIES_OUTPUT: string = JSON.stringify(
  'The visitor sees these replies under your answer. Do not list them, and do not repeat anything you have already written.',
);

const args = z.object({ items: z.array(z.unknown()) });

/**
 * The options in one call's arguments, as the model wrote them; `normalizeReplies` cleans them up.
 * Undefined when the arguments don't parse.
 */
export function suggestedReplies(json: string): readonly string[] | undefined {
  try {
    const parsed = args.safeParse(JSON.parse(json));
    return parsed.success
      ? parsed.data.items.filter((item): item is string => typeof item === 'string')
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Finds the latest answer's suggested options in its turn's calls, for the history. Only an
 * answered call counts, as only a turn that went on after it sent its options.
 */
export const readSuggestedReplies = (
  calls: readonly StoredToolCall[],
): readonly string[] | undefined => {
  const call = calls.findLast(
    (stored) => stored.name === SUGGEST_REPLIES && stored.output !== undefined,
  );
  return call && suggestedReplies(call.arguments);
};
