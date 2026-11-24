import type { ContractRunner } from '../testing/runner';
import type { TurnEvent, TurnEventLog } from './turn-log';

export interface TurnEventLogContractOptions {
  /** The time to live in the expiry tests. Default 1 000 ms; Redis needs whole milliseconds. */
  readonly ttlMs?: number;
  /**
   * Lets at least `ms` pass for the log. Default: real time. A log with a test clock advances it
   * instead.
   */
  readonly elapse?: (ms: number) => Promise<void>;
}

/** Long enough for every test, short enough that what the suite writes is soon gone. */
const LIVE_TTL_MS = 30_000;
/** Generous, so a slow shared log doesn't fail the wake-up tests. */
const WAIT_MS = 5_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const delta = (seq: number): TurnEvent => ({
  seq,
  event: { type: 'text.delta', messageId: 'msg_contract', delta: `word${seq} ` },
});
const deltas = (from: number, to: number): TurnEvent[] =>
  Array.from({ length: to - from + 1 }, (_, i) => delta(from + i));
const seqs = (events: readonly TurnEvent[] | undefined): readonly number[] | undefined =>
  events?.map((entry) => entry.seq);

/**
 * Behaviour every `TurnEventLog` must have, for the in-memory log and for add-ons (for example
 * `@boldare/askdare-upstash`), so they stay interchangeable. Each test uses turns of its own with a
 * short time to live, so whatever it writes expires soon, also after a failure.
 */
export function turnEventLogContract(
  name: string,
  create: () => TurnEventLog,
  { describe, it, expect }: ContractRunner,
  options: TurnEventLogContractOptions = {},
): void {
  const ttlMs = options.ttlMs ?? 1_000;
  const elapse = options.elapse ?? sleep;
  const turn = (): string => `contract:${crypto.randomUUID()}`;

  describe(`${name} (TurnEventLog contract)`, () => {
    it('keeps a turn’s events in order across appends', async () => {
      const log = create();
      const id = turn();
      await log.append(id, deltas(1, 3), LIVE_TTL_MS);
      await log.append(id, deltas(4, 5), LIVE_TTL_MS);
      expect(await log.read(id, 0)).toEqual(deltas(1, 5));
    });

    it('reads only the events after a sequence number', async () => {
      const log = create();
      const id = turn();
      await log.append(id, deltas(1, 5), LIVE_TTL_MS);
      expect(seqs(await log.read(id, 2))).toEqual([3, 4, 5]);
      expect(await log.read(id, 5)).toEqual([]);
    });

    it('answers undefined for a turn it doesn’t know', async () => {
      const log = create();
      expect(await log.read(turn(), 0)).toBe(undefined);
      expect(await log.wait(turn(), 0, 50)).toBe(undefined);
    });

    it('rejects a sequence number that doesn’t come after the last', async () => {
      const log = create();
      const id = turn();
      await log.append(id, deltas(1, 3), LIVE_TTL_MS);
      const rejected = await log.append(id, [delta(3)], LIVE_TTL_MS).then(
        () => false,
        () => true,
      );
      expect(rejected).toBe(true);
      expect(seqs(await log.read(id, 0))).toEqual([1, 2, 3]);
    });

    it('answers a wait at once when events are already there', async () => {
      const log = create();
      const id = turn();
      await log.append(id, deltas(1, 3), LIVE_TTL_MS);
      const started = Date.now();
      expect(seqs(await log.wait(id, 1, WAIT_MS))).toEqual([2, 3]);
      expect(Date.now() - started < WAIT_MS).toBe(true);
    });

    it('wakes a waiting reader with the next append', async () => {
      const log = create();
      const id = turn();
      await log.append(id, deltas(1, 2), LIVE_TTL_MS);
      const started = Date.now();
      const waiting = log.wait(id, 2, WAIT_MS);
      await sleep(20);
      await log.append(id, deltas(3, 4), LIVE_TTL_MS);
      const events = await waiting;
      expect(Date.now() - started < WAIT_MS).toBe(true);
      // A log may wake the reader with the first event of the batch or with all of it.
      expect(events?.[0]?.seq).toBe(3);
      expect(seqs(await log.read(id, 2))).toEqual([3, 4]);
    });

    it('answers an empty list when a wait times out', async () => {
      const log = create();
      const id = turn();
      await log.append(id, deltas(1, 2), LIVE_TTL_MS);
      expect(await log.wait(id, 2, 50)).toEqual([]);
    });

    it('ends a wait when its signal is aborted', async () => {
      const log = create();
      const id = turn();
      await log.append(id, deltas(1, 2), LIVE_TTL_MS);
      const controller = new AbortController();
      const started = Date.now();
      const waiting = log.wait(id, 2, WAIT_MS, controller.signal);
      await sleep(20);
      controller.abort();
      expect(await waiting).toEqual([]);
      expect(Date.now() - started < WAIT_MS).toBe(true);
    });

    it('keeps turns apart', async () => {
      const log = create();
      const first = turn();
      const second = turn();
      await log.append(first, deltas(1, 3), LIVE_TTL_MS);
      await log.append(second, [delta(1)], LIVE_TTL_MS);
      expect(seqs(await log.read(first, 0))).toEqual([1, 2, 3]);
      expect(seqs(await log.read(second, 0))).toEqual([1]);

      // An append to one turn doesn't wake a reader of another.
      const waiting = log.wait(first, 3, 200);
      await sleep(20);
      await log.append(second, [delta(2)], LIVE_TTL_MS);
      expect(await waiting).toEqual([]);
    });

    it('forgets a turn once its time to live has passed', async () => {
      const log = create();
      const id = turn();
      await log.append(id, deltas(1, 3), ttlMs);
      await elapse(ttlMs + 100);
      expect(await log.read(id, 0)).toBe(undefined);
      expect(await log.wait(id, 0, 50)).toBe(undefined);
    });

    it('keeps a turn for its time to live from the last append', async () => {
      const log = create();
      const id = turn();
      await log.append(id, deltas(1, 2), ttlMs);
      await elapse(ttlMs * 0.6);
      await log.append(id, [delta(3)], ttlMs);
      await elapse(ttlMs * 0.6);
      expect(seqs(await log.read(id, 0))).toEqual([1, 2, 3]);
    });
  });
}
