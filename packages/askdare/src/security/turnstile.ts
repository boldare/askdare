import { z } from 'zod';
import { AskdareError } from '../errors';
import {
  HUMAN_TOKEN_MAX_LENGTH,
  type HumanCheckContext,
  type HumanVerifier,
  TURNSTILE_ORIGIN,
} from './human-verifier';

export interface TurnstileOptions {
  /** The widget's site key from the Cloudflare dashboard. Public: browsers receive it. */
  readonly siteKey: string;
  /**
   * The widget's secret key. Default `process.env.TURNSTILE_SECRET_KEY`, read at the first check,
   * so building the app never needs it.
   */
  readonly secretKey?: string;
}

const SITEVERIFY = `${TURNSTILE_ORIGIN}/turnstile/v0/siteverify`;

const SITE_KEY = /^[A-Za-z0-9_-]{1,100}$/;

/** The fields of Cloudflare's siteverify response that the decision needs. */
const siteverifyResponse = z.object({
  success: z.boolean(),
  'error-codes': z.array(z.string()).optional(),
});

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
      if (parsed.data.success) return true;
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
