import type { TurnEvent, TurnEventLog } from './turn-log';

export interface MemoryTurnLogOptions {
  /** Clock in ms, for tests. */
  readonly now?: () => number;
  /** Upper bound on turns held, running or recently finished. Default 1 000. */
  readonly maxTurns?: number;
  /** Upper bound on events held across all turns. Default 100 000. */
  readonly maxEvents?: number;
  /** Upper bound on one turn's events; a longer turn can no longer be resumed. Default 5 000. */
  readonly maxEventsPerTurn?: number;
}

/** The in-process log, with what it holds (for tests and diagnostics). */
export interface MemoryTurnLog extends TurnEventLog {
  /** Turns held, including those that grew past `maxEventsPerTurn`. */
  readonly turns: number;
  /** Events held across all turns. */
  readonly events: number;
}

/** Expired turns are dropped at least this often: their events hold answer text. */
const SWEEP_INTERVAL_MS = 60_000;

interface Turn {
  readonly events: TurnEvent[];
  expiresAt: number;
  /** Grew past its bound or lost events: reads answer `undefined` until it expires. */
  broken: boolean;
  /** Readers waiting for the next append, woken also when the turn goes away. */
  readonly waiters: Set<() => void>;
}

const positive = (value: number, name: string): number => {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`[askdare] memoryTurnLog: ${name} must be a positive integer.`);
  }
  return value;
};

/**
 * Per-process turn events (ADR-0027), the default log. A reconnect resumes only when it reaches
 * the same instance. Bounded in time (each turn's time to live, with expired turns dropped every
 * minute), in turns and in events: when full, it drops the turns written least recently, whose
 * visitors then reload history instead of resuming.
 */
export function memoryTurnLog(options: MemoryTurnLogOptions = {}): MemoryTurnLog {
  const now = options.now ?? Date.now;
  const maxTurns = positive(options.maxTurns ?? 1_000, 'maxTurns');
  const maxEvents = positive(options.maxEvents ?? 100_000, 'maxEvents');
  const maxEventsPerTurn = positive(options.maxEventsPerTurn ?? 5_000, 'maxEventsPerTurn');
  /** In least-recently-written order: an append moves its turn to the end. */
  const turns = new Map<string, Turn>();
  let eventCount = 0;
  let sweptAt = now();

  const wake = (turn: Turn): void => {
    for (const waiter of [...turn.waiters]) waiter();
  };

  const drop = (turnId: string, turn: Turn): void => {
    turns.delete(turnId);
    eventCount -= turn.events.length;
    wake(turn);
  };

  const sweep = (time: number): void => {
    for (const [turnId, turn] of turns) {
      if (turn.expiresAt <= time) drop(turnId, turn);
    }
    sweptAt = time;
  };

  /** The turn if it is held and not expired; sweeps when a minute has passed. */
  const live = (turnId: string, time: number): Turn | undefined => {
    if (time - sweptAt >= SWEEP_INTERVAL_MS) sweep(time);
    const turn = turns.get(turnId);
    if (turn && turn.expiresAt <= time) {
      drop(turnId, turn);
      return undefined;
    }
    return turn;
  };

  /** Drops the least recently written turns, except `keep`, until `needed` returns false. */
  const evict = (keep: string, needed: () => boolean): void => {
    for (const [turnId, turn] of turns) {
      if (!needed()) return;
      if (turnId !== keep) drop(turnId, turn);
    }
  };

  const after = (
    turnId: string,
    afterSeq: number,
    time: number,
  ): readonly TurnEvent[] | undefined => {
    const turn = live(turnId, time);
    if (!turn || turn.broken) return undefined;
    const start = turn.events.findIndex((entry) => entry.seq > afterSeq);
    return start === -1 ? [] : turn.events.slice(start);
  };

  return {
    shared: false,
    get turns() {
      return turns.size;
    },
    get events() {
      return eventCount;
    },

    async append(turnId, events, ttlMs) {
      if (!(ttlMs > 0) || !Number.isFinite(ttlMs)) {
        throw new RangeError(
          '[askdare] memoryTurnLog: the time to live must be a positive number.',
        );
      }
      const time = now();
      let turn = live(turnId, time);
      let last = turn?.events.at(-1)?.seq ?? 0;
      for (const { seq } of events) {
        if (!Number.isInteger(seq) || seq <= last) {
          throw new RangeError('[askdare] memoryTurnLog: sequence numbers must increase.');
        }
        last = seq;
      }

      if (turn) {
        turns.delete(turnId); // re-inserted below: most recently written goes last
      } else {
        if (turns.size >= maxTurns) sweep(time);
        evict(turnId, () => turns.size >= maxTurns);
        turn = { events: [], expiresAt: 0, broken: false, waiters: new Set() };
      }
      turns.set(turnId, turn);
      turn.expiresAt = time + ttlMs;
      if (events.length === 0 || turn.broken) return;

      const full = (): boolean => eventCount + events.length > maxEvents;
      const fitsTurn = turn.events.length + events.length <= maxEventsPerTurn;
      if (fitsTurn && full()) {
        sweep(time);
        evict(turnId, full);
      }
      if (!fitsTurn || full()) {
        // A gap would corrupt a resumed answer, so the turn stops being resumable as a whole.
        eventCount -= turn.events.length;
        turn.events.length = 0;
        turn.broken = true;
      } else {
        turn.events.push(...events);
        eventCount += events.length;
      }
      wake(turn);
    },

    async read(turnId, afterSeq) {
      return after(turnId, afterSeq, now());
    },

    async wait(turnId, afterSeq, timeoutMs, signal) {
      const ready = after(turnId, afterSeq, now());
      const turn = turns.get(turnId);
      if (ready === undefined || ready.length > 0 || !turn) return ready;
      if (timeoutMs <= 0 || signal?.aborted) return [];
      await new Promise<void>((resolve) => {
        const done = (): void => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', done);
          turn.waiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, timeoutMs);
        signal?.addEventListener('abort', done, { once: true });
        turn.waiters.add(done);
      });
      // The turn may have been dropped meanwhile, or replaced after expiring: only its own events.
      return turns.get(turnId) === turn ? after(turnId, afterSeq, now()) : undefined;
    },
  };
}
