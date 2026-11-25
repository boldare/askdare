import type { FeedbackHandle } from './events';
import type { ToolUi } from './tool-ui';

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
  /** On answers: the payloads their turn's tools defined, as in the `tool.ui` events (ADR-0017). */
  readonly ui?: readonly ToolUi[] | undefined;
}

export interface HistoryCitation {
  readonly index: number;
  readonly title: string;
  readonly url?: string | undefined;
}

/** The longest `before` cursor, in the response and in the request. */
export const HISTORY_CURSOR_MAX = 4096;

/**
 * One page of whole turns (ADR-0024, decision 7): the latest without `before` in the request,
 * then each older one in turn.
 */
export interface HistoryResponse {
  /** Oldest first. A turn (a visitor message and the answers to it) is never split across pages. */
  readonly messages: readonly HistoryMessage[];
  /**
   * Send as `before` to read the next older page. Opaque, and valid only for this conversation.
   * Absent on the oldest page.
   */
  readonly before?: string | undefined;
}
