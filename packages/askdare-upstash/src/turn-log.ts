import { Redis } from '@upstash/redis';
import type { RedisEval } from './index';

// The shape of `TurnEventLog` in @boldare/askdare, which doesn't export it yet (it lands with the
// `resume` option). Kept structural and generic over the event, which this log only stores as JSON,
// so the log fits wherever a `TurnEventLog` is expected. Replace with the import once it exists.

/** An event of a running turn, with its place in the turn. */
export interface UpstashTurnEvent<TEvent> {
  /** 1-based and increasing within a turn. */
  readonly seq: number;
  readonly event: TEvent;
}

/** The turn event log of `@boldare/askdare` (ADR-0027), kept in Upstash Redis. */
export interface UpstashTurnLog<TEvent> {
  append(
    turnId: string,
    events: readonly UpstashTurnEvent<TEvent>[],
    ttlMs: number,
    signal?: AbortSignal,
  ): Promise<void>;
  read(
    turnId: string,
    afterSeq: number,
    signal?: AbortSignal,
  ): Promise<readonly UpstashTurnEvent<TEvent>[] | undefined>;
  wait(
    turnId: string,
    afterSeq: number,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<readonly UpstashTurnEvent<TEvent>[] | undefined>;
  readonly shared: true;
}

export interface UpstashTurnLogOptions {
  /** An existing client. Otherwise one is created from `url` and `token`. */
  readonly redis?: RedisEval;
  /** Default `process.env.UPSTASH_REDIS_REST_URL` (Upstash console), else `KV_REST_API_URL` (Vercel Marketplace). */
  readonly url?: string;
  /** Default `process.env.UPSTASH_REDIS_REST_TOKEN`, else `KV_REST_API_TOKEN`. */
  readonly token?: string;
  /** Key prefix, to share one database between apps. Default `askdare:`. */
  readonly prefix?: string;
  /**
   * How often a waiting reader checks for new events, in ms. Default 150. Upstash's REST API
   * can't block on a stream (`XREAD BLOCK`), so `wait` polls; each check is one command.
   */
  readonly pollMs?: number;
}

/**
 * Checks the sequence numbers, then appends the batch and refreshes the time to live, atomically.
 * KEYS[1]: the turn's stream. ARGV[1]: the time to live in ms; then pairs of sequence number and
 * event JSON. Entry IDs are `<seq>-0`, so Redis keeps them in order.
 */
export const APPEND_SCRIPT: string = `
local last = 0
local top = redis.call('XREVRANGE', KEYS[1], '+', '-', 'COUNT', 1)
if top[1] then last = tonumber(string.match(top[1][1], '^%d+')) end
for i = 2, #ARGV, 2 do
  local seq = tonumber(ARGV[i])
  if seq <= last then return redis.error_reply('askdare: sequence numbers must increase') end
  last = seq
end
for i = 2, #ARGV, 2 do
  redis.call('XADD', KEYS[1], ARGV[i] .. '-0', 'e', ARGV[i + 1])
end
redis.call('PEXPIRE', KEYS[1], ARGV[1])
return 1
`;

/**
 * The entries from ID ARGV[1] on, or -1 when the turn's stream doesn't exist (unknown or expired),
 * in one round trip.
 */
export const READ_SCRIPT: string = `
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
return redis.call('XRANGE', KEYS[1], ARGV[1], '+')
`;

/** An XRANGE entry: `[id, [field, value, ...]]`. */
type StreamEntry = [string, unknown[]];

const sleep = (ms: number, signal: AbortSignal | undefined): Promise<void> =>
  new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });

/**
 * The entries as events, or `undefined` when one can't be read back: a gap would corrupt a resumed
 * answer, so such a turn can no longer be resumed. `@upstash/redis` parses JSON values in replies
 * by default, so an event arrives either as its JSON text or already parsed.
 */
function decode<TEvent>(entries: StreamEntry[]): UpstashTurnEvent<TEvent>[] | undefined {
  const events: UpstashTurnEvent<TEvent>[] = [];
  for (const [id, fields] of entries) {
    const seq = Number.parseInt(String(id), 10);
    const value = fields[1];
    if (!Number.isInteger(seq) || value === undefined || value === null) return undefined;
    try {
      const event = (typeof value === 'string' ? JSON.parse(value) : value) as TEvent;
      events.push({ seq, event });
    } catch {
      return undefined;
    }
  }
  return events;
}

/**
 * Turn events shared by every server instance, so a visitor whose connection dropped can resume the
 * answer on any of them (ADR-0027). Each turn is a Redis stream that expires with the turn; the
 * events hold answer text, so they stay only for the time to live the server gives (minutes), and
 * nothing about them is logged.
 *
 * ```ts
 * createChatHandler({ bots, resume: { log: upstashTurnLog() } });
 * ```
 */
export function upstashTurnLog<TEvent = unknown>(
  options: UpstashTurnLogOptions = {},
): UpstashTurnLog<TEvent> {
  const prefix = options.prefix ?? 'askdare:';
  const pollMs = options.pollMs ?? 150;
  if (!Number.isFinite(pollMs) || pollMs < 1) {
    throw new RangeError('[askdare-upstash] upstashTurnLog: pollMs must be at least 1.');
  }
  let redis = options.redis;
  const client = (): RedisEval => {
    if (!redis) {
      // A database from the Upstash console has the UPSTASH_ names; one from the Vercel Marketplace, KV_.
      const env = process.env;
      const url = options.url ?? env['UPSTASH_REDIS_REST_URL'] ?? env['KV_REST_API_URL'];
      const token = options.token ?? env['UPSTASH_REDIS_REST_TOKEN'] ?? env['KV_REST_API_TOKEN'];
      if (!url || !token) {
        throw new Error(
          '[askdare-upstash] Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, or pass a client.',
        );
      }
      redis = new Redis({ url, token });
    }
    return redis;
  };
  const key = (turnId: string): string => `${prefix}turn:${turnId}`;

  const read = async (
    turnId: string,
    afterSeq: number,
  ): Promise<UpstashTurnEvent<TEvent>[] | undefined> => {
    if (!Number.isFinite(afterSeq)) {
      throw new RangeError('[askdare-upstash] upstashTurnLog: afterSeq must be a number.');
    }
    // IDs are `<seq>-0`, so `<n>-1` is the first ID after event n.
    const from = `${Math.max(0, Math.floor(afterSeq))}-1`;
    const reply = await client().eval<[string], StreamEntry[] | number>(
      READ_SCRIPT,
      [key(turnId)],
      [from],
    );
    return Array.isArray(reply) ? decode<TEvent>(reply) : undefined;
  };

  return {
    shared: true,

    async append(turnId, events, ttlMs) {
      if (!(ttlMs > 0) || !Number.isFinite(ttlMs)) {
        throw new RangeError(
          '[askdare-upstash] upstashTurnLog: the time to live must be a positive number.',
        );
      }
      const args: (string | number)[] = [Math.ceil(ttlMs)];
      let last = 0;
      for (const { seq, event } of events) {
        // Checked here too, so a bad number never reaches the stream ID.
        if (!Number.isInteger(seq) || seq <= last) {
          throw new RangeError('[askdare-upstash] upstashTurnLog: sequence numbers must increase.');
        }
        last = seq;
        args.push(seq, JSON.stringify(event));
      }
      await client().eval(APPEND_SCRIPT, [key(turnId)], args);
    },

    read,

    async wait(turnId, afterSeq, timeoutMs, signal) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const ready = await read(turnId, afterSeq);
        if (ready === undefined || ready.length > 0) return ready;
        const left = deadline - Date.now();
        if (left <= 0 || signal?.aborted) return [];
        await sleep(Math.min(pollMs, left), signal);
        if (signal?.aborted) return [];
      }
    },
  };
}
