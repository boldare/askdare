import { memoryAdminStore } from '@boldare/askdare';
import { type ChatHandlers, createChatHandler } from '@boldare/askdare/next';
import { adminDashboard } from '@boldare/askdare-admin';
import { upstashAdminStore, upstashStore, upstashTurnLog } from '@boldare/askdare-upstash';
import { bots } from '@/askdare.config';
import { onHandoff, onLead } from '@/demo-hooks';

// The demo's chat handlers, in a module of their own: a route file may export only HTTP methods,
// and the cron route (app/api/cron/sweep) needs `sweep()` too (docs/admin.md, step 5).

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

export const chat: ChatHandlers = createChatHandler({
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
  // Counters of every turn, rating, lead and handoff for the console's dashboard, and transcripts
  // so its conversation review has something to show (docs/privacy.md, "Admin store"). Kept for
  // the default 30 days, which the daily cron route enforces with sweep(). In memory without
  // Upstash: each instance then keeps its own, and a restart forgets them.
  ...(adminConsole
    ? {
        admin: {
          store: shared ? upstashAdminStore() : memoryAdminStore(),
          transcripts: true,
          console: { allow: adminAllow, dashboard: adminDashboard() },
        },
      }
    : {}),
});
