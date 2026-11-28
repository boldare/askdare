/**
 * The `AdminStore` port (ADR-0032, extending ADR-0016): where the admin console and the dashboard
 * read usage, ratings, transcripts and counts from. Core writes the records itself, from the values
 * it hands `onUsage`, `onFeedback` and `onTranscript`; deleting a conversation, or sweeping it,
 * deletes its records too. `memoryAdminStore()` keeps them in memory for tests, and add-ons such as
 * `@boldare/askdare-postgres` and `@boldare/askdare-upstash` in a database.
 *
 * Every query is fixed and bounded by a day range and a limit, so a key-value store can answer it
 * from aggregates kept at write time. Handoffs and leads are counted, never stored (ADR-0032,
 * decision 6): no lead values or handoff details reach this port.
 */
import type { ConversationStoreCheck } from '../conversations/port';
import type { ErrorCode, MessageEndReason } from '../protocol/events';
import type { ChatTokenUsage } from '../server/usage-report';

/** Where a record came from: the chat, or the console's playground, which the dashboard leaves out. */
export type AdminSource = 'chat' | 'console';

/** Who and what a record belongs to. Every record has these, so delete and retention work alike. */
export interface AdminRecordKey {
  readonly bot: string;
  /**
   * The conversation store's ID. Kept on the server: the console's browser gets sealed references,
   * never this value (ADR-0032, decision 8).
   */
  readonly conversationId: string;
  /** The pseudonym `onUsage` reports (an HMAC of the user or visitor). Never a raw ID or an IP. */
  readonly visitor: string;
  /** Epoch milliseconds; the record's day (UTC) and its retention count from here. */
  readonly at: number;
  /** `console` for playground turns, so the dashboard can leave them out. */
  readonly source: AdminSource;
}

/** What output checks decided about an answer (ADR-0022), when the bot has them. */
export type AdminCheckOutcome = 'allowed' | 'replaced' | 'withheld';

/** One turn: counters only, never content. Written for every turn when a store is set. */
export interface AdminTurnRecord extends AdminRecordKey {
  readonly model: string;
  readonly durationMs: number;
  readonly outcome: 'completed' | 'stopped' | 'failed';
  readonly finishReason?: MessageEndReason | undefined;
  readonly errorCode?: ErrorCode | undefined;
  /** The turn's usage plus its compaction's, if any. */
  readonly usage: ChatTokenUsage;
  readonly steps: number;
  /** Names and outcomes only, as `ChatToolCallReport` without timings. */
  readonly tools: readonly {
    readonly name: string;
    readonly outcome: 'ok' | 'error' | 'timeout';
  }[];
  /** Sources shown with the answer. */
  readonly citations: number;
  readonly check?: AdminCheckOutcome | undefined;
  /** The turn created the conversation; counted in `AdminBotDayRow.conversations`. */
  readonly newConversation: boolean;
  /**
   * The turn counts as an unanswered question (ADR-0032, decision 5), as core decides it: a
   * completed answer with no citations from a bot with knowledge, or a withheld or failed one.
   * Counted in `AdminDayRow.unanswered`. Core decides, so every store counts the same turns.
   */
  readonly unanswered: boolean;
}

/** One rating. A later rating of the same answer replaces it; `rating: null` removes it. */
export interface AdminRatingRecord extends AdminRecordKey {
  /** The rated answer. A rating is keyed by its conversation and this ID. */
  readonly itemId: string;
  readonly rating: 'up' | 'down' | null;
  /** Up to 500 characters, the visitor's own words: personal data, never logged. */
  readonly comment?: string | undefined;
}

/** A stored rating: a removed one (`rating: null`) is never returned. */
export type AdminStoredRating = AdminRatingRecord & { readonly rating: 'up' | 'down' };

/** A source cited in a transcript. */
export interface AdminTranscriptCitation {
  readonly index: number;
  readonly title: string;
  readonly url?: string | undefined;
}

/** One turn's text: written only with `admin.transcripts: true`. */
export interface AdminTranscriptRecord extends AdminRecordKey {
  readonly itemId?: string | undefined;
  readonly input: string;
  readonly attachments: number;
  readonly answer: string | undefined;
  readonly citations: readonly AdminTranscriptCitation[];
  readonly check?: AdminCheckOutcome | undefined;
  readonly reason: MessageEndReason;
}

/** ADR-0030's final states of a handoff; `requested` is never counted. */
export type AdminHandoffState = 'sent' | 'saved' | 'unavailable' | 'failed' | 'limited';

/**
 * A handoff or a lead, counted (ADR-0032, decision 6). No conversation, visitor, reason, contact
 * details or form values: only what a daily counter needs.
 */
export type AdminCountEvent =
  | {
      readonly kind: 'handoff';
      readonly bot: string;
      readonly at: number;
      readonly source: AdminSource;
      readonly state: AdminHandoffState;
    }
  | {
      readonly kind: 'lead';
      readonly bot: string;
      readonly at: number;
      readonly source: AdminSource;
    };

/** A day range in UTC, `from` and `to` as `YYYY-MM-DD`, both included, at most 400 days. */
export interface AdminRange {
  readonly from: string;
  readonly to: string;
  readonly bot?: string | undefined;
  /** Default `chat`: playground records are left out. */
  readonly source?: AdminSource | 'all' | undefined;
}

/** Daily totals per bot and model, kept as counters at write time. */
export interface AdminDayRow {
  readonly day: string;
  readonly bot: string;
  readonly model: string;
  readonly turns: number;
  readonly failed: number;
  readonly unanswered: number;
  readonly usage: ChatTokenUsage;
}

/** Handoffs per final state. */
export type AdminHandoffCounts = { readonly [State in AdminHandoffState]: number };

/** Daily totals per bot, for what has no model: conversations, ratings, leads and handoffs. */
export interface AdminBotDayRow {
  readonly day: string;
  readonly bot: string;
  readonly conversations: number;
  readonly up: number;
  readonly down: number;
  readonly leads: number;
  readonly handoffs: AdminHandoffCounts;
}

/** What `days()` returns: rows ordered by day, then bot, then model. */
export interface AdminDays {
  readonly turns: readonly AdminDayRow[];
  readonly bots: readonly AdminBotDayRow[];
}

/** One conversation in the dashboard's lists, summed over the records the store still has. */
export interface AdminConversationSummary {
  readonly conversationId: string;
  readonly bot: string;
  readonly visitor: string;
  readonly firstAt: number;
  readonly lastAt: number;
  readonly turns: number;
  readonly usage: ChatTokenUsage;
  readonly up: number;
  readonly down: number;
  /** The store has transcript records of the conversation. */
  readonly transcript: boolean;
}

/** A page of a list. */
export interface AdminPage<T> {
  readonly items: readonly T[];
  /** Opaque; pass it back for the next page. Absent on the last page. */
  readonly cursor?: string | undefined;
}

/**
 * The conversations started in the range (their first record's day), newest or most expensive
 * first.
 */
export interface AdminConversationQuery extends AdminRange {
  /**
   * `tokens`: most input plus output tokens first; `latest`: latest activity first. Ties go to the
   * latest activity, then to the conversation ID.
   */
  readonly order: 'tokens' | 'latest';
  /** `down`: only conversations with at least one 👎. */
  readonly rated?: 'down' | undefined;
  /** 1 to 100. */
  readonly limit: number;
  readonly cursor?: string | undefined;
}

/** The ratings given in the range, newest first. */
export interface AdminRatingQuery extends AdminRange {
  readonly rating?: 'up' | 'down' | undefined;
  /** 1 to 100. */
  readonly limit: number;
  readonly cursor?: string | undefined;
}

/** What `sweep()` deletes. */
export interface AdminSweepOptions {
  /** Epoch milliseconds: records written before it go. */
  readonly recordsBefore: number;
  /** `YYYY-MM-DD`: daily rows of days before it go. */
  readonly daysBefore: string;
  /** At most this many deletions per call, records and daily rows together. */
  readonly limit: number;
}

/**
 * What core passes with every record it writes: the app's retention, so a store never needs its own
 * setting for it.
 */
export interface AdminWriteOptions {
  /**
   * `admin.retentionDays` (1 to 400): core's `sweep()` deletes a record this many days after its
   * `at`. A store that also lets records expire on its own, as a backstop for when `sweep()` doesn't
   * run, must not expire one sooner than this. Core always passes it; a store called without it
   * keeps records at least 400 days, the longest retention core allows.
   */
  readonly retentionDays?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * Where admin records live (ADR-0032). Every method takes an optional `signal` (the record writes in
 * their `AdminWriteOptions`); an aborted one
 * stops it before it writes or deletes more. Implementations never log the values they write: a
 * failure is reported by error class and code only. A query outside its bounds (a malformed day, a
 * range over 400 days, a limit outside 1 to 100, a cursor the store didn't issue) is refused.
 */
export interface AdminStore {
  /** Stable name for logs and diagnostics, such as `memory` or `postgres`. */
  readonly name: string;

  /**
   * Writes a turn and adds it to its daily rows. A turn of the same conversation at the same `at`
   * that is already stored is not written or counted again.
   */
  recordTurn(record: AdminTurnRecord, options?: AdminWriteOptions): Promise<void>;
  /**
   * Writes a rating and adjusts the daily counters. A rating of the same conversation and
   * `itemId` replaces the stored one, never adds; `rating: null` removes it.
   */
  recordRating(record: AdminRatingRecord, options?: AdminWriteOptions): Promise<void>;
  /**
   * Writes a turn's transcript. One of the same conversation, `at` and `itemId` replaces the stored
   * one.
   */
  recordTranscript(record: AdminTranscriptRecord, options?: AdminWriteOptions): Promise<void>;
  /** Increments a daily counter of handoffs or leads; nothing else is kept. */
  count(event: AdminCountEvent, signal?: AbortSignal): Promise<void>;

  /** Daily rows of the range. */
  days(range: AdminRange, signal?: AbortSignal): Promise<AdminDays>;
  conversations(
    query: AdminConversationQuery,
    signal?: AbortSignal,
  ): Promise<AdminPage<AdminConversationSummary>>;
  ratings(query: AdminRatingQuery, signal?: AbortSignal): Promise<AdminPage<AdminStoredRating>>;
  /** The conversation's transcript records, oldest first; empty without them. */
  transcript(
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<readonly AdminTranscriptRecord[]>;

  /**
   * Deletes every record of the conversation: turns, ratings, transcripts and its summary. Daily
   * rows stay: they hold no conversation or visitor. An unknown conversation is not an error, and
   * calling it twice is fine.
   */
  deleteConversation(conversationId: string, signal?: AbortSignal): Promise<void>;
  /**
   * Retention: deletes up to `limit` records written before `recordsBefore` and daily rows of days
   * before `daysBefore`, and resolves to how many it deleted. The caller calls again while that is
   * `limit`.
   */
  sweep(options: AdminSweepOptions, signal?: AbortSignal): Promise<number>;

  /**
   * The store's own checks for `askdare doctor`, such as its schema or whether it can be reached.
   * Core checks the retention itself (records older than `admin.retentionDays` mean `sweep()`
   * isn't running), with a bounded `conversations()` query, so a store doesn't repeat it.
   */
  diagnose?(signal?: AbortSignal): Promise<readonly ConversationStoreCheck[]>;
}
