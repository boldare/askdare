import { z } from 'zod';
import type { VisitorIdentity } from '../security/identity';

/**
 * OpenAI moderation for a bot's messages (ADR-0019). Each checked message costs one call to the
 * moderation endpoint before the turn goes on (docs/costs.md).
 */
export interface ModerationConfig {
  /**
   * OpenAI moderation model, for example `omni-moderation-latest`. Required: the library never
   * assumes a model.
   */
  readonly model: string;
  /**
   * What is checked: the visitor's message before it reaches the model, the finished answer
   * before the visitor sees it, or both. Checking output holds each answer back until it is
   * complete (docs/guardrails.md). Default `input`.
   */
  readonly check?: 'input' | 'output' | 'both';
  /**
   * Moderation categories that block, such as `harassment` or `self-harm/intent`. Default: any
   * category the model flags.
   */
  readonly categories?: readonly string[];
  /** What the visitor sees when moderation blocks a message. Default: the `error.content_blocked` text. */
  readonly message?: string;
}

/** Who and what a guardrail hook is checking, besides the text itself. */
export interface GuardContext {
  /** The bot's `id`. */
  readonly bot: string;
  /** Validated BCP 47 tag chosen by the widget. */
  readonly locale: string;
  /** The signed-in user, verified with IDENTITY_SECRET (ADR-0009); undefined when anonymous. */
  readonly identity?: VisitorIdentity | undefined;
}

/**
 * What an `onInput` or `onOutput` hook decides: let the text through, block the turn (with an
 * optional text for the visitor, at most 300 characters), or replace the text. Returning
 * `undefined` lets it through.
 */
export type GuardVerdict =
  | { readonly action: 'allow' }
  | { readonly action: 'block'; readonly message?: string }
  | { readonly action: 'redact'; readonly text: string };

/** An `onInput` or `onOutput` hook. Runs on the server; whatever it throws lets the text through. */
export type GuardHook = (
  text: string,
  context: GuardContext,
) => GuardVerdict | undefined | Promise<GuardVerdict | undefined>;

/** The guardrail options of `defineBot` (ADR-0019). Every one is off when absent. */
export interface GuardrailOptions {
  /** OpenAI moderation on input, output or both. Off when absent. */
  readonly moderation?: ModerationConfig | undefined;
  /**
   * Your own rule for each visitor message, before it reaches the model (and before moderation):
   * allow it, block the turn, or replace the text the model gets. Files and the page's
   * description are not passed to it.
   */
  readonly onInput?: GuardHook | undefined;
  /**
   * Your own rule for each finished answer, before the visitor sees it (and before moderation).
   * Setting it holds every answer back until it is complete (docs/guardrails.md).
   */
  readonly onOutput?: GuardHook | undefined;
  /**
   * `untrusted` hands your tools' results to the model wrapped as third-party data that it must
   * not follow as instructions (prompt-injection hardening, ADR-0004). Recommended for tools that
   * return text from outside your control. Default `trusted`: results go to the model as they are.
   */
  readonly toolResults?: 'trusted' | 'untrusted' | undefined;
}

/** The guardrails of a resolved bot. Internal. */
export interface Guardrails {
  readonly moderation:
    | {
        readonly model: string;
        readonly input: boolean;
        readonly output: boolean;
        /** Undefined: any flagged category blocks. */
        readonly categories: readonly string[] | undefined;
        readonly message: string | undefined;
      }
    | undefined;
  readonly onInput: GuardHook | undefined;
  readonly onOutput: GuardHook | undefined;
  readonly toolResults: 'trusted' | 'untrusted';
}

/** Longest text a block may show the visitor. */
export const MAX_BLOCK_MESSAGE = 300;

const hook = z.custom<GuardHook>((value) => typeof value === 'function', 'must be a function');

/** The guardrail keys of the bot definition schema. */
export const guardrailShape: z.ZodRawShape = {
  moderation: z
    .object({
      model: z.string().trim().min(1, 'is required'),
      check: z.enum(['input', 'output', 'both']).optional(),
      categories: z.array(z.string().trim().min(1).max(64)).min(1).max(30).optional(),
      message: z.string().trim().min(1).max(MAX_BLOCK_MESSAGE).optional(),
    })
    .strict()
    .optional(),
  onInput: hook.optional(),
  onOutput: hook.optional(),
  toolResults: z.enum(['trusted', 'untrusted']).optional(),
};

/** Fills in the defaults: everything off. */
export function resolveGuardrails(options: GuardrailOptions): Guardrails {
  const { moderation } = options;
  const check = moderation?.check ?? 'input';
  return Object.freeze({
    moderation: moderation
      ? Object.freeze({
          model: moderation.model.trim(),
          input: check !== 'output',
          output: check !== 'input',
          categories: moderation.categories
            ? Object.freeze(moderation.categories.map((category) => category.trim()))
            : undefined,
          message: moderation.message?.trim(),
        })
      : undefined,
    onInput: options.onInput,
    onOutput: options.onOutput,
    toolResults: options.toolResults ?? 'trusted',
  });
}

/** Whether visitor messages are checked before the model sees them. */
export const checksInput = (guardrails: Guardrails): boolean =>
  guardrails.onInput !== undefined || guardrails.moderation?.input === true;

/** Whether answers are checked, and so held back until complete. */
export const checksOutput = (guardrails: Guardrails): boolean =>
  guardrails.onOutput !== undefined || guardrails.moderation?.output === true;
