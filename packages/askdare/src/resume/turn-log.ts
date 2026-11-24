import type { ProtocolEvent } from '../protocol/events';

/** A protocol event of a running turn, with its place in the turn. */
export interface TurnEvent {
  /** 1-based and increasing within a turn; the SSE `id:` of the event's frame. */
  readonly seq: number;
  /** A protocol event, never a raw provider event (ADR-0002). */
  readonly event: ProtocolEvent;
}

/**
 * Short-lived storage for the protocol events of running turns, so a visitor whose connection
 * dropped can resume the answer (ADR-0027). A turn's events are kept for the time to live given on
 * its last append, then they are gone. The in-memory default works for a single instance;
 * deployments on several instances need a shared log such as `@boldare/askdare-upstash`.
 *
 * Implementations log nothing about the events they hold: they contain answer text.
 */
export interface TurnEventLog {
  /**
   * Appends `events` to the turn and keeps the turn for `ttlMs` from now. Sequence numbers must
   * increase and come after the turn's last one; otherwise the append throws. Appending to a turn
   * starts it.
   */
  append(
    turnId: string,
    events: readonly TurnEvent[],
    ttlMs: number,
    signal?: AbortSignal,
  ): Promise<void>;
  /**
   * The turn's events after `afterSeq`, in order (`0` for all of them). `undefined` when the turn
   * is unknown, has expired or can no longer be resumed: the client then reloads history.
   */
  read(
    turnId: string,
    afterSeq: number,
    signal?: AbortSignal,
  ): Promise<readonly TurnEvent[] | undefined>;
  /**
   * Like `read`, but when no event after `afterSeq` exists yet, waits up to `timeoutMs` for an
   * append and answers with what it brought. An empty array means the wait timed out or `signal`
   * was aborted. `undefined` as for `read`.
   */
  wait(
    turnId: string,
    afterSeq: number,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<readonly TurnEvent[] | undefined>;
  /** True for logs that are shared across server instances. */
  readonly shared: boolean;
}
