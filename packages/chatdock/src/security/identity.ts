import { errors, jwtVerify } from 'jose';

/** A signed-in user, as the site's backend vouched for it (ADR-0009). */
export interface VisitorIdentity {
  /** The site's own user ID: the JWT's `sub`. */
  readonly id: string;
  readonly name?: string | undefined;
  readonly email?: string | undefined;
  /** Other string, number or boolean claims of the token, such as a plan or a role. */
  readonly claims: Readonly<Record<string, string | number | boolean>>;
}

/** An identity and when it ends: the token's `exp`, in seconds. */
export interface VerifiedIdentity {
  readonly identity: VisitorIdentity;
  readonly expiresAt: number;
}

export type IdentityFailure =
  | 'malformed'
  | 'signature'
  | 'expired'
  | 'audience'
  | 'lifetime'
  | 'claims'
  | 'too_large';

export interface IdentityVerifier {
  /** Never throws: a failure says why, for the site's developers, and grants nothing. */
  verify(
    token: string,
    botId: string,
  ): Promise<
    | { readonly ok: true; readonly verified: VerifiedIdentity }
    | { readonly ok: false; readonly reason: IdentityFailure }
  >;
}

const MIN_SECRET_LENGTH = 32;
const MIN_DISTINCT_CHARACTERS = 12;
/** Longest allowed gap between `iat` and `exp`. */
const MAX_LIFETIME_SECONDS = 24 * 60 * 60;
/** Identities travel inside access tokens, which the widget sends with every request. */
const MAX_IDENTITY_BYTES = 2048;
const MAX_CLAIMS = 20;
const REGISTERED = new Set(['iss', 'sub', 'aud', 'exp', 'nbf', 'iat', 'jti', 'name', 'email']);
const encoder = new TextEncoder();

/** The identity part of a JWT payload, or undefined when a claim has the wrong shape. */
export function identityFromClaims(payload: Record<string, unknown>): VisitorIdentity | undefined {
  const { sub, name, email } = payload;
  if (typeof sub !== 'string' || sub.length === 0 || sub.length > 256) return undefined;
  if (name !== undefined && (typeof name !== 'string' || name.length > 200)) return undefined;
  if (email !== undefined && (typeof email !== 'string' || email.length > 320)) return undefined;
  const claims: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (REGISTERED.has(key)) continue;
    if (key.length > 64) return undefined;
    if (typeof value === 'string' || typeof value === 'boolean') claims[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) claims[key] = value;
    // Objects and arrays aren't passed on: tools get flat, predictable values.
  }
  if (Object.keys(claims).length > MAX_CLAIMS) return undefined;
  return {
    id: sub,
    ...(name === undefined ? {} : { name }),
    ...(email === undefined ? {} : { email }),
    claims,
  };
}

/**
 * Checks identity JWTs from the site's backend: HS256 with IDENTITY_SECRET, the bot as audience,
 * a bounded lifetime (ADR-0009).
 */
export function createIdentityVerifier(options: {
  readonly secret: string;
  /** CHAT_SECRET: the two must differ, so neither can stand in for the other. */
  readonly chatSecret?: string | undefined;
  /** Clock in seconds, for tests. */
  readonly now?: () => number;
}): IdentityVerifier {
  const { secret } = options;
  if (secret.length < MIN_SECRET_LENGTH || new Set(secret).size < MIN_DISTINCT_CHARACTERS) {
    throw new TypeError(
      `[chatdock] IDENTITY_SECRET must be at least ${MIN_SECRET_LENGTH} random characters (use \`openssl rand -base64 32\`).`,
    );
  }
  if (secret === options.chatSecret) {
    throw new TypeError('[chatdock] IDENTITY_SECRET must differ from CHAT_SECRET.');
  }
  const key = encoder.encode(secret);
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));

  return {
    async verify(token, botId) {
      let payload: Record<string, unknown>;
      try {
        ({ payload } = await jwtVerify(token, key, {
          algorithms: ['HS256'],
          audience: botId,
          requiredClaims: ['sub', 'iat', 'exp'],
          currentDate: new Date(now() * 1000),
          clockTolerance: 30,
        }));
      } catch (error) {
        if (error instanceof errors.JWTExpired) return { ok: false, reason: 'expired' };
        if (error instanceof errors.JWSSignatureVerificationFailed) {
          return { ok: false, reason: 'signature' };
        }
        if (error instanceof errors.JWTClaimValidationFailed && error.claim === 'aud') {
          return { ok: false, reason: 'audience' };
        }
        return { ok: false, reason: 'malformed' };
      }
      const { iat, exp } = payload;
      if (typeof iat !== 'number' || typeof exp !== 'number' || exp - iat > MAX_LIFETIME_SECONDS) {
        return { ok: false, reason: 'lifetime' };
      }
      const identity = identityFromClaims(payload);
      if (!identity) return { ok: false, reason: 'claims' };
      if (encoder.encode(JSON.stringify(identity)).length > MAX_IDENTITY_BYTES) {
        return { ok: false, reason: 'too_large' };
      }
      return { ok: true, verified: { identity, expiresAt: exp } };
    },
  };
}

/** Binds conversations to a user of a bot without putting the user's ID in tokens or logs. */
export async function identityKey(botId: string, identity: VisitorIdentity): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${botId}\n${identity.id}`));
  return Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
