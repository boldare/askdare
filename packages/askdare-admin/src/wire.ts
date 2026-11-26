/**
 * The JSON the dashboard's handlers answer with, shared by the server and the browser app. Internal:
 * none of it is exported from the package. Conversations are addressed by sealed references (`ref`)
 * only, never by their store IDs (ADR-0032, decision 8).
 */

/** Token counts of a row, as the store keeps them. */
export interface WireTokens {
  readonly input: number;
  readonly cachedInput: number;
  readonly output: number;
}

/** One bot, day and model. `cost` is `null` when the app passed no price for the model. */
export interface WireModelDay {
  readonly day: string;
  readonly bot: string;
  readonly model: string;
  readonly turns: number;
  readonly failed: number;
  readonly unanswered: number;
  readonly tokens: WireTokens;
  readonly cost: number | null;
}

/** One bot and day: what has no model. */
export interface WireBotDay {
  readonly day: string;
  readonly bot: string;
  readonly conversations: number;
  readonly up: number;
  readonly down: number;
  readonly leads: number;
  /** Handoffs in any final state but `limited`. */
  readonly handoffs: number;
  readonly limited: number;
  /** One minus handoffs over new conversations, from 0 to 1; `null` without new conversations. */
  readonly resolution: number | null;
}

/** Totals of the range. */
export interface WireTotals {
  readonly turns: number;
  readonly failed: number;
  readonly unanswered: number;
  readonly conversations: number;
  readonly up: number;
  readonly down: number;
  readonly leads: number;
  readonly handoffs: number;
  readonly resolution: number | null;
  readonly tokens: WireTokens;
  /** The cost of the priced models. */
  readonly cost: number;
  /** Models in the range the app passed no price for. */
  readonly unpriced: readonly string[];
}

/** The `days` action's answer. */
export interface WireDays {
  readonly from: string;
  readonly to: string;
  readonly bots: readonly string[];
  readonly models: readonly WireModelDay[];
  readonly days: readonly WireBotDay[];
  readonly totals: WireTotals;
}

/** A conversation in a list. */
export interface WireConversation {
  readonly ref: string;
  readonly bot: string;
  readonly firstAt: number;
  readonly lastAt: number;
  readonly turns: number;
  readonly tokens: WireTokens;
  /** `null` when a model of it has no price, or when the store doesn't say which model it used. */
  readonly cost: number | null;
  readonly up: number;
  readonly down: number;
  readonly transcript: boolean;
}

/** A rating in a list. */
export interface WireRating {
  readonly ref: string;
  readonly bot: string;
  readonly at: number;
  readonly rating: 'up' | 'down';
  readonly comment?: string | undefined;
}

/** A page of a list; `cursor` is sealed, absent on the last page. */
export interface WirePage<T> {
  readonly items: readonly T[];
  readonly cursor?: string | undefined;
}

/** One turn of a stored transcript, as text. */
export interface WireTranscriptTurn {
  readonly at: number;
  readonly input: string;
  readonly attachments: number;
  readonly answer: string | null;
  readonly citations: readonly {
    readonly index: number;
    readonly title: string;
    readonly url?: string | undefined;
  }[];
  readonly check?: 'allowed' | 'replaced' | 'withheld' | undefined;
  readonly reason: string;
}

/** The `transcript` action's answer: empty when the store keeps no transcript of it. */
export interface WireTranscript {
  readonly turns: readonly WireTranscriptTurn[];
}
