import { z } from 'zod';

/** Per-request context available when building instructions. Treat `pageUrl` as untrusted. */
export interface BotContext {
  readonly locale: string;
  readonly pageUrl?: string | undefined;
}

export interface BotLimits {
  /** Upper bound for each model response. Default 1024. */
  readonly maxOutputTokens?: number;
  /** Longest accepted user message, in characters. Default 4000. */
  readonly maxInputChars?: number;
  /** Model calls per turn, including tool round trips. Default 5. */
  readonly maxSteps?: number;
  /** Server-side deadline for a whole turn. Keep it below your route's `maxDuration`. Default 120 s. */
  readonly turnTimeoutMs?: number;
}

export interface BotDefinition {
  /** URL-safe identifier used in the script tag (`data-bot`) and routes. */
  readonly id: string;
  /** OpenAI model ID. Required on purpose: the library never assumes a model (ADR-0002). */
  readonly model: string;
  readonly instructions: string | ((context: BotContext) => string);
  readonly limits?: BotLimits;
}

export interface Bot {
  readonly id: string;
  readonly model: string;
  readonly instructions: (context: BotContext) => string;
  readonly limits: Required<BotLimits>;
}

const DEFAULT_LIMITS: Required<BotLimits> = {
  maxOutputTokens: 1024,
  maxInputChars: 4000,
  maxSteps: 5,
  turnTimeoutMs: 120_000,
};

const definitionSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/, 'use 1-48 lowercase letters, digits or dashes'),
  model: z.string().trim().min(1, 'is required'),
  instructions: z.union([z.string().trim().min(1, 'must not be empty'), z.function()]),
  limits: z
    .object({
      maxOutputTokens: z.number().int().min(16).max(128_000).optional(),
      maxInputChars: z.number().int().min(1).max(100_000).optional(),
      maxSteps: z.number().int().min(1).max(20).optional(),
      turnTimeoutMs: z.number().int().min(1_000).max(900_000).optional(),
    })
    .optional(),
});

/**
 * Declares a chatbot. Validates eagerly so misconfiguration fails at startup, not on the first
 * visitor's message.
 */
export function defineBot(definition: BotDefinition): Bot {
  const parsed = definitionSchema.safeParse(definition);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'} ${issue.message}`)
      .join('; ');
    throw new TypeError(`[chatdock] Invalid bot "${String(definition.id)}": ${issues}`);
  }
  const { instructions } = definition;
  return Object.freeze({
    id: definition.id,
    model: definition.model.trim(),
    instructions: typeof instructions === 'string' ? () => instructions : instructions,
    limits: Object.freeze({ ...DEFAULT_LIMITS, ...definition.limits }),
  });
}
