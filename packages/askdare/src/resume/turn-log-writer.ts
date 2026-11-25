import type { ProtocolEvent } from '../protocol/events';
import type { TurnEvent, TurnEventLog } from './turn-log';

export interface TurnLogWriterOptions {
  /** How long the log keeps the turn after each flush: the turn timeout plus a grace period. */
  readonly ttlMs: number;
  /** Flush once this many events are buffered. Default 20. */
  readonly maxEvents?: number;
  /** Flush at most this long after the first buffered event. Default 100 ms. */
  readonly maxDelayMs?: number;
  /** Bounds every append, usually the turn's deadline. */
  readonly signal?: AbortSignal;
  /**
   * How many times a failed append is tried again, the same batch in order, before the writer gives
   * up. Default 2, so a passing network error doesn't leave the log short of the answer's end.
   */
  readonly retries?: number;
  /** The pause before the first retry, doubled for each further one. Default 200 ms. */
  readonly retryDelayMs?: number;
  /**
   * Called once when an append fails for good. The writer then stops logging the turn, which can
   * no longer be resumed to its end, while the turn itself goes on. The error must not be logged
   * with event contents.
   */
  readonly onError?: (error: unknown) => void;
}

/** Numbers one turn's events and writes them to a `TurnEventLog` in batches (ADR-0027). */
export interface TurnLogWriter {
  /** Buffers `event` and returns its sequence number, for the SSE `id:` of its frame. */
  write(event: ProtocolEvent): number;
  /** Writes what is buffered now; resolves once every event written so far is in the log. */
  flush(): Promise<void>;
}

/**
 * A writer for one turn: never one append per text delta, but a flush every `maxEvents` events or
 * `maxDelayMs`, whichever comes first, and right away for `message.end` and `error`, so a resumed
 * reader sees the end without waiting. One append is in flight at a time, so batches stay in order;
 * events written meanwhile go into the next one. Logging is best effort: a failed append never
 * fails the turn.
 */
export function turnLogWriter(
  log: TurnEventLog,
  turnId: string,
  options: TurnLogWriterOptions,
): TurnLogWriter {
  const { ttlMs, signal, onError } = options;
  const maxEvents = options.maxEvents ?? 20;
  const maxDelayMs = options.maxDelayMs ?? 100;
  const retries = options.retries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 200;
  if (!Number.isInteger(retries) || retries < 0) {
    throw new RangeError('[askdare] turnLogWriter: retries must be a whole number.');
  }
  if (!Number.isInteger(maxEvents) || maxEvents < 1) {
    throw new RangeError('[askdare] turnLogWriter: maxEvents must be a positive integer.');
  }
  if (!(maxDelayMs >= 0)) {
    throw new RangeError('[askdare] turnLogWriter: maxDelayMs must not be negative.');
  }

  let seq = 0;
  let buffer: TurnEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let draining = false;
  let failed = false;
  let drained: Promise<void> = Promise.resolve();

  const drain = async (): Promise<void> => {
    draining = true;
    try {
      while (buffer.length > 0 && !failed) {
        const batch = buffer;
        buffer = [];
        for (let attempt = 0; ; attempt += 1) {
          try {
            await log.append(turnId, batch, ttlMs, signal);
            break;
          } catch (error) {
            // Events written meanwhile wait in `buffer`, so batches stay in order.
            if (attempt < retries && !signal?.aborted) {
              await new Promise((resolve) => setTimeout(resolve, retryDelayMs * 2 ** attempt));
              continue;
            }
            failed = true;
            buffer = [];
            onError?.(error);
            break;
          }
        }
      }
    } finally {
      draining = false;
    }
  };

  const flush = (): Promise<void> => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    // While an append is in flight, its loop picks up what was buffered meanwhile.
    if (!draining && buffer.length > 0 && !failed) drained = drain();
    return drained;
  };

  return {
    write(event) {
      seq += 1;
      if (failed) return seq;
      buffer.push({ seq, event });
      if (buffer.length >= maxEvents || event.type === 'message.end' || event.type === 'error') {
        void flush();
      } else {
        timer ??= setTimeout(() => {
          timer = undefined;
          void flush();
        }, maxDelayMs);
      }
      return seq;
    },
    flush,
  };
}
