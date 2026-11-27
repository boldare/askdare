import { memoryAdminStore } from '@boldare/askdare';
import { createChatHandler } from '@boldare/askdare/next';
import { adminDashboard } from '@boldare/askdare-admin';
import { upstashAdminStore, upstashStore, upstashTurnLog } from '@boldare/askdare-upstash';
import { bots } from '@/askdare.config';
import { onHandoff, onLead } from '@/demo-hooks';

// Must be a literal in this file; keep it above the bots' turn timeout.
export const maxDuration = 300;

// Vercel runs many instances: with an Upstash database connected (the Marketplace sets
// KV_REST_API_*), they share the limits and budgets; without one, each counts on its own.
const shared = Boolean(process.env['UPSTASH_REDIS_REST_URL'] || process.env['KV_REST_API_URL']);

// The owners' console at /api/chat/admin (ADR-0032), only once someone can sign in: with
// ADMIN_SECRET, or as a user listed in ADMIN_ALLOW (comma-separated) with an identity token.
const adminAllow = (process.env.ADMIN_ALLOW ?? '')
  .split(',')
  .map((user) => user.trim())
  .filter(Boolean);
const adminConsole = Boolean(process.env.ADMIN_SECRET) || adminAllow.length > 0;

export const { GET, POST, DELETE } = createChatHandler({
  bots,
  // The state gallery (/gallery) for design review and visual tests; keep it off in production.
  gallery: process.env.ASKDARE_GALLERY === '1',
  // Visitors rate answers with 👍 and 👎. askdare stores nothing: a real site saves the report
  // here. The demo only counts them in the log, without the comment or who sent it.
  onFeedback: ({ bot, rating }) =>
    console.log(`[demo] feedback for ${bot}: ${rating ?? 'taken back'}`),
  // "Talk to a person" and the lead form: to a test webhook or the log, never to a person.
  onHandoff,
  onLead,
  // All bots of the demo together, per UTC day.
  limits: { globalDailyTokens: 2_000_000, ...(shared ? { store: upstashStore() } : {}) },
  // A visitor whose connection drops resumes the answer on any instance; without Upstash, only on
  // the instance that wrote it, else the chat reloads the conversation.
  ...(shared ? { resume: { log: upstashTurnLog() } } : {}),
  // Counters of every turn, rating, lead and handoff for the console's dashboard; no transcripts.
  // In memory without Upstash: each instance then counts its own, and a restart forgets them.
  ...(adminConsole
    ? {
        admin: {
          store: shared ? upstashAdminStore() : memoryAdminStore(),
          console: { allow: adminAllow, dashboard: adminDashboard() },
        },
      }
    : {}),
});
