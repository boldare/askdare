import { describe, expect, it } from 'vitest';
import type { ProtocolEvent } from './events';
import { decodeEvent as decodeEvent06, SseParser as SseParser06 } from './fixtures/0.6/sse';
import { parseHistory as parseHistory06 } from './fixtures/0.6/validate';
import { historyResponseSchema, protocolEventSchema } from './schemas';
import { encodeEvent } from './sse';

/*
 * Handoff and forms are additive in protocol version 1 (ADR-0030, ADR-0031): a 0.6 client, whose
 * validator ./fixtures/0.6 keeps as released, must read a stream and a history that carry them
 * and see everything else as before.
 */

const TURN: readonly ProtocolEvent[] = [
  { type: 'user.ack', messageId: 'u1' },
  { type: 'message.start', messageId: 'm1' },
  { type: 'tool.status', messageId: 'm1', callId: 'c1', name: 'handoff', state: 'running' },
  { type: 'handoff', messageId: 'm1', state: 'requested' },
  { type: 'tool.status', messageId: 'm1', callId: 'c1', name: 'handoff', state: 'done' },
  {
    type: 'form',
    messageId: 'm1',
    callId: 'c1',
    name: 'contact',
    handle: 'form.handle',
    purpose: 'handoff',
  },
  { type: 'text.delta', messageId: 'm1', delta: 'Please leave your email.' },
  { type: 'form', messageId: 'm1', callId: 'c2', name: 'offer', handle: 'h2', purpose: 'lead' },
  { type: 'handoff', messageId: 'm1', state: 'limited' },
  { type: 'message.end', messageId: 'm1', reason: 'completed' },
];

const NEW_TYPES = new Set(['handoff', 'form']);

describe('a 0.6 client', () => {
  it('reads a stream with handoff and form events, skipping only those', () => {
    for (const event of TURN) expect(protocolEventSchema.parse(event)).toEqual(event);
    const wire = TURN.map((event, index) => encodeEvent(event, index + 1)).join(': ping\n\n');
    const parser = new SseParser06();
    // Split mid-frame, as a network does.
    const raw = [wire.slice(0, 101), wire.slice(101)].flatMap((chunk) => parser.push(chunk));
    expect(raw).toHaveLength(TURN.length);
    const results = raw.map(decodeEvent06);
    for (const [index, result] of results.entries()) {
      const type = TURN[index]?.type ?? '';
      if (NEW_TYPES.has(type)) {
        expect(result).toEqual({ ok: false, reason: 'unknown_type', type });
      } else {
        expect(result).toEqual({ ok: true, event: TURN[index] });
      }
    }
    // Every frame keeps its sequence number, so resuming after a skipped event still works.
    expect(raw.map((event) => event.id)).toEqual(TURN.map((_, index) => `${index + 1}`));
  });

  it('reads a history with handoff and forms, without them', () => {
    const answer = {
      id: 'm1',
      role: 'assistant',
      text: 'Please leave your email.',
      citations: [],
      attachments: 0,
    } as const;
    const page = {
      messages: [
        {
          ...answer,
          handoff: { state: 'requested' },
          forms: [
            { callId: 'c1', name: 'contact', purpose: 'handoff', state: 'open', handle: 'h' },
            { callId: 'c2', name: 'offer', purpose: 'lead', state: 'expired' },
          ],
        },
      ],
    };
    expect(historyResponseSchema.parse(page)).toEqual(page);
    expect(parseHistory06(page)).toEqual({ messages: [answer] });
  });
});
