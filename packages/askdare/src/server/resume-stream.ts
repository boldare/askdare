import type { ProtocolEvent } from '../protocol/events';
import { encodeComment, encodeEvent } from '../protocol/sse';
import type { TurnEvent, TurnEventLog } from '../resume/turn-log';
import { hookError } from './stream-turn';

export interface ResumeStreamOptions {
  readonly log: TurnEventLog;
  /** The turn's key in the log, from `turnKey()`. */
  readonly turnId: string;
  /** The last sequence number the client saw; only later events are sent. */
  readonly after: number;
  /**
   * What the log held when the request came in, from `after - 1` on: read before answering, so
   * an unknown turn answers 404 rather than an empty stream. The event at `after` tells whether
   * the client already saw the end.
   */
  readonly known: readonly TurnEvent[];
  /** How long to wait for the rest of the answer: no turn runs longer than its timeout. */
  readonly maxDurationMs: number;
  /**
   * The handle for the session that resumes, sent in place of any the turn logged. The turn issued
   * its own for whoever started it, so a visitor who signed in during the answer would otherwise
   * get the anonymous handle back, which outlives their sign-out.
   */
  readonly resumeToken: string;
  /** Aborted when the visitor disconnects. */
  readonly signal: AbortSignal;
  readonly heartbeatIntervalMs?: number | undefined;
}

const encoder = new TextEncoder();

/** The events after which a turn sends nothing more. */
const ends = (event: ProtocolEvent): boolean =>
  event.type === 'message.end' || event.type === 'error';

/** The event with the resuming session's handle in place of the one the turn logged. */
const handOver = (event: ProtocolEvent, resumeToken: string): ProtocolEvent =>
  (event.type === 'conversation.created' || event.type === 'message.end') && event.resumeToken
    ? { ...event, resumeToken }
    : event;

/**
 * The rest of an answer for a client whose stream dropped (ADR-0027): the logged events after
 * `after`, then the live ones as the turn writes them, each framed with its sequence number, until
 * `message.end` or `error`. Never sends an event twice or out of order. It ends without either
 * when the turn's events expire or the log fails (the client retries, gets `404` and reloads
 * history), when the turn ran out its time without ending, and when the visitor leaves.
 */
export function resumeStream(options: ResumeStreamOptions): ReadableStream<Uint8Array> {
  const { log, turnId } = options;
  const stop = new AbortController();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const finish = (): void => {
        clearInterval(heartbeat);
        stop.abort();
        if (closed) return;
        closed = true;
        controller.close();
      };

      write(encodeComment('ok'));
      heartbeat = setInterval(
        () => write(encodeComment('ping')),
        options.heartbeatIntervalMs ?? 15_000,
      );
      const endsAt = Date.now() + options.maxDurationMs;
      const signal = AbortSignal.any([options.signal, stop.signal]);

      let last = options.after;
      /** Sends what comes after `last`; true once the answer has ended. */
      const send = (events: readonly TurnEvent[]): boolean => {
        for (const { seq, event } of events) {
          if (seq < last) continue;
          // The event the client saw last: only whether it ended the answer matters.
          if (seq === last) {
            if (ends(event)) return true;
            continue;
          }
          last = seq;
          write(encodeEvent(handOver(event, options.resumeToken), seq));
          if (ends(event)) return true;
        }
        return false;
      };

      const follow = async (): Promise<void> => {
        if (send(options.known)) return;
        while (!signal.aborted && !closed) {
          const remaining = endsAt - Date.now();
          if (remaining <= 0) return;
          const events = await log.wait(turnId, last, remaining, signal);
          // Expired or no longer resumable: the client's next attempt answers 404.
          if (events === undefined) return;
          if (send(events)) return;
        }
      };

      follow()
        .catch((error: unknown) => {
          // The name only: a log's error may quote what it holds, which is answer text.
          console.error(`[askdare] could not read the turn log to resume: ${hookError(error)}`);
        })
        .finally(finish);
    },
    cancel() {
      closed = true;
      clearInterval(heartbeat);
      stop.abort();
    },
  });
}
