import { createChatHandler } from '@boldare/chatdock/next';
import { bots } from '@/chatdock.config';

// Must be a literal in this file; keep it above the bots' turn timeout.
export const maxDuration = 300;

export const { GET, POST, DELETE } = createChatHandler({ bots });
