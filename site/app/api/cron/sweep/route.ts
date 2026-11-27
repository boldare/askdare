import { createHash, timingSafeEqual } from 'node:crypto';
import { chat } from '@/chat';

/**
 * The daily sweep (docs/admin.md, step 5): deletes admin records past `admin.retentionDays` and,
 * with a conversation store that can list them, idle conversations. Vercel Cron calls it with
 * `Authorization: Bearer <CRON_SECRET>` (the schedule is in vercel.json). Without CRON_SECRET the
 * route answers 404, so it never runs for anyone who finds it.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response(null, { status: 404 });
  if (!bearerMatches(request.headers.get('authorization'), secret)) {
    return new Response(null, { status: 401, headers: { 'www-authenticate': 'Bearer' } });
  }
  // { conversations, files, records, more }: with `more`, the next run continues.
  const result = await chat.sweep({ idleDays: 30, signal: request.signal });
  return Response.json(result, { headers: { 'cache-control': 'no-store' } });
}

/** Compares the token in constant time: both sides are hashed first, so lengths don't leak. */
function bearerMatches(header: string | null, secret: string): boolean {
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const digest = (value: string) => createHash('sha256').update(value).digest();
  // Hash both even without a token, so a missing header takes as long as a wrong one.
  return timingSafeEqual(digest(token), digest(secret)) && token.length > 0;
}
