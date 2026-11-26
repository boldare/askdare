import { describe, expect, it } from 'vitest';
import type { ProtocolEvent } from '../protocol/events';
import { SseParser } from '../protocol/sse';
import { memoryTurnLog } from '../resume/memory-turn-log';
import type { TurnEvent, TurnEventLog } from '../resume/turn-log';
import { type ResumeStreamOptions, resumeStream } from './resume-stream';

const delta = (seq: number): TurnEvent => ({
  seq,
  event: { type: 'text.delta', messageId: 'msg_1', delta: `w${seq} ` },
});
const end = (seq: number): TurnEvent => ({
  seq,
  event: { type: 'message.end', messageId: 'msg_1', reason: 'completed' },
});

/** The ids and types of the frames a stream sends, once it has ended. */
async function framesOf(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const parser = new SseParser();
  const decoder = new TextDecoder();
  const frames: string[] = [];
  for await (const chunk of stream) {
    for (const raw of parser.push(decoder.decode(chunk, { stream: true }))) {
      frames.push(`${raw.id}:${(JSON.parse(raw.data) as ProtocolEvent).type}`);
    }
  }
  return frames;
}

const options = (overrides: Partial<ResumeStreamOptions>): ResumeStreamOptions => ({
  log: memoryTurnLog(),
  turnId: 'turn_1',
  after: 0,
  known: [],
  maxDurationMs: 5_000,
  signal: new AbortController().signal,
  ...overrides,
});

describe('resumeStream', () => {
  it('sends what the client missed, then the live events, until the end', async () => {
    const log = memoryTurnLog();
    await log.append('turn_1', [delta(1), delta(2), delta(3)], 60_000);
    const known = (await log.read('turn_1', 1)) ?? [];
    const stream = resumeStream(options({ log, after: 2, known }));
    setTimeout(() => void log.append('turn_1', [delta(4), end(5)], 60_000), 20);
    expect(await framesOf(stream)).toEqual(['3:text.delta', '4:text.delta', '5:message.end']);
  });

  it('ends at the bound when the answer never ends in the log', async () => {
    const log = memoryTurnLog();
    await log.append('turn_1', [delta(1)], 60_000);
    const started = Date.now();
    const stream = resumeStream(options({ log, after: 1, maxDurationMs: 50 }));
    expect(await framesOf(stream)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('ends when the turn can no longer be resumed while it waits', async () => {
    const log: TurnEventLog = {
      shared: true,
      append: async () => {},
      read: async () => undefined,
      wait: async () => undefined,
    };
    const stream = resumeStream(options({ log, after: 1, known: [delta(1)] }));
    expect(await framesOf(stream)).toEqual([]);
  });

  it('ends when the visitor leaves', async () => {
    const visitor = new AbortController();
    const log = memoryTurnLog();
    await log.append('turn_1', [delta(1)], 60_000);
    const stream = resumeStream(options({ log, after: 1, signal: visitor.signal }));
    setTimeout(() => visitor.abort(), 20);
    expect(await framesOf(stream)).toEqual([]);
  });

  it('ends at once, logging only the error’s name, when the log fails', async () => {
    const log: TurnEventLog = {
      shared: true,
      append: async () => {},
      read: async () => [],
      wait: async () => {
        throw new Error('could not read "w2"');
      },
    };
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      expect(await framesOf(resumeStream(options({ log, after: 1 })))).toEqual([]);
    } finally {
      console.error = original;
    }
    expect(errors).toEqual([['[askdare] could not read the turn log to resume: Error']]);
  });
});
