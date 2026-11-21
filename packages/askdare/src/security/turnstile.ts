import { z } from 'zod';
import { AskdareError } from '../errors';
import {
  HUMAN_TOKEN_MAX_LENGTH,
  type HumanCheckContext,
  type HumanVerifier,
  TURNSTILE_ORIGIN,
  turnstileAction,
} from './human-verifier';

export interface TurnstileOptions {
  /** The widget's site key from the Cloudflare dashboard. Public: browsers receive it. */
  readonly siteKey: string;
  /**
   * The widget's secret key. Default `process.env.TURNSTILE_SECRET_KEY`, read at the first check,
   * so building the app never needs it.
   */
  readonly secretKey?: string;
  /**
   * Host names the challenge may have been solved on, compared with siteverify's `hostname`, such
   * as `['www.example.com']`: the host of your chat route's app. Off by default, because the
   * dashboard's hostname list already limits where the widget runs, and a proxy that serves the
   * app under another name would be refused. Skipped with Cloudflare's test secret keys.
   */
  readonly hostnames?: readonly string[];
}

const SITEVERIFY = `${TURNSTILE_ORIGIN}/turnstile/v0/siteverify`;

const SITE_KEY = /^[A-Za-z0-9_-]{1,100}$/;

/** The fields of Cloudflare's siteverify response that the decision needs. */
const siteverifyResponse = z.object({
  success: z.boolean(),
  'error-codes': z.array(z.string()).optional(),
  hostname: z.string().optional(),
  action: z.string().optional(),
});

/**
 * Cloudflare's published test secret keys: they answer for a dummy token, always with the
 * hostname example.com and without an action, so those two checks can't apply.
 */
const TEST_SECRETS = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
]);

/** Codes that mean the operator's setup is wrong, not the visitor's token. */
const SETUP_ERRORS = new Set(['missing-input-secret', 'invalid-input-secret']);

const processEnv = (name: string): string | undefined =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];

/**
 * A `HumanVerifier` backed by Cloudflare Turnstile: the chat shows the Turnstile widget before a
 * new session starts, and the server checks its token with Cloudflare's siteverify endpoint.
 *
 * ```ts
 * // The site key is public; the secret key comes from TURNSTILE_SECRET_KEY.
 * security: { humanVerifier: turnstile({ siteKey: '0x4AAAAAAA…' }) }
 * ```
 */
export function turnstile(options: TurnstileOptions): HumanVerifier {
  const siteKey = typeof options.siteKey === 'string' ? options.siteKey.trim() : '';
  if (!SITE_KEY.test(siteKey)) {
    throw new TypeError(
      '[askdare] turnstile() needs the siteKey of a Turnstile widget (letters, digits, - and _).',
    );
  }
  const hostnames = options.hostnames?.map((host) => host.trim().toLowerCase());
  return Object.freeze({
    challenge: Object.freeze({ provider: 'turnstile' as const, siteKey }),
    verify: async (token: string, context: HumanCheckContext): Promise<boolean> => {
      const secret = options.secretKey ?? processEnv('TURNSTILE_SECRET_KEY');
      if (!secret) {
        throw new AskdareError('bot_unavailable', {
          cause: 'TURNSTILE_SECRET_KEY is not configured.',
        });
      }
      if (token.length === 0 || token.length > HUMAN_TOKEN_MAX_LENGTH) return false;
      let response: Response;
      try {
        response = await fetch(SITEVERIFY, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ secret, response: token }),
          signal: context.signal,
        });
      } catch (error) {
        throw new AskdareError(context.signal.aborted ? 'timeout' : 'upstream_error', {
          cause: new Error('Cloudflare Turnstile siteverify could not be reached.', {
            cause: error,
          }),
        });
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      const parsed = siteverifyResponse.safeParse(body);
      if (!parsed.success) {
        throw new AskdareError('upstream_error', {
          cause: `Cloudflare Turnstile siteverify answered ${response.status} without a result.`,
        });
      }
      if (parsed.data.success) {
        if (TEST_SECRETS.has(secret)) return true;
        // A token from another widget on the same key, or another bot's chat, doesn't count.
        if (parsed.data.action !== turnstileAction(context.botId)) return false;
        const hostname = parsed.data.hostname?.toLowerCase();
        return hostnames === undefined || (hostname !== undefined && hostnames.includes(hostname));
      }
      const codes = parsed.data['error-codes'] ?? [];
      if (codes.some((code) => SETUP_ERRORS.has(code))) {
        throw new AskdareError('bot_unavailable', {
          cause: `Cloudflare rejected the Turnstile secret key (${codes.join(', ')}). Check TURNSTILE_SECRET_KEY.`,
        });
      }
      if (codes.includes('internal-error')) {
        throw new AskdareError('upstream_error', {
          cause: 'Cloudflare Turnstile siteverify reported an internal error.',
        });
      }
      // invalid-input-response, timeout-or-duplicate, bad-request: the visitor tries again.
      return false;
    },
  });
}
