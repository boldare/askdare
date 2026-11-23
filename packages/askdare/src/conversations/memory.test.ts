import { describe, expect, it, vi } from 'vitest';
import { conversationStoreContract } from '../testing/conversation-store-contract';
import { memoryConversations } from './memory';

conversationStoreContract('memoryConversations', () => memoryConversations(), {
  describe,
  it,
  expect,
});

describe('memoryConversations', () => {
  it('warns in production that conversations stay in one instance', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      memoryConversations();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('kept in memory, per instance'));
    } finally {
      warn.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
