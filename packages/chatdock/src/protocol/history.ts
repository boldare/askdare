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
