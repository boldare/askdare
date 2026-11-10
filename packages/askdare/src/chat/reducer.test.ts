import { describe, expect, it } from 'vitest';
import { textsFor } from '../i18n/texts';
import { activityFor, applyEvent, failStreaming, translator } from './reducer';
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
