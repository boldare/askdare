import { EncryptJWT, errors, jwtDecrypt } from 'jose';
import { ChatdockError } from '../errors';

const ISSUER = 'chatdock';
const ACCESS_TYP = 'chatdock-access+jwt';
const RESUME_TYP = 'chatdock-resume+jwt';
const MIN_SECRET_LENGTH = 32;
const MIN_DISTINCT_CHARACTERS = 12;
const VISITOR_ID = /^v_[0-9a-f]{32}$/;
const CONVERSATION_ID = /^conv_[A-Za-z0-9_-]{1,128}$/;
const encoder = new TextEncoder();

export interface TokenServiceOptions {
  /** At least 32 random characters, e.g. `openssl rand -base64 32`. */
  readonly secret: string;
  /** Former secrets still accepted for verification during rotation. */
  readonly previousSecrets?: readonly string[];
  /** Default 15 minutes. */
  readonly accessTtlSeconds?: number;
  /** Default 30 days. */
  readonly resumeTtlSeconds?: number;
  /** Clock in seconds, for tests. */
  readonly now?: () => number;
}

export interface IssuedToken {
  readonly token: string;
  /** Unix time in seconds. */
  readonly expiresAt: number;
}

export interface AccessGrant {
  readonly visitorId: string;
}

export interface ResumeGrant {
  readonly visitorId: string;
  readonly conversationId: string;
}

/**
 * Issues and verifies the two session tokens (ADR-0004). Both are encrypted (JWE, `dir` +
 * A256GCM), so they are tamper-proof and opaque: clients never see raw OpenAI conversation IDs.
 */
export interface TokenService {
  issueAccess(botId: string, visitorId: string): Promise<IssuedToken>;
  /** Throws `unauthorized` or `session_expired`. */
  verifyAccess(token: string, botId: string): Promise<AccessGrant>;
  issueResume(botId: string, grant: ResumeGrant): Promise<IssuedToken>;
  /** Throws `not_found`, so a forged or stale handle reveals nothing. */
  verifyResume(token: string, botId: string): Promise<ResumeGrant>;
}

interface DerivedKey {
  readonly kid: string;
  readonly key: Uint8Array;
}

async function deriveKey(secret: string, name: string): Promise<DerivedKey> {
  if (secret.length < MIN_SECRET_LENGTH || new Set(secret).size < MIN_DISTINCT_CHARACTERS) {
    throw new TypeError(
      `[chatdock] ${name} must be at least ${MIN_SECRET_LENGTH} random characters (use \`openssl rand -base64 32\`).`,
    );
  }
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, [
    'deriveBits',
  ]);
  const derive = async (info: string, bits: number): Promise<Uint8Array> =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(ISSUER), info: encoder.encode(info) },
        material,
        bits,
      ),
    );
  const kid = Array.from(await derive('chatdock kid v1', 64), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return { kid, key: await derive('chatdock token encryption v1', 256) };
}

export async function createTokenService(options: TokenServiceOptions): Promise<TokenService> {
  const current = await deriveKey(options.secret, 'CHAT_SECRET');
  const keys = new Map<string, Uint8Array>([[current.kid, current.key]]);
  for (const secret of options.previousSecrets ?? []) {
    const previous = await deriveKey(secret, 'CHAT_SECRET_PREVIOUS');
    keys.set(previous.kid, previous.key);
  }
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const accessTtl = options.accessTtlSeconds ?? 15 * 60;
  const resumeTtl = options.resumeTtlSeconds ?? 30 * 24 * 60 * 60;

  async function issue(
    typ: string,
    botId: string,
    subject: string,
    ttl: number,
    claims: Record<string, string> = {},
  ): Promise<IssuedToken> {
    const issuedAt = now();
    const expiresAt = issuedAt + ttl;
    const token = await new EncryptJWT(claims)
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', typ, kid: current.kid })
      .setIssuer(ISSUER)
      .setAudience(botId)
      .setSubject(subject)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .encrypt(current.key);
    return { token, expiresAt };
  }

  async function verify(token: string, typ: string, botId: string) {
    // Never fall back to a default key: with `dir`, any fixed key would let anyone mint tokens.
    const resolveKey = (header: { kid?: string | undefined }): Uint8Array => {
      const key = header.kid === undefined ? undefined : keys.get(header.kid);
      if (!key) throw new errors.JWEDecryptionFailed();
      return key;
    };
    return jwtDecrypt(token, resolveKey, {
      requiredClaims: ['exp', 'iat', 'sub'],
      issuer: ISSUER,
      audience: botId,
      typ,
      keyManagementAlgorithms: ['dir'],
      contentEncryptionAlgorithms: ['A256GCM'],
      currentDate: new Date(now() * 1000),
    });
  }

  return {
    issueAccess: (botId, visitorId) => issue(ACCESS_TYP, botId, visitorId, accessTtl),

    async verifyAccess(token, botId) {
      try {
        const { payload } = await verify(token, ACCESS_TYP, botId);
        if (typeof payload.sub !== 'string' || !VISITOR_ID.test(payload.sub)) {
          throw new ChatdockError('unauthorized');
        }
        return { visitorId: payload.sub };
      } catch (error) {
        if (error instanceof errors.JWTExpired) {
          throw new ChatdockError('session_expired', { cause: error });
        }
        throw new ChatdockError('unauthorized', { cause: error });
      }
    },

    issueResume: (botId, grant) =>
      issue(RESUME_TYP, botId, grant.visitorId, resumeTtl, { cid: grant.conversationId }),

    async verifyResume(token, botId) {
      try {
        const { payload } = await verify(token, RESUME_TYP, botId);
        const cid = payload['cid'];
        if (
          typeof payload.sub !== 'string' ||
          !VISITOR_ID.test(payload.sub) ||
          typeof cid !== 'string' ||
          !CONVERSATION_ID.test(cid)
        ) {
          throw new ChatdockError('not_found');
        }
        return { visitorId: payload.sub, conversationId: cid };
      } catch (error) {
        throw new ChatdockError('not_found', { cause: error });
      }
    },
  };
}

/** Server-generated, unguessable visitor identifier. Never accepted from clients. */
export function newVisitorId(): string {
  return `v_${crypto.randomUUID().replaceAll('-', '')}`;
}
