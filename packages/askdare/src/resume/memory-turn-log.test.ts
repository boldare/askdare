import { describe, expect, it } from 'vitest';
import { memoryTurnLog } from './memory-turn-log';
import type { TurnEvent } from './turn-log';
import { turnEventLogContract } from './turn-log-contract';

let clock = 0;
turnEventLogContract(
  'memoryTurnLog',
  () => memoryTurnLog({ now: () => clock }),
  { describe, it, expect },
  {
    elapse: async (ms) => {
      clock += ms;
    },
  },
);

const deltas = (from: number, to: number): TurnEvent[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    seq: from + i,
    event: { type: 'text.delta', messageId: 'msg_1', delta: 'word ' },
  }));

describe('memoryTurnLog', () => {
  it('drops expired turns within a minute, even when nobody reads them', async () => {
    let time = 0;
    const log = memoryTurnLog({ now: () => time });
    await log.append('turn_a', deltas(1, 3), 5 * 60_000);
    await log.append('turn_b', deltas(1, 2), 30_000);
    expect(log.turns).toBe(2);

    time = 60_000;
    await log.read('turn_a', 0);
    // turn_b's answer text is gone although nobody asked for it again.
    expect(log.turns).toBe(1);
    expect(log.events).toBe(3);
  });

  it('drops the turn written least recently when it holds too many turns', async () => {
    const log = memoryTurnLog({ maxTurns: 2 });
    await log.append('turn_a', deltas(1, 1), 60_000);
    await log.append('turn_b', deltas(1, 1), 60_000);
    await log.append('turn_a', deltas(2, 2), 60_000);
    await log.append('turn_c', deltas(1, 1), 60_000);
    expect(log.turns).toBe(2);
    expect(await log.read('turn_b', 0)).toBeUndefined();
    expect(await log.read('turn_a', 0)).toHaveLength(2);
    expect(await log.read('turn_c', 0)).toHaveLength(1);
  });

  it('drops the turns written least recently when it holds too many events', async () => {
    const log = memoryTurnLog({ maxEvents: 10 });
    await log.append('turn_a', deltas(1, 4), 60_000);
    await log.append('turn_b', deltas(1, 4), 60_000);
    await log.append('turn_c', deltas(1, 4), 60_000);
    expect(log.events).toBe(8);
    expect(await log.read('turn_a', 0)).toBeUndefined();
    expect(await log.read('turn_c', 0)).toHaveLength(4);
  });

  it('stops resuming a turn that grows past its bound, rather than leave a gap', async () => {
    const log = memoryTurnLog({ maxEventsPerTurn: 5 });
    await log.append('turn_a', deltas(1, 4), 60_000);
    await log.append('turn_a', deltas(5, 6), 60_000);
    expect(await log.read('turn_a', 0)).toBeUndefined();
    expect(log.events).toBe(0);
    // Later events don't bring it back, not even a fresh start at 1 (the turn is still known).
    await log.append('turn_a', deltas(7, 7), 60_000);
    expect(await log.read('turn_a', 6)).toBeUndefined();
    expect(log.events).toBe(0);
  });

  it('ends a waiting reader when its turn is dropped', async () => {
    const log = memoryTurnLog({ maxTurns: 1 });
    await log.append('turn_a', deltas(1, 1), 60_000);
    const waiting = log.wait('turn_a', 1, 5_000);
    await log.append('turn_b', deltas(1, 1), 60_000);
    expect(await waiting).toBeUndefined();
  });

  it('ends a waiting reader when its turn grows past its bound', async () => {
    const log = memoryTurnLog({ maxEventsPerTurn: 2 });
    await log.append('turn_a', deltas(1, 1), 60_000);
    const waiting = log.wait('turn_a', 1, 5_000);
    await log.append('turn_a', deltas(2, 3), 60_000);
    expect(await waiting).toBeUndefined();
  });

  it('rejects invalid bounds and times to live', async () => {
    expect(() => memoryTurnLog({ maxTurns: 0 })).toThrow(RangeError);
    const log = memoryTurnLog();
    await expect(log.append('turn_a', deltas(1, 1), 0)).rejects.toThrow(RangeError);
    const backwards = [...deltas(2, 2), ...deltas(1, 1)];
    await expect(log.append('turn_a', backwards, 60_000)).rejects.toThrow(RangeError);
    expect(log.turns).toBe(0);
  });

  it('is not shared across instances', () => {
    expect(memoryTurnLog().shared).toBe(false);
  });
});
