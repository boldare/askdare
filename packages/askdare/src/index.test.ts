import { describe, expect, it } from 'vitest';
import { defineBot, defineForm, ERROR_CODES, PROTOCOL_VERSION } from './index';

describe('package entry', () => {
  it('exposes the protocol version', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it('exposes the error codes as values', () => {
    expect(ERROR_CODES).toContain('rate_limited');
  });

  it('returns a bot handle with its id and embed path', () => {
    const bot = defineBot({ id: 'support', model: 'm', instructions: 'x', embedPath: '/chat' });
    expect(bot.id).toBe('support');
    expect(bot.embedPath).toBe('/chat');
  });

  it('exposes defineForm', () => {
    const form = defineForm({
      name: 'contact',
      model: false,
      title: 'Contact',
      fields: [{ name: 'email', type: 'email', label: 'Email', required: true }],
    });
    expect(form.name).toBe('contact');
  });
});
