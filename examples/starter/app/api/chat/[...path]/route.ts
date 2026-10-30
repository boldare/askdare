import { createChatHandler } from '@boldare/askdare/next';
import { bots } from '@/askdare.config';

// Must be a literal in this file; keep it above the bots' turn timeout.
export const maxDuration = 300;

export const { GET, POST, DELETE } = createChatHandler({
  bots,
  // The state gallery (/gallery) for design review and visual tests; keep it off in production.
  gallery: process.env.ASKDARE_GALLERY === '1',
  // All bots of the demo together, per UTC day.
  limits: { globalDailyTokens: 2_000_000 },
});
