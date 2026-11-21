import type { Bot, BotContext } from '../bot/define-bot';
import { type GuardHook, type GuardVerdict, MAX_BLOCK_MESSAGE } from '../bot/guardrails';
import { AskdareError } from '../errors';
import type { ModelGateway } from '../gateway';

/** What a check decided, with the text to use when it was replaced. */
export type GuardOutcome =
  | { readonly action: 'allow' }
  | { readonly action: 'redact'; readonly text: string }
  | {
      readonly action: 'block';
      /** The visitor's text; undefined: the localized `error.content_blocked`. */
      readonly message: string | undefined;
      /** What blocked it, for the server's log: a hook or moderation categories, never content. */
      readonly reason: string;
    };

export interface GuardOptions {
  readonly bot: Bot;
  readonly gateway: ModelGateway;
  readonly context: BotContext;
  /** The turn's deadline; a check still running when it fires ends the turn as a timeout. */
  readonly signal: AbortSignal;
}

const ALLOW: GuardOutcome = { action: 'allow' };

/** What a failing hook is logged as: its error's name, never its message, which may hold data. */
const errorName = (error: unknown): string => (error instanceof Error ? error.name : typeof error);

/** Settles with the work, or rejects with the signal's reason once it aborts. */
function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** A verdict as askdare uses it; anything malformed lets the text through, like a failing hook. */
function normalize(verdict: unknown, name: string): GuardOutcome | undefined {
  if (verdict === undefined) return ALLOW;
  if (typeof verdict !== 'object' || verdict === null) return undefined;
  const { action, message, text } = verdict as Record<string, unknown>;
  if (action === 'allow') return ALLOW;
  if (action === 'redact' && typeof text === 'string') return { action: 'redact', text };
  if (action === 'block') {
    const shown = typeof message === 'string' ? message.trim() : '';
    return {
      action: 'block',
      message: shown === '' ? undefined : shown.slice(0, MAX_BLOCK_MESSAGE),
      reason: name,
    };
  }
  return undefined;
}

/**
 * Runs an `onInput` or `onOutput` hook in isolation (ADR-0012): whatever it throws or returns
 * malformed lets the text through, with one log line naming the hook and nothing it saw.
 */
async function runHook(
  name: 'onInput' | 'onOutput',
  hook: GuardHook,
  text: string,
  options: GuardOptions,
): Promise<GuardOutcome> {
  const { bot, context, signal } = options;
  let verdict: GuardVerdict | undefined;
  try {
    verdict = await bounded(
      Promise.resolve().then(() =>
        hook(text, { bot: bot.id, locale: context.locale, identity: context.identity }),
      ),
      signal,
    );
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    console.error(`[askdare] the ${name} hook failed, so the message passed: ${errorName(error)}`);
    return ALLOW;
  }
  const outcome = normalize(verdict, name);
  if (outcome) return outcome;
  console.error(`[askdare] the ${name} hook returned no valid verdict, so the message passed.`);
  return ALLOW;
}

/**
 * Classifies texts with the bot's moderation settings. When moderation can't answer, the text
 * passes, with one log line: like a hook, a check never breaks the chat (ADR-0012).
 */
async function runModeration(
  input: readonly string[],
  options: GuardOptions,
): Promise<GuardOutcome> {
  const { bot, gateway, signal } = options;
  const moderation = bot.guardrails.moderation;
  const texts = input.filter((text) => text.trim() !== '');
  if (!moderation || texts.length === 0) return ALLOW;
  if (!gateway.moderate) {
    console.error('[askdare] moderation is not available with this model gateway; skipped.');
    return ALLOW;
  }
  let flagged: boolean;
  let categories: readonly string[];
  try {
    ({ flagged, categories } = await bounded(
      gateway.moderate({ model: moderation.model, input: texts, signal }),
      signal,
    ));
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    const code = error instanceof AskdareError ? error.code : errorName(error);
    console.error(`[askdare] moderation failed, so the message passed: ${code}`);
    return ALLOW;
  }
  const blocking = moderation.categories
    ? categories.filter((category) => moderation.categories?.includes(category))
    : categories;
  const blocked = moderation.categories ? blocking.length > 0 : flagged;
  if (!blocked) return ALLOW;
  return {
    action: 'block',
    message: moderation.message,
    reason: `moderation (${blocking.join(', ') || 'flagged'})`,
  };
}

/** The error that ends a blocked turn. Its cause names the check, never the content. */
export function blockedError(
  outcome: GuardOutcome & { action: 'block' },
  stage: string,
): AskdareError {
  return new AskdareError('content_blocked', {
    ...(outcome.message === undefined ? {} : { message: outcome.message }),
    cause: `${stage} blocked by ${outcome.reason}`,
  });
}

/**
 * Checks a visitor's message before it reaches the model: `onInput` first, then moderation on the
 * text the model would get, with the page's description. Returns the text to send, or throws
 * `content_blocked`. Files are not checked.
 */
export async function guardInput(
  text: string,
  pageContext: string | undefined,
  options: GuardOptions,
): Promise<string> {
  const { onInput, moderation } = options.bot.guardrails;
  let checked = text;
  if (onInput && text !== '') {
    const outcome = await runHook('onInput', onInput, text, options);
    if (outcome.action === 'block') throw blockedError(outcome, 'input');
    if (outcome.action === 'redact') {
      checked = outcome.text.trim();
      if (checked === '')
        throw blockedError(
          { ...outcome, action: 'block', message: undefined, reason: 'onInput' },
          'input',
        );
    }
  }
  if (moderation?.input) {
    const outcome = await runModeration([checked, pageContext ?? ''], options);
    if (outcome.action === 'block') throw blockedError(outcome, 'input');
  }
  return checked;
}

/**
 * Checks a finished answer before the visitor sees it: `onOutput` first, then moderation on what
 * the visitor would see, with the reply options. An empty answer passes unchecked.
 */
export async function guardOutput(
  answer: string,
  replies: readonly string[],
  options: GuardOptions,
): Promise<GuardOutcome> {
  const { onOutput, moderation } = options.bot.guardrails;
  if (answer.trim() === '' && replies.length === 0) return ALLOW;
  let outcome: GuardOutcome = ALLOW;
  let shown = answer;
  if (onOutput && answer.trim() !== '') {
    outcome = await runHook('onOutput', onOutput, answer, options);
    if (outcome.action === 'block') return outcome;
    if (outcome.action === 'redact') {
      shown = outcome.text;
      if (shown.trim() === '') return { action: 'block', message: undefined, reason: 'onOutput' };
    }
  }
  if (moderation?.output) {
    const moderated = await runModeration([shown, ...replies], options);
    if (moderated.action === 'block') return moderated;
  }
  return outcome;
}
