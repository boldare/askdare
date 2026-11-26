/**
 * Core's writes to the admin store (ADR-0032, decision 3): the turn, rating and transcript records
 * and the handoff and lead counts, from the same values the hooks get, after the response. A write
 * never delays or fails a turn; a failure goes to `onError` by its error's class name, never its
 * message, which could quote what was written.
 */
import type { AdminCountEvent, AdminRatingRecord, AdminSource, AdminStore } from '../admin/port';
import type { Bot } from '../bot/define-bot';
import { AskdareError } from '../errors';
import { addUsage } from '../usage';
import { hookError, type TurnRecordInput } from './stream-turn';

export interface AdminWriter {
  readonly store: AdminStore;
  /** Whether transcripts are written too (`admin.transcripts`). */
  readonly transcripts: boolean;
  /** Writes one turn, and its transcript with `transcripts`. */
  turn(bot: Bot, source: AdminSource, turn: TurnRecordInput): Promise<void>;
  rating(record: AdminRatingRecord): Promise<void>;
  /** A handoff once its outcome is final, or a lead handed to `onLead` (ADR-0032, decision 6). */
  count(event: AdminCountEvent): Promise<void>;
}

/**
 * ADR-0032, decision 5's heuristic: a completed answer with no sources from a bot with knowledge,
 * or a withheld or failed one.
 */
export function unanswered(
  bot: Bot,
  turn: Pick<TurnRecordInput, 'citations' | 'check'> & {
    readonly outcome: TurnRecordInput['usage']['outcome'];
  },
): boolean {
  if (turn.outcome === 'failed' || turn.check === 'withheld') return true;
  return turn.outcome === 'completed' && turn.citations === 0 && bot.knowledge !== undefined;
}

export function adminWriter(
  store: AdminStore,
  options: { readonly transcripts: boolean; readonly onError: (error: AskdareError) => void },
): AdminWriter {
  const guarded = async (what: string, write: () => Promise<void>): Promise<void> => {
    try {
      await write();
    } catch (error) {
      options.onError(
        new AskdareError('internal_error', {
          message: `The admin store "${store.name}" could not write a ${what}: ${hookError(error)}.`,
        }),
      );
    }
  };

  return {
    store,
    transcripts: options.transcripts,

    async turn(bot, source, turn) {
      const { conversationId } = turn;
      // A turn that failed before its conversation existed has nothing to key a record by.
      if (conversationId === undefined) return;
      const report = turn.usage;
      const key = {
        bot: bot.id,
        conversationId,
        visitor: report.visitor,
        at: report.startedAt,
        source,
      };
      const writes = [
        guarded('turn', () =>
          store.recordTurn({
            ...key,
            model: report.model,
            durationMs: report.durationMs,
            outcome: report.outcome,
            ...(report.finishReason ? { finishReason: report.finishReason } : {}),
            ...(report.errorCode ? { errorCode: report.errorCode } : {}),
            usage: report.compaction
              ? addUsage(report.usage, report.compaction.usage)
              : report.usage,
            steps: report.steps,
            tools: report.tools.map(({ name, outcome }) => ({ name, outcome })),
            citations: turn.citations,
            ...(turn.check ? { check: turn.check } : {}),
            newConversation: turn.newConversation,
            unanswered: unanswered(bot, { ...turn, outcome: report.outcome }),
          }),
        ),
      ];
      const text = turn.transcript;
      if (options.transcripts && text) {
        writes.push(
          guarded('transcript', () =>
            store.recordTranscript({
              ...key,
              ...(text.itemId ? { itemId: text.itemId } : {}),
              input: text.input,
              attachments: text.attachments,
              answer: text.answer,
              citations: text.citations,
              ...(text.check ? { check: text.check } : {}),
              reason: text.reason,
            }),
          ),
        );
      }
      await Promise.all(writes);
    },

    rating: (record) => guarded('rating', () => store.recordRating(record)),

    count: (event) => guarded(event.kind, () => store.count(event)),
  };
}
