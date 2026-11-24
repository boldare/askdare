import { defineBot } from '@boldare/askdare';
import { type ChatHandlers, createChatHandler } from '@boldare/askdare/next';
import { postgresConversations } from '@boldare/askdare-postgres';
import { currentTime } from '@/tools';

// Must be a literal in this file; keep it above the bot's turn timeout.
export const maxDuration = 300;

/**
 * A chat kept in Postgres with stateless turns, for the end-to-end tests only (e2e/postgres.spec.ts).
 * Off unless ASKDARE_E2E_DATABASE_URL is set, which only the Playwright config does: everywhere else
 * this route answers 404 and the demo's chat at /api/chat is unchanged.
 */
let handlers: ChatHandlers | undefined;

function enabled(): ChatHandlers | undefined {
  const url = process.env.ASKDARE_E2E_DATABASE_URL;
  const model = process.env.ASKDARE_MODEL;
  if (!url || !model) return undefined;
  handlers ??= createChatHandler({
    basePath: '/api/e2e-postgres',
    bots: [
      defineBot({
        id: 'postgres',
        model,
        instructions: 'You answer the end-to-end tests.',
        tools: [currentTime],
        // The tests chat from one address, faster than the per-address defaults allow.
        limits: {
          sessionsPerIpPerHour: 1000,
          conversationsPerIpPerHour: 1000,
          messagesPerIpPerMinute: 1000,
        },
        widget: { locale: 'en', title: 'Postgres chat', greeting: 'Kept in your own database' },
      }),
    ],
    conversations: postgresConversations({ url }),
  });
  return handlers;
}

const notFound = (): Response => new Response(null, { status: 404 });

export const GET = (request: Request): Promise<Response> | Response =>
  enabled()?.GET(request) ?? notFound();
export const POST = (request: Request): Promise<Response> | Response =>
  enabled()?.POST(request) ?? notFound();
export const DELETE = (request: Request): Promise<Response> | Response =>
  enabled()?.DELETE(request) ?? notFound();
