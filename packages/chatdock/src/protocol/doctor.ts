import { z } from 'zod';

/** One finding of `chatdock doctor`. Never contains secrets or OpenAI error messages. */
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
  readonly bots: readonly { readonly id: string; readonly checks: readonly DoctorCheck[] }[];
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
  bots: z.array(z.object({ id: z.string().max(48), checks: z.array(check).max(20) })).max(50),
});
