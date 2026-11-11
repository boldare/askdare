import type { FeedbackHandle } from './events';

/** One message of a stored conversation, as returned by `POST /history`. */
export interface HistoryMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly citations: readonly HistoryCitation[];
  /** Images or files sent with the message. Their content is not shown again (ADR-0003). */
  readonly attachments: number;
  /** On answers, when visitors may rate this bot's answers. */
  readonly feedback?: FeedbackHandle | undefined;
  /** On the latest answer only: the options it offered, as in the `replies` event (ADR-0015). */
  readonly replies?: readonly string[] | undefined;
}

export interface HistoryCitation {
  readonly index: number;
  readonly title: string;
  readonly url?: string | undefined;
}

export interface HistoryResponse {
  readonly messages: readonly HistoryMessage[];
}
