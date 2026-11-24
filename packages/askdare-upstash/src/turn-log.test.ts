import { describe, expect, it } from 'vitest';
// The suite isn't in @boldare/askdare/testing yet: it is exported with the `resume` option.
import { turnEventLogContract } from '../../askdare/src/resume/turn-log-contract';
import type { RedisEval } from './index';
import { APPEND_SCRIPT, READ_SCRIPT, upstashTurnLog } from './turn-log';

interface Stream {
  entries: [string, unknown[]][];
  expiresAt: number;
}

/**
 * Executes the log's script semantics against in-memory streams instead of Redis, and parses JSON
 * in replies as `@upstash/redis` does by default.
 */
function fakeRedis(now: () => number = Date.now): RedisEval & {
  calls: { script: 'append' | 'read'; keys: string[]; args: unknown[] }[];
} {
  const streams = new Map<string, Stream>();
  const calls: { script: 'append' | 'read'; keys: string[]; args: unknown[] }[] = [];
  const live = (key: string): Stream | undefined => {
    const stream = streams.get(key);
    if (stream && stream.expiresAt <= now()) streams.delete(key);
    return streams.get(key);
  };
  const seqOf = (id: string): number => Number.parseInt(id, 10);
  return {
    calls,
    async eval<TArgs extends unknown[], TData>(script: string, keys: string[], args: TArgs) {
      const [key] = keys as [string];
      if (script === APPEND_SCRIPT) {
        calls.push({ script: 'append', keys, args });
        const [ttl, ...pairs] = args as unknown as [number, ...(number | string)[]];
        let stream = live(key);
        let last = stream ? seqOf(stream.entries.at(-1)?.[0] ?? '0-0') : 0;
        for (let i = 0; i < pairs.length; i += 2) {
          const seq = Number(pairs[i]);
          if (seq <= last) throw new Error('ERR askdare: sequence numbers must increase');
          last = seq;
        }
        if (pairs.length > 0 && !stream) {
          stream = { entries: [], expiresAt: 0 };
          streams.set(key, stream);
        }
        if (!stream) return 1 as TData;
        for (let i = 0; i < pairs.length; i += 2) {
          stream.entries.push([`${pairs[i]}-0`, ['e', String(pairs[i + 1])]]);
        }
        stream.expiresAt = now() + ttl;
        return 1 as TData;
      }
      if (script === READ_SCRIPT) {
        calls.push({ script: 'read', keys, args });
        const stream = live(key);
        if (!stream) return -1 as TData;
        const from = String(args[0]);
        const [fromSeq, fromPart] = from.split('-').map(Number) as [number, number];
        const entries = stream.entries.filter(([id]) => {
          const seq = seqOf(id);
          return seq > fromSeq || (seq === fromSeq && fromPart === 0);
        });
        return entries.map(([id, [field, value]]) => [
          id,
          [field, JSON.parse(String(value))],
        ]) as TData;
      }
      throw new Error('unexpected script');
    },
  };
}

let clock = 0;
turnEventLogContract(
  'upstashTurnLog',
  () => upstashTurnLog({ redis: fakeRedis(() => clock), pollMs: 20 }),
  { describe, it, expect },
  {
    elapse: async (ms) => {
      clock += ms;
    },
  },
);

const delta = (seq: number) => ({
  seq,
  event: { type: 'text.delta', messageId: 'msg_1', delta: `word${seq} ` },
});

describe('upstashTurnLog', () => {
  it('is shared across instances', () => {
    expect(upstashTurnLog({ redis: fakeRedis() }).shared).toBe(true);
  });

  it('appends a batch in one command, with whole milliseconds and prefixed keys', async () => {
    const redis = fakeRedis();
    const log = upstashTurnLog({ redis, prefix: 'app1:' });
    await log.append('turn_1', [delta(1), delta(2)], 1_500.5);
    expect(redis.calls).toEqual([
      {
        script: 'append',
        keys: ['app1:turn:turn_1'],
        args: [1_501, 1, JSON.stringify(delta(1).event), 2, JSON.stringify(delta(2).event)],
      },
    ]);
  });

  it('reads from the first ID after the given event', async () => {
    const redis = fakeRedis();
    const log = upstashTurnLog({ redis });
    await log.append('turn_1', [delta(1), delta(2), delta(3)], 60_000);
    expect((await log.read('turn_1', 1.5))?.map((entry) => entry.seq)).toEqual([2, 3]);
    expect(redis.calls.at(-1)).toEqual({
      script: 'read',
      keys: ['askdare:turn:turn_1'],
      args: ['1-1'],
    });
    await log.read('turn_1', -3);
    expect(redis.calls.at(-1)?.args).toEqual(['0-1']);
  });

  it('decodes events whether or not the client parsed them', async () => {
    const entries = [
      ['1-0', ['e', JSON.stringify(delta(1).event)]],
      ['2-0', ['e', delta(2).event]],
    ];
    const redis: RedisEval = { eval: async <_A, T>() => entries as T };
    expect(await upstashTurnLog({ redis }).read('turn_1', 0)).toEqual([delta(1), delta(2)]);
  });

  it('can no longer resume a turn with an entry it can’t read', async () => {
    const entries = [
      ['1-0', ['e', JSON.stringify(delta(1).event)]],
      ['2-0', ['e', '{not json']],
    ];
    const redis: RedisEval = { eval: async <_A, T>() => entries as T };
    expect(await upstashTurnLog({ redis }).read('turn_1', 0)).toBe(undefined);
  });

  it('rejects bad sequence numbers and times to live before sending anything', async () => {
    const redis = fakeRedis();
    const log = upstashTurnLog({ redis });
    await expect(log.append('turn_1', [delta(2), delta(2)], 1_000)).rejects.toThrow(RangeError);
    await expect(log.append('turn_1', [delta(1.5)], 1_000)).rejects.toThrow(RangeError);
    await expect(log.append('turn_1', [delta(1)], 0)).rejects.toThrow(RangeError);
    await expect(log.read('turn_1', Number.NaN)).rejects.toThrow(RangeError);
    expect(redis.calls).toEqual([]);
  });

  it('polls at the given interval while it waits', async () => {
    const redis = fakeRedis();
    const log = upstashTurnLog({ redis, pollMs: 40 });
    await log.append('turn_1', [delta(1)], 60_000);
    expect(await log.wait('turn_1', 1, 130)).toEqual([]);
    const reads = redis.calls.filter((call) => call.script === 'read').length;
    // One read at once, then one every 40 ms until the deadline: not a busy loop.
    expect(reads >= 3 && reads <= 5).toBe(true);
  });

  it('explains missing configuration on first use', async () => {
    const log = upstashTurnLog({ url: '', token: '' });
    await expect(log.read('turn_1', 0)).rejects.toThrow(/UPSTASH_REDIS_REST_URL/);
  });

  it('refuses a poll interval below 1 ms', () => {
    expect(() => upstashTurnLog({ redis: fakeRedis(), pollMs: 0 })).toThrow(RangeError);
  });
});

// Against a real database: ASKDARE_TEST_UPSTASH=1 with UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN set. Keys use the prefix `askdare-test:` and expire within 30 s.
if (process.env['ASKDARE_TEST_UPSTASH'] === '1') {
  turnEventLogContract(
    'upstashTurnLog on Upstash',
    () => upstashTurnLog({ prefix: 'askdare-test:' }),
    { describe, it, expect },
  );

  describe('upstashTurnLog on Upstash', () => {
    it('wakes a waiting reader within about 250 ms of an append', async () => {
      const log = upstashTurnLog({ prefix: 'askdare-test:' });
      const turnId = `latency:${crypto.randomUUID()}`;
      await log.append(turnId, [delta(1)], 30_000);
      const latencies: number[] = [];
      for (let seq = 2; seq <= 11; seq += 1) {
        const waiting = log.wait(turnId, seq - 1, 5_000);
        await new Promise((resolve) => setTimeout(resolve, 30 + Math.random() * 150));
        await log.append(turnId, [delta(seq)], 30_000);
        const appended = Date.now();
        await waiting;
        latencies.push(Date.now() - appended);
      }
      latencies.sort((a, b) => a - b);
      const median = latencies[Math.floor(latencies.length / 2)] ?? 0;
      console.info(
        `[askdare-upstash] wake-up after append: median ${median} ms, max ${latencies.at(-1)} ms`,
      );
      expect(median < 250).toBe(true);
    }, 30_000);
  });
}
