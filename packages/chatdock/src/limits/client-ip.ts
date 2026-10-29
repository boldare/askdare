/**
 * Which proxy to trust when reading the client IP:
 * - `vercel`: Vercel overwrites `x-forwarded-for`, so its first entry is reliable.
 * - `heroku`: Heroku's router appends the client IP, so the last entry is reliable and anything to
 *   its left may be spoofed.
 * - a number `n`: there are `n` trusted proxies; take the n-th entry from the right.
 * - `auto` (default): `vercel` when `VERCEL` is set, `heroku` when `DYNO` is set, otherwise 1.
 */
export type TrustProxy = 'auto' | 'vercel' | 'heroku' | number;

function resolve(trustProxy: TrustProxy): 'vercel' | number {
  if (trustProxy === 'vercel') return 'vercel';
  if (trustProxy === 'heroku') return 1;
  if (typeof trustProxy === 'number') return Math.max(1, Math.floor(trustProxy));
  if (process.env['VERCEL']) return 'vercel';
  return 1;
}

/** Best-effort client IP for rate-limit keys. Never use it for authentication. */
export function getClientIp(request: Request, trustProxy: TrustProxy = 'auto'): string {
  const mode = resolve(trustProxy);
  const forwarded = (request.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (mode === 'vercel') {
    return request.headers.get('x-real-ip') ?? forwarded[0] ?? 'unknown';
  }
  return forwarded.at(-mode) ?? request.headers.get('x-real-ip') ?? 'unknown';
}
