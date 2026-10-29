import { z } from 'zod';

/** Per-request context available when building instructions. */
export interface BotContext {
  /** Validated BCP 47 tag chosen by the widget. */
  readonly locale: string;
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
  /** Input plus output tokens per UTC day across all visitors; then `budget_exceeded`. Default 2 000 000. */
  readonly dailyTokens?: number;
  /** Input plus output tokens per client IP per UTC day. Default 200 000. */
  readonly dailyTokensPerIp?: number;
  /** New sessions per client IP per hour (renewals by returning visitors count separately). Default 30. */
  readonly sessionsPerIpPerHour?: number;
  /** New conversations per client IP per hour. Default 20. */
  readonly conversationsPerIpPerHour?: number;
  /** Messages per visitor per minute. Default 10. */
  readonly messagesPerVisitorPerMinute?: number;
  /** Messages per client IP per minute, across visitors. Default 30. */
  readonly messagesPerIpPerMinute?: number;
  /** Turns per conversation before the visitor must start a new one. Default 50. */
  readonly maxTurns?: number;
}

export interface BotSecurity {
  /**
   * Origins allowed to embed the widget, e.g. `https://www.example.com`. The app's own origin is
   * always allowed. Enforced by the browser through `frame-ancestors` (ADR-0004, ADR-0005).
   */
  readonly allowedOrigins?: readonly string[];
}

/** Public widget settings. Everything here is sent to browsers, so never put secrets in it. */
export interface WidgetConfig {
  readonly title?: string;
  readonly greeting?: string;
  readonly placeholder?: string;
  /** BCP 47 tag for UI texts and the default answer language. Default `en`. */
  readonly locale?: string;
}

export interface BotDefinition {
  /** URL-safe identifier used in the script tag (`data-bot`) and routes. */
  readonly id: string;
  /** OpenAI model ID. Required on purpose: the library never assumes a model (ADR-0002). */
  readonly model: string;
  readonly instructions: string | ((context: BotContext) => string);
  readonly limits?: BotLimits;
  readonly security?: BotSecurity;
  readonly widget?: WidgetConfig;
}

export interface Bot {
  readonly id: string;
  readonly model: string;
  readonly instructions: (context: BotContext) => string;
  readonly limits: Required<BotLimits>;
  readonly security: { readonly allowedOrigins: readonly string[] };
  readonly widget: Required<WidgetConfig>;
}

const DEFAULT_LIMITS: Required<BotLimits> = {
  maxOutputTokens: 1024,
  maxInputChars: 4000,
  maxSteps: 5,
  turnTimeoutMs: 120_000,
  dailyTokens: 2_000_000,
  dailyTokensPerIp: 200_000,
  sessionsPerIpPerHour: 30,
  conversationsPerIpPerHour: 20,
  messagesPerVisitorPerMinute: 10,
  messagesPerIpPerMinute: 30,
  maxTurns: 50,
};

const DEFAULT_WIDGET: Required<WidgetConfig> = {
  title: 'Assistant',
  greeting: 'Hi! How can I help?',
  placeholder: 'Type your message…',
  locale: 'en',
};

const origin = z.string().refine((value) => {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          /^(localhost|127\.0\.0\.1|\[::1\]|.+\.localhost)$/.test(url.hostname))) &&
      url.origin === value &&
      /^[a-z0-9.-]+$|^\[[0-9a-f:]+\]$/i.test(url.hostname)
    );
  } catch {
    return false;
  }
}, 'must be an https origin like https://www.example.com (no path or wildcard; http only for localhost)');

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
      dailyTokens: z.number().int().min(1_000).optional(),
      dailyTokensPerIp: z.number().int().min(100).optional(),
      sessionsPerIpPerHour: z.number().int().min(1).max(10_000).optional(),
      conversationsPerIpPerHour: z.number().int().min(1).max(10_000).optional(),
      messagesPerVisitorPerMinute: z.number().int().min(1).max(1_000).optional(),
      messagesPerIpPerMinute: z.number().int().min(1).max(10_000).optional(),
      maxTurns: z.number().int().min(1).max(1_000).optional(),
    })
    .optional(),
  security: z.object({ allowedOrigins: z.array(origin).max(50).optional() }).optional(),
  widget: z
    .object({
      title: z.string().trim().min(1).max(80).optional(),
      greeting: z.string().trim().min(1).max(500).optional(),
      placeholder: z.string().trim().min(1).max(120).optional(),
      locale: z
        .string()
        .regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/, 'must be a BCP 47 tag like en or pl-PL')
        .optional(),
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
    security: Object.freeze({
      allowedOrigins: Object.freeze([...new Set(definition.security?.allowedOrigins ?? [])]),
    }),
    widget: Object.freeze({ ...DEFAULT_WIDGET, ...definition.widget }),
  });
}
