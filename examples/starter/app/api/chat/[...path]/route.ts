import { createChatHandler } from '@boldare/askdare/next';
import { bots } from '../../../../askdare.config';

// Must be a literal in this file; keep it above the bots' turn timeout (120 s by default).
export const maxDuration = 300;

export const { GET, POST, DELETE } = createChatHandler({ bots });
