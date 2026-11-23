import { describe, expect, it } from 'vitest';
import { ownerOf, ownsConversation } from './owner';
import type { ConversationInfo } from './port';

const V1 = `v_${'1a'.repeat(16)}`;
const V2 = `v_${'2b'.repeat(16)}`;
const info = (owner: string, botId = 'support'): ConversationInfo => ({
  id: 'conv_1',
  botId,
  owner,
  createdAt: 0,
  updatedAt: 0,
  version: 0,
});

describe('ownsConversation', () => {
  it('lets an anonymous token reach its own visitor only', () => {
    expect(ownsConversation(info(ownerOf(V1, undefined)), 'support', { visitorId: V1 })).toBe(true);
    expect(ownsConversation(info(ownerOf(V2, undefined)), 'support', { visitorId: V1 })).toBe(
      false,
    );
    expect(ownsConversation(info('user:k1'), 'support', { visitorId: V1 })).toBe(false);
  });

  it("lets a user's token reach their conversations, also after the visitor ID changed", () => {
    const grant = { visitorId: V2, identityKey: 'k1' };
    expect(ownsConversation(info('user:k1'), 'support', grant)).toBe(true);
    // Adopted at sign-in, or started signed-in before 0.6: stored under the first visitor.
    expect(ownsConversation(info(ownerOf(V1, undefined)), 'support', grant)).toBe(true);
  });

  it("never lets a user's token reach another user's conversation", () => {
    expect(ownsConversation(info('user:k2'), 'support', { visitorId: V1, identityKey: 'k1' })).toBe(
      false,
    );
  });

  it('refuses another bot, an unknown conversation and a record without an owner', () => {
    const grant = { visitorId: V1, identityKey: 'k1' };
    expect(ownsConversation(info('user:k1', 'docs'), 'support', grant)).toBe(false);
    expect(ownsConversation(undefined, 'support', grant)).toBe(false);
    expect(ownsConversation(info(''), 'support', grant)).toBe(false);
    expect(ownsConversation(info('visitor:'), 'support', grant)).toBe(false);
    expect(ownsConversation(info(''), 'support', { visitorId: V1 })).toBe(false);
  });
});
