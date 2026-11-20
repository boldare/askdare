import { embedPageHeaders } from '@boldare/askdare/next';
import { type NextRequest, NextResponse } from 'next/server';
import { bots } from './askdare.config';

/**
 * The pages that bots show in the widget's iframe (embedPath, ADR-0018) send the headers of
 * askdare's own iframe page: who may frame them, and the microphone only with voice input. Set
 * here, per request, because the allowed origins come from the environment where the app runs;
 * `headers()` in next.config.ts would fix them when the site is built.
 */
export function proxy(request: NextRequest): NextResponse {
  const response = NextResponse.next();
  const bot = bots.find((candidate) => candidate.embedPath === request.nextUrl.pathname);
  if (bot) {
    for (const { key, value } of embedPageHeaders({ bots, bot: bot.id })) {
      response.headers.set(key, value);
    }
  }
  return response;
}

export const config = { matcher: '/askdare/:bot' };
