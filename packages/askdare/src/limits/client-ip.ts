/**
 * Which proxy to trust when reading the client IP:
 * - `vercel`: Vercel overwrites `x-forwarded-for` and sets `x-real-ip`, so both are reliable.
 * - `heroku`: Heroku's router appends the client IP, so the last entry is reliable and anything to
 *   its left may be spoofed.
 * - a number `n`: there are `n` trusted proxies; take the n-th entry from the right.
 * - `auto` (default): `vercel` when `VERCEL` is set, otherwise one trusted proxy.
 *
 * Never expose `next start` without a proxy in front: the client then controls these headers.
 */
export type TrustProxy = 'auto' | 'vercel' | 'heroku' | number;

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HEXTET = /^[0-9a-f]{1,4}$/;

function ipv6Hextets(value: string): string[] | undefined {
  const halves = value.split('::');
  if (halves.length > 2) return undefined;
  const split = (part: string | undefined): string[] => (part ? part.split(':') : []);
  const head = split(halves[0]);
  const tail = split(halves[1]);
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const hextets = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  return hextets.every((hextet) => HEXTET.test(hextet)) ? hextets : undefined;
}

/**
 * Validates an address and turns it into a rate-limit key. IPv6 is reduced to its /64 prefix,
 * because anyone with a /64 (common on VPS providers) controls 2^64 addresses.
 */
export function normalizeIp(raw: string | undefined): string | undefined {
  if (!raw || raw.length > 64) return undefined;
  let ip = raw.trim().toLowerCase();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(ip);
  if (bracketed?.[1]) ip = bracketed[1];
  else if (/^[\d.]+:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(':'));
  if (IPV4.test(ip)) return ip;
  const mapped = /^::ffff:([\d.]+)$/.exec(ip);
  if (mapped?.[1] && IPV4.test(mapped[1])) return mapped[1];
  const hextets = ipv6Hextets(ip);
  if (!hextets) return undefined;
  return `${hextets
    .slice(0, 4)
    .map((hextet) => hextet.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

/** Best-effort client IP for rate-limit keys, never for authentication. `unknown` if unusable. */
export function getClientIp(request: Request, trustProxy: TrustProxy = 'auto'): string {
  const vercel =
    trustProxy === 'vercel' || (trustProxy === 'auto' && Boolean(process.env['VERCEL']));
  const forwarded = (request.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  let candidate: string | undefined;
  if (vercel) {
    candidate = request.headers.get('x-real-ip') ?? forwarded[0];
  } else {
    const proxies = typeof trustProxy === 'number' ? Math.max(1, Math.floor(trustProxy)) : 1;
    candidate = forwarded.length >= proxies ? forwarded[forwarded.length - proxies] : undefined;
  }
  return normalizeIp(candidate) ?? 'unknown';
}
