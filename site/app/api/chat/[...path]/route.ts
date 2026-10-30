import { createChatHandler } from '@boldare/askdare/next';
import { upstashStore } from '@boldare/askdare-upstash';
import { bots } from '@/askdare.config';

// Must be a literal in this file; keep it above the bots' turn timeout.
export const maxDuration = 300;

// Vercel runs many instances: with an Upstash database connected (the Marketplace sets
// KV_REST_API_*), they share the limits and budgets; without one, each counts on its own.
const shared = Boolean(process.env['UPSTASH_REDIS_REST_URL'] || process.env['KV_REST_API_URL']);

export const { GET, POST, DELETE } = createChatHandler({
  bots,
  // The state gallery (/gallery) for design review and visual tests; keep it off in production.
  gallery: process.env.ASKDARE_GALLERY === '1',
  // All bots of the demo together, per UTC day.
  limits: { globalDailyTokens: 2_000_000, ...(shared ? { store: upstashStore() } : {}) },
});
