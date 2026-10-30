import { z } from 'zod';
import { canonicalLocale, TEXT_KEYS, type TextKey, textsFor } from '../i18n/texts';
import type { VisitorIdentity } from '../security/identity';
import { PRESET_NAMES, type PresetName } from '../theme/presets';
import {
  type ColorScheme,
  type ResolvedTheme,
  resolveTheme,
  type ThemeDefinition,
  themeDefinitionSchema,
  themeWarnings,
} from '../theme/theme';
import type { Tool } from '../tools/define-tool';

/** Per-request context available when building instructions. */
export interface BotContext {
  /** Validated BCP 47 tag chosen by the widget. */
  readonly locale: string;
  /** The signed-in user, verified with IDENTITY_SECRET (ADR-0009); undefined when anonymous. */
  readonly identity?: VisitorIdentity | undefined;
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
  /** File uploads per visitor per hour, when attachments are on. Default 20. */
  readonly uploadsPerVisitorPerHour?: number;
  /** File uploads per client IP per hour, across visitors. Default 60. */
  readonly uploadsPerIpPerHour?: number;
  /** File uploads per UTC day across all visitors; bounds storage, since unsent files cost no tokens. Default 500. */
  readonly uploadsPerDay?: number;
  /** Dictations per visitor per hour, when voice input is on. Default 30. */
  readonly transcriptionsPerVisitorPerHour?: number;
  /** Seconds of speech transcribed per UTC day across all visitors (billed by duration). Default 3600. */
  readonly voiceSecondsPerDay?: number;
  /** Seconds of speech transcribed per client IP per UTC day. Default 600. */
  readonly voiceSecondsPerIpPerDay?: number;
}

export interface BotSecurity {
  /**
   * Origins allowed to embed the widget, e.g. `https://www.example.com`. The app's own origin is
   * always allowed. Enforced by the browser through `frame-ancestors` (ADR-0004, ADR-0005).
   */
  readonly allowedOrigins?: readonly string[];
}

export interface KnowledgeConfig {
  /** Vector store filled by `askdare kb sync`, usually `process.env.KB_VECTOR_STORE_ID`. */
  readonly vectorStoreId: string;
  /** Chunks the model reads per search: more grounds answers better but costs input tokens. Default 5. */
  readonly maxResults?: number;
}

export interface AttachmentConfig {
  /** PNG, JPEG, WebP and GIF. The widget downsizes photos and strips their metadata. Default true. */
  readonly images?: boolean;
  /** PDF documents; the model reads their text and page images. Default true. */
  readonly pdf?: boolean;
  /** Largest file in bytes. Default 4 MB, which fits Vercel's 4.5 MB request body limit. */
  readonly maxBytes?: number;
  /** Files per message. Default 3. */
  readonly maxPerMessage?: number;
  /**
   * Longest PDF accepted. Each page costs about 2,000 input tokens, reserved before the turn; a
   * PDF whose pages can't be counted is charged as if it had this many. Default 50.
   */
  readonly maxPdfPages?: number;
}

export interface VoiceConfig {
  /** OpenAI transcription model, for example `gpt-transcribe`. Required: the library never assumes a model. */
  readonly model: string;
  /** Longest dictation; recording stops by itself at this point. Default 60 seconds. */
  readonly maxSeconds?: number;
}

/** Public widget settings. Everything here is sent to browsers, so never put secrets in it. */
export interface WidgetConfig {
  /** Shortcut for `texts['header.title']`. */
  readonly title?: string;
  /** Under the title, for example "Usually replies in a minute". */
  readonly subtitle?: string;
  /** Shortcut for `texts['welcome.greeting']`. */
  readonly greeting?: string;
  /** Shortcut for `texts['composer.placeholder']`. */
  readonly placeholder?: string;
  /**
   * BCP 47 tag for the widget's texts and the default answer language, or `auto`: the language
   * of the page embedding the widget, else the visitor's browser. Texts ship in English and
   * Polish; other languages show English unless you set `texts`. Default `en`.
   */
  readonly locale?: string;
  /** Overrides for any text the widget shows, by key (see the dictionary in the docs). */
  readonly texts?: Readonly<Partial<Record<TextKey, string>>>;
  /**
   * The note that visitors are talking to an AI (EU AI Act, art. 50), shown under the message
   * field, with an optional link to your privacy policy (an https URL or a path on your app).
   * `false` hides it; only do that when your page already says so. Default: shown, no link.
   */
  readonly disclosure?: false | { readonly privacyUrl?: string };
  /**
   * Your own CSS for the chat, loaded after the theme. It is not in the library's layer, so it
   * wins without !important. Target `[data-ask-part]` parts and the `--ask-*` tokens.
   */
  readonly css?: string;
  /** Suggested questions on the welcome screen; a click sends one. Up to 4. */
  readonly starters?: readonly string[];
  /** The assistant's picture: a path on your app such as `/avatar.png`, or a small data: image. */
  readonly avatar?: string;
  /** Text on the pill launcher; shortcut for `texts['launcher.label']`. */
  readonly launcherLabel?: string;
  /** Built-in look (`halo`, `aura`, `sage`, `care`) or a theme from `defineTheme`. Default `aura`. */
  readonly theme?: PresetName | ThemeDefinition;
  /** Default `auto`: follows the visitor's system setting. */
  readonly colorScheme?: ColorScheme;
}

/** Widget settings with defaults applied and the theme resolved. */
export interface BotWidget {
  /** In the configured locale (English for `auto`); the visitor may see another language. */
  readonly title: string;
  readonly subtitle: string;
  readonly greeting: string;
  readonly placeholder: string;
  /** The configured BCP 47 tag, or `auto`. */
  readonly locale: string;
  readonly starters: readonly string[];
  readonly avatar: string | undefined;
  readonly launcherLabel: string;
  /** Text overrides, including the title, greeting, placeholder and launcher label shortcuts. */
  readonly texts: Readonly<Partial<Record<TextKey, string>>>;
  readonly disclosure: false | { readonly privacyUrl: string | undefined };
  readonly css: string;
  readonly theme: ResolvedTheme;
}

export interface BotDefinition {
  /** URL-safe identifier used in the script tag (`data-bot`) and routes. */
  readonly id: string;
  /** OpenAI model ID. Required on purpose: the library never assumes a model (ADR-0002). */
  readonly model: string;
  readonly instructions: string | ((context: BotContext) => string);
  readonly limits?: BotLimits;
  /** Server-side functions the model may call; see `defineTool`. Keep it under about 20. */
  readonly tools?: readonly Tool[];
  /**
   * Accept a description of the page from `askdare('configure', { context })` and pass it to the
   * model with the visitor's message. Any script on the page, or the visitor, can set it, so it
   * gets no more trust than what visitors type. Off by default.
   */
  readonly pageContext?: boolean;
  /** Documents the model searches with OpenAI file search and cites in its answers. */
  readonly knowledge?: KnowledgeConfig | undefined;
  /**
   * Lets visitors attach images and PDFs. Off when absent. Files go to OpenAI (purpose
   * `user_data`) and expire after 30 days, or when the visitor deletes the conversation.
   */
  readonly attachments?: AttachmentConfig | undefined;
  /**
   * Lets visitors dictate messages: speech is transcribed by OpenAI into the message field, where
   * they can check it before sending. Off when absent.
   */
  readonly voice?: VoiceConfig | undefined;
  readonly security?: BotSecurity;
  readonly widget?: WidgetConfig;
}

export interface Bot {
  readonly id: string;
  readonly model: string;
  readonly instructions: (context: BotContext) => string;
  readonly limits: Required<BotLimits>;
  readonly tools: readonly Tool[];
  readonly pageContext: boolean;
  readonly knowledge: Required<KnowledgeConfig> | undefined;
  readonly attachments: Required<AttachmentConfig> | undefined;
  readonly voice: Required<VoiceConfig> | undefined;
  readonly security: { readonly allowedOrigins: readonly string[] };
  readonly widget: BotWidget;
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
  uploadsPerVisitorPerHour: 20,
  uploadsPerIpPerHour: 60,
  uploadsPerDay: 500,
  transcriptionsPerVisitorPerHour: 30,
  voiceSecondsPerDay: 3_600,
  voiceSecondsPerIpPerDay: 600,
};

/** An https URL or a path on your app (no protocol-relative URLs). */
const LINK = /^(https:\/\/[^\s"'<>\\]{1,500}|\/(?![/\\])[^\s"'<>\\]{0,500})$/;

/** A same-origin path (served by your app, allowed by the iframe CSP) or a small raster data URL. */
const AVATAR =
  /^(\/(?!\/)[\w\-./%]{1,200}|data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]{1,90000})$/;

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
      uploadsPerVisitorPerHour: z.number().int().min(1).max(1_000).optional(),
      uploadsPerIpPerHour: z.number().int().min(1).max(10_000).optional(),
      uploadsPerDay: z.number().int().min(1).max(1_000_000).optional(),
      transcriptionsPerVisitorPerHour: z.number().int().min(1).max(1_000).optional(),
      voiceSecondsPerDay: z.number().int().min(60).optional(),
      voiceSecondsPerIpPerDay: z.number().int().min(60).optional(),
    })
    .optional(),
  tools: z
    .array(
      z.custom<Tool>(
        (value) => typeof value === 'object' && value !== null && 'execute' in value,
        'must be created with defineTool()',
      ),
    )
    .max(64)
    .refine(
      (tools) => new Set(tools.map((tool) => tool.name)).size === tools.length,
      'must have unique names',
    )
    .refine(
      (tools) => tools.every((tool) => tool.name !== 'file_search'),
      'must not use the reserved name file_search',
    )
    .optional(),
  pageContext: z.boolean().optional(),
  knowledge: z
    .object({
      vectorStoreId: z.string().regex(/^vs_[A-Za-z0-9_-]+$/, 'must be a vector store ID like vs_…'),
      maxResults: z.number().int().min(1).max(50).optional(),
    })
    .optional(),
  attachments: z
    .object({
      images: z.boolean().optional(),
      pdf: z.boolean().optional(),
      maxBytes: z.number().int().min(1_000).max(20_000_000).optional(),
      maxPerMessage: z.number().int().min(1).max(10).optional(),
      maxPdfPages: z.number().int().min(1).max(500).optional(),
    })
    .refine((value) => value.images !== false || value.pdf !== false, 'must allow images or pdf')
    .optional(),
  voice: z
    .object({
      model: z.string().trim().min(1, 'is required'),
      maxSeconds: z.number().int().min(5).max(300).optional(),
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
        .refine(
          (value) => value === 'auto' || canonicalLocale(value) !== undefined,
          'must be auto or a BCP 47 tag like en or pl-PL',
        )
        .optional(),
      texts: z
        .partialRecord(
          z.enum(TEXT_KEYS as [TextKey, ...TextKey[]]),
          z.string().trim().min(1).max(300),
        )
        .optional(),
      disclosure: z
        .union([
          z.literal(false),
          z
            .object({
              privacyUrl: z
                .string()
                .regex(LINK, 'must be an https URL or a path like /privacy')
                .optional(),
            })
            .strict(),
        ])
        .optional(),
      css: z.string().max(50_000).optional(),
      subtitle: z.string().trim().min(1).max(120).optional(),
      starters: z.array(z.string().trim().min(1).max(80)).max(4).optional(),
      avatar: z
        .string()
        .regex(AVATAR, 'must be a path like /avatar.png or a PNG, JPEG, WebP or GIF data URL')
        .optional(),
      launcherLabel: z.string().trim().min(1).max(40).optional(),
      theme: z.union([z.enum(PRESET_NAMES), themeDefinitionSchema]).optional(),
      colorScheme: z.enum(['auto', 'light', 'dark']).optional(),
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
    throw new TypeError(`[askdare] Invalid bot "${String(definition.id)}": ${issues}`);
  }
  const { instructions } = definition;
  const widget = definition.widget ?? {};
  const locale = widget.locale ?? 'en';
  // The old shortcuts are text overrides, so a configured greeting wins in every language.
  const overrides: Readonly<Partial<Record<TextKey, string>>> = Object.freeze({
    ...widget.texts,
    ...(widget.title ? { 'header.title': widget.title } : {}),
    ...(widget.greeting ? { 'welcome.greeting': widget.greeting } : {}),
    ...(widget.placeholder ? { 'composer.placeholder': widget.placeholder } : {}),
    ...(widget.launcherLabel ? { 'launcher.label': widget.launcherLabel } : {}),
  });
  const texts = textsFor(locale === 'auto' ? 'en' : locale, overrides);
  const theme = resolveTheme(definition.widget?.theme, definition.widget?.colorScheme ?? 'auto');
  // Built-in presets are checked in CI; a customized theme is checked here, in development.
  if (
    typeof definition.widget?.theme === 'object' &&
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[
      'NODE_ENV'
    ] !== 'production'
  ) {
    for (const warning of themeWarnings(theme)) {
      console.warn(`[askdare] Bot "${definition.id}" theme: ${warning}.`);
    }
  }
  return Object.freeze({
    id: definition.id,
    model: definition.model.trim(),
    instructions: typeof instructions === 'string' ? () => instructions : instructions,
    limits: Object.freeze({ ...DEFAULT_LIMITS, ...definition.limits }),
    tools: Object.freeze([...(definition.tools ?? [])]),
    pageContext: definition.pageContext ?? false,
    knowledge: definition.knowledge
      ? Object.freeze({
          vectorStoreId: definition.knowledge.vectorStoreId,
          maxResults: definition.knowledge.maxResults ?? 5,
        })
      : undefined,
    attachments: definition.attachments
      ? Object.freeze({
          images: definition.attachments.images ?? true,
          pdf: definition.attachments.pdf ?? true,
          maxBytes: definition.attachments.maxBytes ?? 4_000_000,
          maxPerMessage: definition.attachments.maxPerMessage ?? 3,
          maxPdfPages: definition.attachments.maxPdfPages ?? 50,
        })
      : undefined,
    voice: definition.voice
      ? Object.freeze({
          model: definition.voice.model.trim(),
          maxSeconds: definition.voice.maxSeconds ?? 60,
        })
      : undefined,
    security: Object.freeze({
      allowedOrigins: Object.freeze([...new Set(definition.security?.allowedOrigins ?? [])]),
    }),
    widget: Object.freeze({
      title: texts['header.title'] ?? '',
      subtitle: widget.subtitle ?? '',
      greeting: texts['welcome.greeting'] ?? '',
      placeholder: texts['composer.placeholder'] ?? '',
      locale,
      starters: Object.freeze([...(widget.starters ?? [])]),
      avatar: widget.avatar,
      launcherLabel: texts['launcher.label'] ?? '',
      texts: overrides,
      disclosure:
        widget.disclosure === false
          ? false
          : Object.freeze({ privacyUrl: widget.disclosure?.privacyUrl }),
      css: widget.css ?? '',
      theme,
    }),
  });
}
