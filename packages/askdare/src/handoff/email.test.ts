import { describe, expect, it, vi } from 'vitest';
import { emailHandoff, type HandoffEmail } from './email';
import type { ChatHandoffReport } from './report';

const report: ChatHandoffReport = {
  id: 'hof_1',
  bot: 'support',
  locale: 'pl',
  createdAt: Date.UTC(2026, 10, 26, 12, 0, 0),
  trigger: 'visitor',
  reason: 'visitor_asked',
  visitor: 'v_abc',
  conversationId: 'conv_1',
  available: true,
};

function capture(): { sent: HandoffEmail[]; send: (email: HandoffEmail) => void } {
  const sent: HandoffEmail[] = [];
  return { sent, send: (email) => void sent.push(email) };
}

describe('emailHandoff', () => {
  it('sends a plain-text email with a fixed subject and no reply address without contact', async () => {
    const { sent, send } = capture();
    await emailHandoff({ to: 'support@example.com', from: 'bot@example.com', send })(report);

    expect(sent).toHaveLength(1);
    const [email] = sent;
    expect(email).toEqual({
      to: 'support@example.com',
      from: 'bot@example.com',
      subject: 'Handoff request from support: the visitor asked for a person',
      text: expect.any(String),
    });
    expect(email?.text).toContain('Handoff ID: hof_1');
    expect(email?.text).toContain('Conversation ID: conv_1');
    expect(email?.text).toContain('Time: 2026-11-26T12:00:00.000Z');
    expect(email?.text).toContain('The visitor left no email address.');
    expect(email?.text).not.toMatch(/<[a-z]/i);
  });

  it('replies to the form email, and lists the contact details', async () => {
    const { sent, send } = capture();
    await emailHandoff({ to: ['a@example.com', 'b@example.com'], from: 'bot@example.com', send })({
      ...report,
      contact: { email: 'anna@example.com', name: 'Anna', consent: true },
      identity: { id: 'u1', email: 'other@example.com', claims: {} },
    });

    const [email] = sent;
    expect(email?.to).toEqual(['a@example.com', 'b@example.com']);
    expect(email?.replyTo).toBe('anna@example.com');
    expect(email?.text).toContain('  name: Anna');
    expect(email?.text).toContain('  consent: yes');
    expect(email?.text).toContain('Signed-in user:');
  });

  it("falls back to the signed-in user's email", async () => {
    const { sent, send } = capture();
    await emailHandoff({ to: 's@example.com', from: 'b@example.com', send })({
      ...report,
      identity: { id: 'u1', email: 'anna@example.com', claims: {} },
    });
    expect(sent[0]?.replyTo).toBe('anna@example.com');
  });

  it('keeps visitor text out of every header', async () => {
    const { sent, send } = capture();
    const injected = 'anna@example.com\r\nBcc: everyone@example.com';
    await emailHandoff({ to: 's@example.com', from: 'b@example.com', send })({
      ...report,
      bot: 'support\r\nBcc: x@example.com',
      contact: { email: injected },
      summary: 'Subject: urgent',
    });

    const [email] = sent;
    expect(email?.replyTo).toBeUndefined();
    expect(email?.subject).not.toMatch(/[\r\n]/);
    expect(email?.subject).not.toContain('urgent');
  });

  it('includes the summary and the transcript as plain text', async () => {
    const { sent, send } = capture();
    await emailHandoff({ to: 's@example.com', from: 'b@example.com', send })({
      ...report,
      trigger: 'model',
      reason: 'cannot_help',
      available: false,
      summary: 'Wants a refund.',
      transcript: [
        { role: 'user', text: 'Hi, <b>refund</b>?' },
        { role: 'assistant', text: 'Let me get a person.' },
      ],
    });

    const text = sent[0]?.text ?? '';
    expect(text).toContain('left a message while nobody was available');
    expect(text).toContain('Summary from the bot:\nWants a refund.');
    expect(text).toContain('Visitor:\nHi, <b>refund</b>?');
    expect(text).toContain('Bot:\nLet me get a person.');
    expect(sent[0]?.subject).toBe('Handoff request from support: the bot could not help');
  });

  it("fails when the app's send function throws", async () => {
    const send = vi.fn().mockRejectedValue(new Error('provider down'));
    await expect(
      emailHandoff({ to: 's@example.com', from: 'b@example.com', send })(report),
    ).rejects.toThrow('provider down');
  });

  it.each([
    ['an empty to', { to: [] }],
    ['a line break in to', { to: 's@example.com\r\nBcc: x@example.com' }],
    ['a line break in from', { from: 'b@example.com\n' }],
  ])('rejects %s', (_, override) => {
    expect(() =>
      emailHandoff({
        to: 's@example.com',
        from: 'b@example.com',
        send: () => undefined,
        ...override,
      }),
    ).toThrow(TypeError);
  });
});
