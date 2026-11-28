/**
 * `sweep()` on the handlers (ADR-0032, decision 4): deletes idle conversations with their files
 * and admin records, then the admin store's records past their retention. The app calls it from
 * its own cron route; askdare schedules nothing.
 */
import { dayOf } from '../admin/bounds';
import type { ConversationStore } from '../conversations/port';
import { AskdareError } from '../errors';
import type { ModelGateway } from '../gateway';
import type { AdminWriter } from './admin-records';
import { hookError } from './stream-turn';

const DAY_MS = 86_400_000;
/** Daily rows hold no personal data and are kept 400 days (ADR-0032, decision 4). */
const DAY_ROWS_DAYS = 400;
const CONVERSATION_BATCH = 25;
const RECORD_BATCH = 500;

export interface ChatSweepOptions {
  /** Conversations with no message for this many days are deleted. Default 30; 0 for all. */
  readonly idleDays?: number | undefined;
  /**
   * The most conversations one call deletes, default 100; admin records go in up to ten times as
   * many. `more` in the result says a later call has work left.
   */
  readonly limit?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface ChatSweepResult {
  /** Conversations deleted. */
  readonly conversations: number;
  /** Their attached files deleted. */
  readonly files: number;
  /** Admin records and daily rows deleted for their age. */
  readonly records: number;
  /** Whether a later call has more to delete. */
  readonly more: boolean;
}

export interface SweepDependencies {
  readonly conversations: ConversationStore;
  readonly gateway: () => ModelGateway;
  readonly admin?: { readonly writer: AdminWriter; readonly retentionDays: number } | undefined;
  readonly onError: (error: AskdareError) => void;
  /** Clock in ms, for tests. */
  readonly now?: (() => number) | undefined;
}

function whole(value: number | undefined, fallback: number, name: string, min: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min) {
    throw new TypeError(`[askdare] sweep(): ${name} must be a whole number of at least ${min}.`);
  }
  return value;
}

export function createSweep(
  dependencies: SweepDependencies,
): (options?: ChatSweepOptions) => Promise<ChatSweepResult> {
  const now = dependencies.now ?? Date.now;
  return async (options = {}) => {
    const idleDays = whole(options.idleDays, 30, 'idleDays', 0);
    const limit = whole(options.limit, 100, 'limit', 1);
    const { signal } = options;
    const { conversations, admin } = dependencies;
    const time = now();
    let swept = 0;
    let files = 0;
    let more = false;

    // 1. Idle conversations, where the store can list them (not OpenAI's).
    if (conversations.sweep) {
      const idleSince = time - idleDays * DAY_MS;
      while (swept < limit) {
        signal?.throwIfAborted();
        const asked = Math.min(CONVERSATION_BATCH, limit - swept);
        const batch = await conversations.sweep(idleSince, asked, signal);
        const fileIds: string[] = [];
        for (const conversation of batch) {
          fileIds.push(...conversation.fileIds);
          if (!admin) continue;
          try {
            await admin.writer.store.deleteConversation(conversation.id, signal);
          } catch (error) {
            // The conversation is gone; its records wait for the admin store's retention.
            dependencies.onError(
              new AskdareError('internal_error', {
                message: `The admin store "${admin.writer.store.name}" could not delete a swept conversation's records: ${hookError(error)}.`,
              }),
            );
          }
        }
        if (fileIds.length > 0) await dependencies.gateway().deleteFiles(fileIds);
        swept += batch.length;
        files += fileIds.length;
        if (batch.length < asked) break;
      }
      if (swept >= limit) more = true;
    }

    // 2. Admin records past the retention, and daily rows past 400 days.
    let records = 0;
    if (admin) {
      const cap = limit * 10;
      const sweepOptions = {
        recordsBefore: time - admin.retentionDays * DAY_MS,
        daysBefore: dayOf(time - DAY_ROWS_DAYS * DAY_MS),
      };
      for (;;) {
        signal?.throwIfAborted();
        const asked = Math.min(RECORD_BATCH, cap - records);
        const deleted = await admin.writer.store.sweep({ ...sweepOptions, limit: asked }, signal);
        records += deleted;
        if (deleted < asked) break;
        if (records >= cap) {
          more = true;
          break;
        }
      }
    }

    return { conversations: swept, files, records, more };
  };
}
