import { chat } from '@/chat';

// Must be a literal in this file; keep it above the bots' turn timeout.
export const maxDuration = 300;

export const { GET, POST, DELETE } = chat;
