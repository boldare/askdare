import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProtocolEvent } from '../protocol/events';
import { memoryTurnLog } from './memory-turn-log';
import type { TurnEvent, TurnEventLog } from './turn-log';
import { turnLogWriter } from './turn-log-writer';

const text = (delta: string): ProtocolEvent => ({ type: 'text.delta', messageId: 'msg_1', delta });
const end: ProtocolEvent = { type: 'message.end', messageId: 'msg_1', reason: 'completed' };

/** A log that records each append's sequence numbers; `gate` holds appends until released. */
function recordingLog(): TurnEventLog & {
  readonly batches: number[][];
  gate: Promise<void> | undefined;
} {
  const inner = memoryTurnLog();
  const log = {
    batches: [] as number[][],
    gate: undefined as Promise<void> | undefined,
    shared: false,
    async append(turnId: string, events: readonly TurnEvent[], ttlMs: number) {
      log.batches.push(events.map((entry) => entry.seq));
      await log.gate;
      await inner.append(turnId, events, ttlMs);
    },
    read: inner.read,
    wait: inner.wait,
  };
  return log;
}

describe('turnLogWriter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('numbers events from 1 and writes them in batches, not one by one', async () => {
    const log = recordingLog();
    const writer = turnLogWriter(log, 'turn_1', { ttlMs: 60_000, maxEvents: 3 });
    const numbers: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      numbers.push(writer.write(text(`w${i}`)));
      await vi.advanceTimersByTimeAsync(0); // a text delta at a time, as the model streams them
    }
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(log.batches).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    await writer.flush();
    expect(log.batches).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect((await log.read('turn_1', 0))?.map((entry) => entry.event)).toEqual(
      Array.from({ length: 7 }, (_, i) => text(`w${i}`)),
    );
  });

  it('flushes a partial batch after the delay', async () => {
    const log = recordingLog();
    const writer = turnLogWriter(log, 'turn_1', { ttlMs: 60_000, maxDelayMs: 100 });
    writer.write(text('a'));
    await vi.advanceTimersByTimeAsync(60);
    writer.write(text('b'));
    expect(log.batches).toEqual([]);
    // The delay counts from the first buffered event, so a steady stream still flushes.
    await vi.advanceTimersByTimeAsync(40);
    expect(log.batches).toEqual([[1, 2]]);
  });

  it('flushes the end of an answer at once', async () => {
    const log = recordingLog();
    const writer = turnLogWriter(log, 'turn_1', { ttlMs: 60_000 });
    writer.write(text('a'));
    writer.write(end);
    await vi.advanceTimersByTimeAsync(0);
    expect(log.batches).toEqual([[1, 2]]);
  });

  it('keeps one append in flight and batches what arrives meanwhile', async () => {
    const log = recordingLog();
    let release = (): void => {};
    log.gate = new Promise((resolve) => {
      release = resolve;
    });
    const writer = turnLogWriter(log, 'turn_1', { ttlMs: 60_000, maxEvents: 2 });
    for (let i = 0; i < 7; i += 1) writer.write(text(`w${i}`));
    expect(log.batches).toEqual([[1, 2]]);

    log.gate = undefined;
    release();
    await writer.flush();
    expect(log.batches).toEqual([
      [1, 2],
      [3, 4, 5, 6, 7],
    ]);
    expect((await log.read('turn_1', 0))?.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('stops logging after a failed append, without failing the turn', async () => {
    const failure = new Error('log unavailable');
    let appends = 0;
    const log: TurnEventLog = {
      shared: true,
      append: async () => {
        appends += 1;
        throw failure;
      },
      read: async () => undefined,
      wait: async () => undefined,
    };
    const onError = vi.fn();
    const writer = turnLogWriter(log, 'turn_1', { ttlMs: 60_000, maxEvents: 1, onError });
    expect(writer.write(text('a'))).toBe(1);
    const flushed = writer.flush();
    await vi.advanceTimersByTimeAsync(600); // two retries, after 200 and 400 ms
    await flushed;
    expect(writer.write(text('b'))).toBe(2);
    await expect(writer.flush()).resolves.toBeUndefined();
    expect(appends).toBe(3);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('tries a failed batch again, in order, before giving up', async () => {
    const log = recordingLog();
    let failures = 1;
    const flaky: TurnEventLog = {
      ...log,
      append: async (turnId, events, ttlMs) => {
        if (failures > 0) {
          failures -= 1;
          throw new Error('a passing network error');
        }
        await log.append(turnId, events, ttlMs);
      },
    };
    const onError = vi.fn();
    const writer = turnLogWriter(flaky, 'turn_1', { ttlMs: 60_000, maxEvents: 2, onError });
    writer.write(text('a'));
    writer.write(text('b'));
    writer.write(text('c')); // buffered while the first batch is retried
    writer.write(end);
    const flushed = writer.flush();
    await vi.advanceTimersByTimeAsync(200);
    await flushed;
    expect(onError).not.toHaveBeenCalled();
    expect(log.batches).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect((await log.read('turn_1', 0))?.map((entry) => entry.seq)).toEqual([1, 2, 3, 4]);
  });

  it('passes the time to live and the signal to every append', async () => {
    const append = vi.fn(async () => {});
    const log: TurnEventLog = {
      shared: true,
      append,
      read: async () => undefined,
      wait: async () => undefined,
    };
    const signal = new AbortController().signal;
    const writer = turnLogWriter(log, 'turn_1', { ttlMs: 330_000, signal });
    writer.write(text('a'));
    await writer.flush();
    expect(append).toHaveBeenCalledWith('turn_1', [{ seq: 1, event: text('a') }], 330_000, signal);
  });

  it('resolves a flush with nothing buffered', async () => {
    const log = recordingLog();
    const writer = turnLogWriter(log, 'turn_1', { ttlMs: 60_000 });
    await expect(writer.flush()).resolves.toBeUndefined();
    expect(log.batches).toEqual([]);
  });
});
