import { describe, expect, it } from 'vitest';
import { PROTOCOL_EVENT_TYPES, type ProtocolEvent } from './events';
import { decodeEvent, encodeComment, encodeEvent, type RawSseEvent, SseParser } from './sse';

const SAMPLE_EVENTS: readonly ProtocolEvent[] = [
  { type: 'conversation.created', resumeToken: 'resume.token.value' },
  { type: 'user.ack', messageId: 'msg_user_1' },
  { type: 'message.start', messageId: 'msg_1' },
  { type: 'reasoning', messageId: 'msg_1', state: 'started' },
  { type: 'text.delta', messageId: 'msg_1', delta: 'Cześć! Line one\nline two "quoted" 👋' },
  {
    type: 'citation',
    messageId: 'msg_1',
    index: 1,
    title: 'Pricing',
    url: 'https://example.com/p',
  },
  { type: 'citation', messageId: 'msg_1', index: 2, title: 'handbook.pdf' },
  { type: 'tool.status', messageId: 'msg_1', callId: 'call_1', name: 'getWeather', state: 'done' },
  { type: 'message.end', messageId: 'msg_1', reason: 'completed' },
  { type: 'error', code: 'rate_limited', message: 'Too many messages.', retryAfterMs: 1500 },
];

function parseAll(chunks: readonly string[]): RawSseEvent[] {
  const parser = new SseParser();
  return chunks.flatMap((chunk) => parser.push(chunk));
}

function decodeAll(chunks: readonly string[]): ProtocolEvent[] {
  return parseAll(chunks).flatMap((raw) => {
    const result = decodeEvent(raw);
    return result.ok ? [result.event] : [];
  });
}

const stream = [encodeComment('ok'), ...SAMPLE_EVENTS.map(encodeEvent), encodeComment('ping')].join(
  '',
);

describe('SSE encoding and decoding', () => {
  it('has a sample for every protocol event type', () => {
    expect(new Set(SAMPLE_EVENTS.map((event) => event.type))).toEqual(
      new Set(PROTOCOL_EVENT_TYPES),
    );
  });

  it('round-trips every event type', () => {
    expect(decodeAll([stream])).toEqual(SAMPLE_EVENTS);
  });

  it('decodes correctly whatever the chunk boundaries', () => {
    for (let split = 0; split <= stream.length; split += 1) {
      expect(decodeAll([stream.slice(0, split), stream.slice(split)])).toEqual(SAMPLE_EVENTS);
    }
  });

  it('decodes a stream delivered one character at a time', () => {
    expect(decodeAll([...stream])).toEqual(SAMPLE_EVENTS);
  });

  it('ignores comments and heartbeats', () => {
    expect(parseAll([': ok\n\n', ':ping\n\n', ': ping\n\n'])).toEqual([]);
  });

  it('accepts CRLF and CR line endings, including a CRLF split across chunks', () => {
    const event = SAMPLE_EVENTS[1] as ProtocolEvent;
    const lf = encodeEvent(event);
    const crlf = lf.replaceAll('\n', '\r\n');
    const cr = lf.replaceAll('\n', '\r');
    expect(decodeAll([crlf])).toEqual([event]);
    expect(decodeAll([cr])).toEqual([event]);
    const splitAt = crlf.indexOf('\r') + 1;
    expect(decodeAll([crlf.slice(0, splitAt), crlf.slice(splitAt)])).toEqual([event]);
  });

  it('joins multi-line data with newlines', () => {
    expect(parseAll(['event: x\ndata: a\ndata: b\n\n'])).toEqual([{ event: 'x', data: 'a\nb' }]);
  });

  it('strips a leading byte order mark', () => {
    expect(decodeAll([`﻿${encodeEvent(SAMPLE_EVENTS[1] as ProtocolEvent)}`])).toHaveLength(1);
  });

  it('discards an unterminated event at the end of the stream', () => {
    const complete = encodeEvent(SAMPLE_EVENTS[1] as ProtocolEvent);
    expect(decodeAll([complete, complete.slice(0, -1)])).toHaveLength(1);
  });

  it('keeps comment text on a single line', () => {
    expect(encodeComment('a\nb\rc')).toBe(': a b c\n\n');
  });
});

describe('decodeEvent', () => {
  it('reports unknown event types instead of throwing', () => {
    expect(decodeEvent({ event: 'future.event', data: '{}' })).toEqual({
      ok: false,
      reason: 'unknown_type',
      type: 'future.event',
    });
  });

  it('reports invalid JSON', () => {
    expect(decodeEvent({ event: 'user.ack', data: '{oops' })).toMatchObject({
      ok: false,
      reason: 'invalid_json',
    });
  });

  it('reports payloads that do not match the schema', () => {
    expect(decodeEvent({ event: 'user.ack', data: '{"type":"user.ack"}' })).toMatchObject({
      ok: false,
      reason: 'invalid_payload',
    });
  });

  it('rejects a payload whose type disagrees with the event field', () => {
    const data = JSON.stringify({ type: 'message.start', messageId: 'm' });
    expect(decodeEvent({ event: 'user.ack', data })).toMatchObject({ reason: 'invalid_payload' });
  });

  it('rejects citation URLs that are not http(s)', () => {
    const data = JSON.stringify({
      type: 'citation',
      messageId: 'm',
      index: 1,
      title: 'x',
      url: 'javascript:alert(1)',
    });
    expect(decodeEvent({ event: 'citation', data })).toMatchObject({ reason: 'invalid_payload' });
  });
});
