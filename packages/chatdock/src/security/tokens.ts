import { EncryptJWT, errors, jwtDecrypt } from 'jose';
import type { AttachmentKind } from '../attachments/files';
import { ChatdockError } from '../errors';

const ISSUER = 'chatdock';
const ACCESS_TYP = 'chatdock-access+jwt';
const RESUME_TYP = 'chatdock-resume+jwt';
const ATTACHMENT_TYP = 'chatdock-attachment+jwt';
const DOCTOR_TYP = 'chatdock-doctor+jwt';
const DOCTOR_AUDIENCE = 'chatdock-doctor';
const DOCTOR_TTL_SECONDS = 120;
const MIN_SECRET_LENGTH = 32;
const MIN_DISTINCT_CHARACTERS = 12;
const VISITOR_ID = /^v_[0-9a-f]{32}$/;
const CONVERSATION_ID = /^conv_[A-Za-z0-9_-]{1,128}$/;
const FILE_ID = /^file-[A-Za-z0-9_-]{1,128}$/;
/** How long after expiry an access token still identifies its visitor for a renewal. */
const RENEWAL_GRACE_SECONDS = 60 * 60;
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
  /** How long an uploaded file can wait to be sent. Default 1 hour. */
  readonly attachmentTtlSeconds?: number;
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

export interface AttachmentGrant {
  readonly visitorId: string;
  readonly fileId: string;
  readonly kind: AttachmentKind;
  /** Server estimate of the input tokens the file adds to a turn. */
  readonly tokens: number;
}

/**
 * Issues and verifies the session tokens and attachment handles (ADR-0004). All are encrypted
 * (JWE, `dir` + A256GCM), so they are tamper-proof and opaque: clients never see raw OpenAI
 * conversation or file IDs.
 */
export interface TokenService {
  issueAccess(botId: string, visitorId: string): Promise<IssuedToken>;
  /** Throws `unauthorized` or `session_expired`. */
  verifyAccess(token: string, botId: string): Promise<AccessGrant>;
  /**
   * For session renewal: accepts an access token up to 1 hour past its expiry, so a visitor keeps
   * their identity (and their uploaded files) before they have a conversation. Throws `unauthorized`.
   */
  verifyRenewal(token: string, botId: string): Promise<AccessGrant>;
  issueResume(botId: string, grant: ResumeGrant): Promise<IssuedToken>;
  /** Throws `not_found`, so a forged or stale handle reveals nothing. */
  verifyResume(token: string, botId: string): Promise<ResumeGrant>;
  issueAttachment(botId: string, grant: AttachmentGrant): Promise<IssuedToken>;
  /** Throws `invalid_input` for a forged, expired or foreign handle, and for raw file IDs. */
  verifyAttachment(token: string, botId: string): Promise<AttachmentGrant>;
  /** A 2-minute token with which `chatdock doctor` proves it knows `CHAT_SECRET`. */
  issueDoctor(): Promise<IssuedToken>;
  /** Throws `unauthorized`. */
  verifyDoctor(token: string): Promise<void>;
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
  const attachmentTtl = options.attachmentTtlSeconds ?? 60 * 60;

  async function issue(
    typ: string,
    botId: string,
    subject: string,
    ttl: number,
    claims: Record<string, string | number> = {},
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

  async function verify(token: string, typ: string, botId: string, clockTolerance = 0) {
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
      clockTolerance,
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

    async verifyRenewal(token, botId) {
      try {
        const { payload } = await verify(token, ACCESS_TYP, botId, RENEWAL_GRACE_SECONDS);
        if (typeof payload.sub !== 'string' || !VISITOR_ID.test(payload.sub)) {
          throw new ChatdockError('unauthorized');
        }
        return { visitorId: payload.sub };
      } catch (error) {
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

    issueAttachment: (botId, grant) =>
      issue(ATTACHMENT_TYP, botId, grant.visitorId, attachmentTtl, {
        fid: grant.fileId,
        knd: grant.kind,
        est: grant.tokens,
      }),

    async verifyAttachment(token, botId) {
      const invalid = (cause?: unknown): ChatdockError =>
        new ChatdockError('invalid_input', {
          message: 'An attachment expired or is invalid. Please attach it again.',
          key: 'error.attachmentExpired',
          cause,
        });
      let payload: Awaited<ReturnType<typeof verify>>['payload'];
      try {
        ({ payload } = await verify(token, ATTACHMENT_TYP, botId));
      } catch (error) {
        throw invalid(error);
      }
      const { fid, knd, est } = payload;
      if (
        typeof payload.sub !== 'string' ||
        !VISITOR_ID.test(payload.sub) ||
        typeof fid !== 'string' ||
        !FILE_ID.test(fid) ||
        (knd !== 'image' && knd !== 'pdf') ||
        typeof est !== 'number' ||
        !Number.isSafeInteger(est) ||
        est < 0
      ) {
        throw invalid();
      }
      return { visitorId: payload.sub, fileId: fid, kind: knd, tokens: est };
    },

    issueDoctor: () => issue(DOCTOR_TYP, DOCTOR_AUDIENCE, 'doctor', DOCTOR_TTL_SECONDS),

    async verifyDoctor(token) {
      try {
        await verify(token, DOCTOR_TYP, DOCTOR_AUDIENCE);
      } catch {
        throw new ChatdockError('unauthorized');
      }
    },
  };
}

/** Server-generated, unguessable visitor identifier. Never accepted from clients. */
export function newVisitorId(): string {
  return `v_${crypto.randomUUID().replaceAll('-', '')}`;
}
