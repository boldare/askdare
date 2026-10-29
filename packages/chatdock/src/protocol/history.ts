import { z } from 'zod';

/** One message of a stored conversation, as returned by `POST /history`. */
export interface HistoryMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly citations: readonly HistoryCitation[];
  /** Images or files sent with the message. Their content is not shown again (ADR-0003). */
  readonly attachments: number;
}

export interface HistoryCitation {
  readonly index: number;
  readonly title: string;
  readonly url?: string | undefined;
}

export interface HistoryResponse {
  readonly messages: readonly HistoryMessage[];
}

/** Runtime validator used by clients. */
export const historyResponseSchema: z.ZodType<HistoryResponse> = z.object({
  messages: z.array(
    z.object({
      id: z.string().min(1).max(256),
      role: z.enum(['user', 'assistant']),
      text: z.string(),
      citations: z.array(
        z.object({
          index: z.number().int().min(1),
          title: z.string().min(1),
          url: z.url({ protocol: /^https?$/ }).optional(),
        }),
      ),
      attachments: z.number().int().min(0),
    }),
  ),
});
