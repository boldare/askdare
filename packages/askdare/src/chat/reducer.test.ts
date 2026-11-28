import { describe, expect, it } from 'vitest';
import { textsFor } from '../i18n/texts';
import {
  activityFor,
  applyEvent,
  changeForm,
  failStreaming,
  fromHistory,
  translator,
} from './reducer';
import type { ChatMessage } from './state';

const t = translator(textsFor('en'));

describe('applyEvent', () => {
  it('builds an answer from its events', () => {
    let messages: readonly ChatMessage[] = [];
    messages = applyEvent(messages, { type: 'message.start', messageId: 'm' });
    messages = applyEvent(messages, { type: 'text.delta', messageId: 'm', delta: 'Hel' });
    messages = applyEvent(messages, { type: 'text.delta', messageId: 'm', delta: 'lo' });
    messages = applyEvent(messages, {
      type: 'citation',
      messageId: 'm',
      index: 1,
      title: 'Pricing',
      url: 'https://example.com/pricing',
    });
    messages = applyEvent(messages, { type: 'message.end', messageId: 'm', reason: 'completed' });
    expect(messages).toEqual([
      {
        id: 'm',
        role: 'assistant',
        text: 'Hello',
        citations: [{ index: 1, title: 'Pricing', url: 'https://example.com/pricing' }],
        attachments: 0,
        status: 'done',
      },
    ]);
  });

  it('keeps the options offered with an answer, live and from history', () => {
    let messages = applyEvent([], { type: 'message.start', messageId: 'm' });
    messages = applyEvent(messages, { type: 'replies', messageId: 'm', items: ['Yes', 'No'] });
    messages = applyEvent(messages, { type: 'message.end', messageId: 'm', reason: 'completed' });
    expect(messages[0]).toMatchObject({ status: 'done', replies: ['Yes', 'No'] });
    expect(applyEvent(messages, { type: 'replies', messageId: 'other', items: ['Maybe'] })).toEqual(
      messages,
    );
    const restored = fromHistory({
      id: 'm',
      role: 'assistant',
      text: 'Hi',
      citations: [],
      attachments: 0,
      replies: ['Yes'],
    });
    expect(restored.replies).toEqual(['Yes']);
    expect(
      'replies' in
        fromHistory({ id: 'u', role: 'user', text: 'Hi', citations: [], attachments: 0 }),
    ).toBe(false);
  });

  it("keeps each answer's tool UI payloads in call order, live and from history (ADR-0017)", () => {
    const card = (callId: string, data: unknown = { slots: ['9:00'] }) => ({
      type: 'tool.ui' as const,
      messageId: 'm',
      callId,
      name: 'find_slots',
      data,
    });
    let messages = applyEvent([], { type: 'message.start', messageId: 'm' });
    for (const event of [card('c1'), card('c1'), card('c3'), card('c4'), card('c5'), card('c6')]) {
      messages = applyEvent(messages, event);
    }
    // A repeated call is ignored, and an answer keeps four at most (parseEvent checked the rest).
    expect(messages[0]?.ui?.map((item) => item.callId)).toEqual(['c1', 'c3', 'c4', 'c5']);
    expect(messages[0]?.ui?.[0]).toEqual({
      callId: 'c1',
      name: 'find_slots',
      data: { slots: ['9:00'] },
    });
    expect(applyEvent(messages, { ...card('c9'), messageId: 'other' })).toEqual(messages);

    const ui = [{ callId: 'c1', name: 'find_slots', data: { slots: ['9:00'] } }];
    const restored = fromHistory({
      id: 'm',
      role: 'assistant',
      text: 'Hi',
      citations: [],
      attachments: 0,
      ui,
    });
    expect(restored.ui).toEqual(ui);
    expect(
      'ui' in fromHistory({ id: 'u', role: 'user', text: 'Hi', citations: [], attachments: 0 }),
    ).toBe(false);
  });

  it('ignores events of other messages and unknown types', () => {
    const messages = applyEvent([], { type: 'message.start', messageId: 'm' });
    expect(applyEvent(messages, { type: 'text.delta', messageId: 'x', delta: '!' })).toEqual(
      messages,
    );
    expect(applyEvent(messages, { type: 'user.ack', messageId: 'u' })).toBe(messages);
  });

  it('marks only the streaming answer as failed', () => {
    const messages = applyEvent([], { type: 'message.start', messageId: 'm' });
    expect(failStreaming(messages)[0]?.status).toBe('error');
  });
});

describe('handoff and forms', () => {
  const form = {
    type: 'form',
    messageId: 'm',
    callId: 'c1',
    name: 'contact',
    handle: 'h1',
    purpose: 'lead',
  } as const;

  it('keeps the handoff state and each form of an answer, once per call', () => {
    let messages = applyEvent([], { type: 'message.start', messageId: 'm' });
    messages = applyEvent(messages, { type: 'handoff', messageId: 'm', state: 'requested' });
    messages = applyEvent(messages, form);
    messages = applyEvent(messages, form);
    messages = applyEvent(messages, { ...form, callId: 'c2', handle: 'h2' });
    messages = applyEvent(messages, { type: 'handoff', messageId: 'm', state: 'sent' });
    expect(messages[0]).toMatchObject({
      handoff: 'sent',
      forms: [
        { callId: 'c1', name: 'contact', purpose: 'lead', handle: 'h1', state: 'open' },
        { callId: 'c2', handle: 'h2', state: 'open' },
      ],
    });
    // Another answer's form goes nowhere else.
    expect(applyEvent(messages, { ...form, messageId: 'other', callId: 'c3' })).toEqual(messages);
  });

  it('changes one form by its handle', () => {
    let messages = applyEvent([], { type: 'message.start', messageId: 'm' });
    messages = applyEvent(messages, form);
    messages = applyEvent(messages, { ...form, callId: 'c2', handle: 'h2' });
    messages = changeForm(messages, 'h2', { state: 'sent' });
    expect(messages[0]?.forms?.map((item) => item.state)).toEqual(['open', 'sent']);
  });

  it('takes the handoff and the forms from history', () => {
    expect(
      fromHistory({
        id: 'h',
        role: 'assistant',
        text: 'Done.',
        citations: [],
        attachments: 0,
        handoff: { state: 'saved' },
        forms: [{ callId: 'c1', name: 'contact', purpose: 'message', state: 'expired' }],
      }),
    ).toMatchObject({
      status: 'done',
      handoff: 'saved',
      forms: [{ callId: 'c1', state: 'expired' }],
    });
  });
});

describe('activityFor', () => {
  it('says what the assistant does while no text streams', () => {
    expect(activityFor({ type: 'reasoning', messageId: 'm', state: 'started' }, t)).toBe(
      'Thinking…',
    );
    expect(
      activityFor(
        { type: 'tool.status', messageId: 'm', callId: 'c', name: 'currentTime', state: 'running' },
        t,
      ),
    ).toContain('currentTime');
    expect(activityFor({ type: 'text.delta', messageId: 'm', delta: 'x' }, t)).toBeNull();
    expect(activityFor({ type: 'user.ack', messageId: 'm' }, t)).toBeUndefined();
  });
});
