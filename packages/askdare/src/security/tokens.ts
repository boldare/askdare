import { EncryptJWT, errors, jwtDecrypt } from 'jose';
import type { AttachmentKind } from '../attachments/files';
import { AskdareError } from '../errors';
import type { VerifiedIdentity, VisitorIdentity } from './identity';

const ISSUER = 'askdare';
const ACCESS_TYP = 'askdare-access+jwt';
const RESUME_TYP = 'askdare-resume+jwt';
const ATTACHMENT_TYP = 'askdare-attachment+jwt';
const FEEDBACK_TYP = 'askdare-feedback+jwt';
const DOCTOR_TYP = 'askdare-doctor+jwt';
const HISTORY_TYP = 'askdare-history+jwt';
const ADMIN_TYP = 'askdare-admin+jwt';
const ADMIN_REF_TYP = 'askdare-admin-ref+jwt';
const ADMIN_AUDIENCE = 'askdare-admin';
const ADMIN_REF_AUDIENCE = 'askdare-admin-ref';
/** An admin session lasts 15 minutes; a reload signs in again (ADR-0032, decision 8). */
const ADMIN_TTL_SECONDS = 15 * 60;
const ADMIN_SESSION = /^s_[0-9a-f]{32}$/;
/** A store's page cursor inside a history cursor: OpenAI's item IDs, a Postgres `seq`. */
const STORE_CURSOR_MAX = 1024;
const DOCTOR_AUDIENCE = 'askdare-doctor';
const DOCTOR_TTL_SECONDS = 120;
const MIN_SECRET_LENGTH = 32;
const MIN_DISTINCT_CHARACTERS = 12;
const VISITOR_ID = /^v_[0-9a-f]{32}$/;
/** OpenAI's `conv_…`, or another conversation store's own ID, such as a UUID (ADR-0024). */
const CONVERSATION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const FILE_ID = /^file-[A-Za-z0-9_-]{1,128}$/;
/**
 * The ID of an answer a feedback handle names: OpenAI's `msg_…` in its conversations, an item
 * store's `itm_…` (`newItemId`), which stateless turns write (ADR-0024).
 */
export const ANSWER_ITEM_ID: RegExp = /^(?:msg|itm)_[A-Za-z0-9_-]{1,128}$/;
/** How long after expiry an access token still identifies its visitor for a renewal. */
const RENEWAL_GRACE_SECONDS = 60 * 60;
const encoder = new TextEncoder();

export interface TokenServiceOptions {
  /** At least 32 random characters, e.g. from `crypto.randomBytes(32).toString('base64url')`. */
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
  /** The signed-in user, until the identity token's `exp` (ADR-0009). */
  readonly identity?: VerifiedIdentity | undefined;
}

/** What a renewal learns from the previous access token. */
export interface RenewalGrant extends AccessGrant {
  /** When the visitor passed the bot's human check (Unix seconds); absent when never (ADR-0023). */
  readonly humanCheckedAt?: number | undefined;
}

export interface ResumeGrant {
  readonly visitorId: string;
  readonly conversationId: string;
  /** Set when the conversation started while signed in: only that user may resume it. */
  readonly identityKey?: string | undefined;
}

/** An answer a visitor may rate: its conversation and the provider's ID of the message. */
export interface FeedbackGrant {
  readonly visitorId: string;
  readonly conversationId: string;
  readonly itemId: string;
  /** Set when the conversation is bound to a signed-in user, as in `ResumeGrant`. */
  readonly identityKey?: string | undefined;
}

/**
 * Where the next older page of a conversation's history ends (ADR-0024, decision 7): the store's
 * own cursor and how many of the newest items before it were already shown.
 */
export interface HistoryCursorGrant {
  readonly conversationId: string;
  readonly before: string;
  readonly skip: number;
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
  issueAccess(
    botId: string,
    visitorId: string,
    identity?: VerifiedIdentity | undefined,
    /** When the visitor passed the bot's human check, in Unix seconds; carried across renewals. */
    humanCheckedAt?: number | undefined,
  ): Promise<IssuedToken>;
  /** Throws `unauthorized` or `session_expired`. */
  verifyAccess(token: string, botId: string): Promise<AccessGrant>;
  /**
   * For session renewal: accepts an access token up to 1 hour past its expiry, so a visitor keeps
   * their identity (and their uploaded files) before they have a conversation. Throws `unauthorized`.
   */
  verifyRenewal(token: string, botId: string): Promise<RenewalGrant>;
  /**
   * A stable pseudonym for an ID: an HMAC with a key from CHAT_SECRET, so guessing the ID doesn't
   * reveal it. It changes when the secret rotates.
   */
  pseudonym(value: string): Promise<string>;
  issueResume(botId: string, grant: ResumeGrant): Promise<IssuedToken>;
  /** Throws `not_found`, so a forged or stale handle reveals nothing. */
  verifyResume(token: string, botId: string): Promise<ResumeGrant>;
  issueAttachment(botId: string, grant: AttachmentGrant): Promise<IssuedToken>;
  /** Throws `invalid_input` for a forged, expired or foreign handle, and for raw file IDs. */
  verifyAttachment(token: string, botId: string): Promise<AttachmentGrant>;
  /** A handle for rating one answer (ADR-0012). Lives as long as a resume handle. */
  issueFeedback(botId: string, grant: FeedbackGrant): Promise<IssuedToken>;
  /** Throws `not_found`, so a forged or stale handle reveals nothing. */
  verifyFeedback(token: string, botId: string): Promise<FeedbackGrant>;
  /**
   * The `before` cursor of `POST /history`: opaque to clients, and bound to the bot and the
   * conversation, so it can't name another conversation or a store cursor the server didn't
   * return. Lives as long as a resume handle.
   */
  issueHistoryCursor(botId: string, grant: HistoryCursorGrant): Promise<IssuedToken>;
  /** Throws `invalid_input` for a forged, expired or malformed cursor. */
  verifyHistoryCursor(token: string, botId: string): Promise<HistoryCursorGrant>;
  /** A 2-minute token with which `askdare doctor` proves it knows `CHAT_SECRET`. */
  issueDoctor(): Promise<IssuedToken>;
  /** Throws `unauthorized`. */
  verifyDoctor(token: string): Promise<void>;
  /** A 15-minute console session token (ADR-0032). */
  issueAdmin(
    grant: Omit<AdminGrant, 'session'>,
  ): Promise<IssuedToken & { readonly grant: AdminGrant }>;
  /** Throws `unauthorized`, or `session_expired` once it ran out. */
  verifyAdmin(token: string): Promise<AdminGrant & { readonly expiresAt: number }>;
  /** A conversation reference for the console's browser, valid until the session ends. */
  sealAdminReference(conversationId: string, session: string, expiresAt: number): Promise<string>;
  /** The conversation behind a reference sealed for this session; undefined otherwise. */
  openAdminReference(reference: string, session: string): Promise<string | undefined>;
}

/** A console session (ADR-0032, decision 8). */
export interface AdminGrant {
  /** A random ID per sign-in, which sealed references are bound to. */
  readonly session: string;
  /** Who signed in: `secret`, or `user:<sub>` for an allowlisted identity. */
  readonly subject: string;
  /** A pseudonym of `ADMIN_SECRET` or of the subject; a rotated secret no longer matches. */
  readonly fingerprint: string;
}

interface DerivedKey {
  readonly kid: string;
  readonly key: Uint8Array;
  /** A separate key for pseudonyms, so they never share key material with token encryption. */
  readonly pseudonymKey: Uint8Array;
}

async function deriveKey(secret: string, name: string): Promise<DerivedKey> {
  if (secret.length < MIN_SECRET_LENGTH || new Set(secret).size < MIN_DISTINCT_CHARACTERS) {
    throw new TypeError(
      `[askdare] ${name} must be at least ${MIN_SECRET_LENGTH} random characters. Generate one with: node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`,
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
  const kid = Array.from(await derive('askdare kid v1', 64), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return {
    kid,
    key: await derive('askdare token encryption v1', 256),
    pseudonymKey: await derive('askdare pseudonym v1', 256),
  };
}

/** The identity an access token carries, while it lasts. Our own encrypted claim: no re-check needed. */
function identityOf(payload: Record<string, unknown>, now: number) {
  const { idn, ixp } = payload;
  if (typeof idn !== 'object' || idn === null || typeof ixp !== 'number' || ixp <= now) {
    return undefined;
  }
  return { identity: idn as VisitorIdentity, expiresAt: ixp };
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
  const pseudonymKey = await crypto.subtle.importKey(
    'raw',
    current.pseudonymKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  async function issue(
    typ: string,
    botId: string,
    subject: string,
    ttl: number,
    claims: Record<string, unknown> = {},
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

  const hex = (bytes: Uint8Array): string =>
    Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

  return {
    issueAccess: (botId, visitorId, identity, humanCheckedAt) =>
      issue(
        ACCESS_TYP,
        botId,
        visitorId,
        // A signed-in session ends with the identity token, then renews with the page's latest one.
        identity ? Math.max(1, Math.min(accessTtl, identity.expiresAt - now())) : accessTtl,
        {
          // An object, not a JSON string: escaping it twice would bloat the token.
          ...(identity ? { idn: { ...identity.identity }, ixp: identity.expiresAt } : {}),
          ...(humanCheckedAt === undefined ? {} : { hv: humanCheckedAt }),
        },
      ),

    async verifyAccess(token, botId) {
      try {
        const { payload } = await verify(token, ACCESS_TYP, botId);
        if (typeof payload.sub !== 'string' || !VISITOR_ID.test(payload.sub)) {
          throw new AskdareError('unauthorized');
        }
        return { visitorId: payload.sub, identity: identityOf(payload, now()) };
      } catch (error) {
        if (error instanceof errors.JWTExpired) {
          throw new AskdareError('session_expired', { cause: error });
        }
        throw new AskdareError('unauthorized', { cause: error });
      }
    },

    async verifyRenewal(token, botId) {
      try {
        const { payload } = await verify(token, ACCESS_TYP, botId, RENEWAL_GRACE_SECONDS);
        if (typeof payload.sub !== 'string' || !VISITOR_ID.test(payload.sub)) {
          throw new AskdareError('unauthorized');
        }
        const { hv } = payload;
        return {
          visitorId: payload.sub,
          identity: identityOf(payload, now()),
          ...(typeof hv === 'number' && Number.isFinite(hv) ? { humanCheckedAt: hv } : {}),
        };
      } catch (error) {
        throw new AskdareError('unauthorized', { cause: error });
      }
    },

    async pseudonym(value) {
      const digest = await crypto.subtle.sign('HMAC', pseudonymKey, encoder.encode(value));
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
        '',
      );
    },

    issueResume: (botId, grant) =>
      issue(RESUME_TYP, botId, grant.visitorId, resumeTtl, {
        cid: grant.conversationId,
        ...(grant.identityKey ? { ids: grant.identityKey } : {}),
      }),

    async verifyResume(token, botId) {
      try {
        const { payload } = await verify(token, RESUME_TYP, botId);
        const { cid, ids } = payload;
        if (
          typeof payload.sub !== 'string' ||
          !VISITOR_ID.test(payload.sub) ||
          typeof cid !== 'string' ||
          !CONVERSATION_ID.test(cid) ||
          (ids !== undefined && typeof ids !== 'string')
        ) {
          throw new AskdareError('not_found');
        }
        return {
          visitorId: payload.sub,
          conversationId: cid,
          ...(ids === undefined ? {} : { identityKey: ids }),
        };
      } catch (error) {
        throw new AskdareError('not_found', { cause: error });
      }
    },

    issueAttachment: (botId, grant) =>
      issue(ATTACHMENT_TYP, botId, grant.visitorId, attachmentTtl, {
        fid: grant.fileId,
        knd: grant.kind,
        est: grant.tokens,
      }),

    async verifyAttachment(token, botId) {
      const invalid = (cause?: unknown): AskdareError =>
        new AskdareError('invalid_input', {
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

    issueFeedback: (botId, grant) =>
      issue(FEEDBACK_TYP, botId, grant.visitorId, resumeTtl, {
        cid: grant.conversationId,
        iid: grant.itemId,
        ...(grant.identityKey ? { ids: grant.identityKey } : {}),
      }),

    async verifyFeedback(token, botId) {
      try {
        const { payload } = await verify(token, FEEDBACK_TYP, botId);
        const { cid, iid, ids } = payload;
        if (
          typeof payload.sub !== 'string' ||
          !VISITOR_ID.test(payload.sub) ||
          typeof cid !== 'string' ||
          !CONVERSATION_ID.test(cid) ||
          typeof iid !== 'string' ||
          !ANSWER_ITEM_ID.test(iid) ||
          (ids !== undefined && typeof ids !== 'string')
        ) {
          throw new AskdareError('not_found');
        }
        return {
          visitorId: payload.sub,
          conversationId: cid,
          itemId: iid,
          ...(ids === undefined ? {} : { identityKey: ids }),
        };
      } catch (error) {
        throw new AskdareError('not_found', { cause: error });
      }
    },

    issueHistoryCursor: (botId, grant) =>
      issue(HISTORY_TYP, botId, grant.conversationId, resumeTtl, {
        bfr: grant.before,
        skp: grant.skip,
      }),

    async verifyHistoryCursor(token, botId) {
      const invalid = (cause?: unknown): AskdareError =>
        new AskdareError('invalid_input', {
          message: 'The history cursor is invalid. Load the history again.',
          key: 'error.history',
          cause,
        });
      let payload: Awaited<ReturnType<typeof verify>>['payload'];
      try {
        ({ payload } = await verify(token, HISTORY_TYP, botId));
      } catch (error) {
        throw invalid(error);
      }
      const { bfr, skp } = payload;
      if (
        typeof payload.sub !== 'string' ||
        !CONVERSATION_ID.test(payload.sub) ||
        typeof bfr !== 'string' ||
        bfr.length === 0 ||
        bfr.length > STORE_CURSOR_MAX ||
        typeof skp !== 'number' ||
        !Number.isSafeInteger(skp) ||
        skp < 0 ||
        skp > 1000
      ) {
        throw invalid();
      }
      return { conversationId: payload.sub, before: bfr, skip: skp };
    },

    issueDoctor: () => issue(DOCTOR_TYP, DOCTOR_AUDIENCE, 'doctor', DOCTOR_TTL_SECONDS),

    async verifyDoctor(token) {
      try {
        await verify(token, DOCTOR_TYP, DOCTOR_AUDIENCE);
      } catch {
        throw new AskdareError('unauthorized');
      }
    },

    async issueAdmin(grant) {
      const session = `s_${hex(crypto.getRandomValues(new Uint8Array(16)))}`;
      const issued = await issue(ADMIN_TYP, ADMIN_AUDIENCE, session, ADMIN_TTL_SECONDS, {
        adm: grant.subject,
        afp: grant.fingerprint,
      });
      return { ...issued, grant: { ...grant, session } };
    },

    async verifyAdmin(token) {
      try {
        const { payload } = await verify(token, ADMIN_TYP, ADMIN_AUDIENCE);
        const { adm, afp, exp } = payload;
        if (
          typeof payload.sub !== 'string' ||
          !ADMIN_SESSION.test(payload.sub) ||
          typeof adm !== 'string' ||
          typeof afp !== 'string' ||
          typeof exp !== 'number'
        ) {
          throw new AskdareError('unauthorized');
        }
        return { session: payload.sub, subject: adm, fingerprint: afp, expiresAt: exp };
      } catch (error) {
        if (error instanceof errors.JWTExpired) {
          throw new AskdareError('session_expired', { cause: error });
        }
        throw new AskdareError('unauthorized', { cause: error });
      }
    },

    async sealAdminReference(conversationId, session, expiresAt) {
      const ttl = Math.max(1, expiresAt - now());
      return (await issue(ADMIN_REF_TYP, ADMIN_REF_AUDIENCE, conversationId, ttl, { ses: session }))
        .token;
    },

    async openAdminReference(reference, session) {
      try {
        const { payload } = await verify(reference, ADMIN_REF_TYP, ADMIN_REF_AUDIENCE);
        if (
          typeof payload.sub !== 'string' ||
          !CONVERSATION_ID.test(payload.sub) ||
          payload['ses'] !== session
        ) {
          return undefined;
        }
        return payload.sub;
      } catch {
        return undefined;
      }
    },
  };
}

/** Server-generated, unguessable visitor identifier. Never accepted from clients. */
export function newVisitorId(): string {
  return `v_${crypto.randomUUID().replaceAll('-', '')}`;
}
