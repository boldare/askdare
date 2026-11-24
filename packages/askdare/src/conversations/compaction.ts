import { isCompaction, newItemId } from './items';
import type { CompactionModel, StoredItem } from './port';

/**
 * The `provider` of state askdare writes for itself. No model reads it: a replay leaves out native
 * items of other providers.
 */
const ASKDARE = 'askdare';

/** What the stop note's `data` says. */
interface StopNote {
  readonly compaction: 'stopped';
  /** The first step's input after the compaction. */
  readonly inputTokens: number;
  readonly compactAt: number;
}

/**
 * Whether a turn's replayed items start at a compaction item of `model` with nothing after it: the
 * turn is the first after a compaction, and its first step's input is the conversation's new floor.
 */
export function firstAfterCompaction(
  items: readonly StoredItem[],
  model: CompactionModel,
): boolean {
  const [first, ...rest] = items;
  return (
    first !== undefined &&
    isCompaction(first, model) &&
    !rest.some((item) => item.type === 'message' && item.role === 'user')
  );
}

/**
 * Whether the floor after a compaction is so high that compacting again would soon run every turn:
 * each compaction leaves a slightly larger one (ADR-0029, decision 7).
 */
export function floorTooHigh(inputTokens: number, compactAt: number): boolean {
  return inputTokens > compactAt / 2;
}

/**
 * The note that stops a conversation compacting, appended with the first step after a compaction
 * whose input was above half of `compactAt`. It holds token counts only, and nothing reads it but
 * the compaction.
 */
export function compactionStopNote(inputTokens: number, compactAt: number): StoredItem {
  const data: StopNote = { compaction: 'stopped', inputTokens, compactAt };
  return { id: newItemId(), type: 'native', provider: ASKDARE, data };
}

/** Whether the items hold a note that stopped compaction. */
export function compactionStopped(items: readonly StoredItem[]): boolean {
  return items.some(
    (item) =>
      item.type === 'native' &&
      item.provider === ASKDARE &&
      typeof item.data === 'object' &&
      item.data !== null &&
      'compaction' in item.data &&
      item.data.compaction === 'stopped',
  );
}
