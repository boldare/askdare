import { z } from 'zod';
import { isEmbedPath } from '../base-path';

/** One finding of `askdare doctor`. Never contains secrets or OpenAI error messages. */
export interface DoctorCheck {
  readonly status: 'ok' | 'warn' | 'fail';
  readonly title: string;
  /** What to do about a warning or failure. */
  readonly fix?: string | undefined;
}

/** What `POST {basePath}/doctor` reports about the running app. */
export interface DoctorReport {
  readonly development: boolean;
  /** Whether rate limits and budgets are shared across instances (e.g. Upstash). */
  readonly sharedLimits: boolean;
  readonly gallery: boolean;
  readonly bots: readonly {
    readonly id: string;
    readonly checks: readonly DoctorCheck[];
    /** How long one of the bot's answers may take, to compare with the route's maxDuration. */
    readonly turnTimeoutMs?: number | undefined;
    /** False when the bot hides the AI notice (`widget.disclosure: false`); absent from older apps. */
    readonly disclosure?: boolean | undefined;
    /** For a bot with `embedPath`: what its page must allow, for the CLI to check (ADR-0018). */
    readonly embed?: BotEmbed | undefined;
  }[];
}

/** A bot's own page in the widget's iframe, as the doctor report describes it. Nothing secret. */
export interface BotEmbed {
  readonly path: string;
  readonly allowedOrigins: readonly string[];
  readonly voice: boolean;
}

const check = z.object({
  status: z.enum(['ok', 'warn', 'fail']),
  title: z.string().max(500),
  fix: z.string().max(500).optional(),
});

export const doctorReportSchema: z.ZodType<DoctorReport> = z.object({
  development: z.boolean(),
  sharedLimits: z.boolean(),
  gallery: z.boolean(),
  bots: z
    .array(
      z.object({
        id: z.string().max(48),
        checks: z.array(check).max(20),
        turnTimeoutMs: z.number().int().positive().optional(),
        disclosure: z.boolean().optional(),
        embed: z
          .object({
            path: z.string().refine(isEmbedPath),
            allowedOrigins: z.array(z.string().max(300)).max(50),
            voice: z.boolean(),
          })
          .optional(),
      }),
    )
    .max(50),
});
