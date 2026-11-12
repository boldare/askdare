import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventListeners } from '../chat/events';
import { type HostEvent, hostEvent } from './host-events';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('hostEvent', () => {
  it("keeps the known fields and puts in the loader's own bot", () => {
    expect(
      hostEvent(
        {
          type: 'message.sent',
          bot: 'someone-else',
          length: 12,
          attachments: 1,
          source: 'typed',
          extra: 'dropped',
        },
        'support',
      ),
    ).toEqual({
      type: 'message.sent',
      bot: 'support',
      length: 12,
      attachments: 1,
      source: 'typed',
    });
    expect(
      hostEvent({ type: 'message.sent', length: 11, attachments: 0, source: 'reply' }, 'support'),
    ).toEqual({
      type: 'message.sent',
      bot: 'support',
      length: 11,
      attachments: 0,
      source: 'reply',
    });
    expect(hostEvent({ type: 'feedback', rating: null, commented: false }, 'support')).toEqual({
      type: 'feedback',
      bot: 'support',
      rating: null,
      commented: false,
    });
  });

  it('refuses unknown types and fields that could carry text', () => {
    expect(hostEvent({ type: 'message.text', text: 'Hi' }, 'support')).toBeUndefined();
    expect(hostEvent({ type: 'toString' }, 'support')).toBeUndefined();
    expect(hostEvent({ type: 'error', code: 'My card number is 4242' }, 'support')).toBeUndefined();
    expect(hostEvent({ type: 'error', code: { nested: true } }, 'support')).toBeUndefined();
    expect(
      hostEvent({ type: 'message.received', durationMs: Infinity }, 'support'),
    ).toBeUndefined();
    expect(hostEvent('ready', 'support')).toBeUndefined();
    expect(hostEvent(null, 'support')).toBeUndefined();
  });
});

describe('eventListeners', () => {
  it('calls listeners of the type and of every type, until removed', () => {
    const events = eventListeners<HostEvent>();
    const opened = vi.fn();
    const all = vi.fn();
    const stop = events.on('open', opened);
    events.on('*', all);
    events.emit({ type: 'open', bot: 'support' });
    events.emit({ type: 'close', bot: 'support' });
    expect(opened).toHaveBeenCalledOnce();
    expect(all).toHaveBeenCalledTimes(2);

    stop();
    events.off('*', all);
    events.emit({ type: 'open', bot: 'support' });
    expect(opened).toHaveBeenCalledOnce();
    expect(all).toHaveBeenCalledTimes(2);
  });

  it("keeps going when a listener throws, and doesn't let one change the event", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const events = eventListeners<HostEvent>();
    events.on('open', (event) => {
      (event as { bot: string }).bot = 'changed';
    });
    events.on('open', () => {
      throw new Error('broken analytics');
    });
    const last = vi.fn();
    events.on('open', last);
    events.emit({ type: 'open', bot: 'support' });
    expect(last).toHaveBeenCalledWith({ type: 'open', bot: 'support' });
    expect(warn).toHaveBeenCalledWith('[askdare] A listener for "open" threw.');
  });
});
