import { EncryptJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createTokenService, newVisitorId } from './tokens';

const SECRET = 'c2VjcmV0LWZvci10ZXN0cy0xMjM0NTY3ODkwYWJjZGVm';
const OLD_SECRET = 'b2xkLXNlY3JldC1mb3ItdGVzdHMtOTg3NjU0MzIxMHh5';
const VISITOR = `v_${'a1'.repeat(16)}`;
const OTHER_VISITOR = `v_${'b2'.repeat(16)}`;

/** A token encrypted with a key the attacker chose, as in the forged-token attack. */
async function forge(typ: string, kid: string | undefined, claims: Record<string, string> = {}) {
  return new EncryptJWT(claims)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', typ, ...(kid === undefined ? {} : { kid }) })
    .setIssuer('chatdock')
    .setAudience('support')
    .setSubject(VISITOR)
    .setIssuedAt()
    .setExpirationTime('10y')
    .encrypt(new Uint8Array(32));
}

describe('token service', () => {
  it('round-trips an access token for the same bot', async () => {
    const tokens = await createTokenService({ secret: SECRET });
    const { token, expiresAt } = await tokens.issueAccess('support', VISITOR);
    await expect(tokens.verifyAccess(token, 'support')).resolves.toEqual({ visitorId: VISITOR });
    expect(expiresAt).toBeGreaterThan(Date.now() / 1000);
  });

  it('round-trips a resume token and keeps the conversation ID opaque', async () => {
    const tokens = await createTokenService({ secret: SECRET });
    const { token } = await tokens.issueResume('support', {
      visitorId: VISITOR,
      conversationId: 'conv_secret123',
    });
    expect(token).not.toContain('conv_secret123');
    const [, payload = ''] = token.split('.');
    expect(Buffer.from(payload, 'base64url').toString('latin1')).not.toContain('conv_');
    await expect(tokens.verifyResume(token, 'support')).resolves.toEqual({
      visitorId: VISITOR,
      conversationId: 'conv_secret123',
    });
  });

  it('rejects tokens forged with a key of the attacker’s choice, with or without a key ID', async () => {
    const tokens = await createTokenService({ secret: SECRET });
    for (const kid of ['unknown', '', undefined]) {
      await expect(
        tokens.verifyAccess(await forge('chatdock-access+jwt', kid), 'support'),
      ).rejects.toMatchObject({ code: 'unauthorized' });
      await expect(
        tokens.verifyResume(
          await forge('chatdock-resume+jwt', kid, { cid: 'conv_victim' }),
          'support',
        ),
      ).rejects.toMatchObject({ code: 'not_found' });
    }
  });

  it('rejects a token issued for another bot', async () => {
    const tokens = await createTokenService({ secret: SECRET });
    const { token } = await tokens.issueAccess('support', VISITOR);
    await expect(tokens.verifyAccess(token, 'sales')).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('does not accept one token type as the other', async () => {
    const tokens = await createTokenService({ secret: SECRET });
    const access = await tokens.issueAccess('support', VISITOR);
    const resume = await tokens.issueResume('support', {
      visitorId: VISITOR,
      conversationId: 'conv_1',
    });
    await expect(tokens.verifyResume(access.token, 'support')).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(tokens.verifyAccess(resume.token, 'support')).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('rejects tampered and foreign tokens', async () => {
    const tokens = await createTokenService({ secret: SECRET });
    const foreign = await createTokenService({ secret: OLD_SECRET });
    const { token } = await tokens.issueAccess('support', VISITOR);
    const tampered = `${token.slice(0, -2)}${token.endsWith('A') ? 'B' : 'A'}${token.slice(-1)}`;
    await expect(tokens.verifyAccess(tampered, 'support')).rejects.toMatchObject({
      code: 'unauthorized',
    });
    const other = await foreign.issueAccess('support', VISITOR);
    await expect(tokens.verifyAccess(other.token, 'support')).rejects.toMatchObject({
      code: 'unauthorized',
    });
    await expect(tokens.verifyAccess('not-a-token', 'support')).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('reports expired access tokens as session_expired', async () => {
    let clock = 1_000_000;
    const tokens = await createTokenService({ secret: SECRET, now: () => clock });
    const { token } = await tokens.issueAccess('support', VISITOR);
    clock += 15 * 60 + 1;
    await expect(tokens.verifyAccess(token, 'support')).rejects.toMatchObject({
      code: 'session_expired',
    });
  });

  it('lets a renewal keep the visitor of an access token expired less than an hour ago', async () => {
    let clock = 1_000_000;
    const tokens = await createTokenService({ secret: SECRET, now: () => clock });
    const { token } = await tokens.issueAccess('support', VISITOR);
    clock += 15 * 60 + 30 * 60;
    await expect(tokens.verifyRenewal(token, 'support')).resolves.toEqual({ visitorId: VISITOR });
    clock += 31 * 60;
    await expect(tokens.verifyRenewal(token, 'support')).rejects.toMatchObject({
      code: 'unauthorized',
    });
    const resume = await tokens.issueResume('support', {
      visitorId: VISITOR,
      conversationId: 'conv_1',
    });
    await expect(tokens.verifyRenewal(resume.token, 'support')).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('accepts tokens from a previous secret during rotation', async () => {
    const old = await createTokenService({ secret: OLD_SECRET });
    const { token } = await old.issueAccess('support', OTHER_VISITOR);
    const rotated = await createTokenService({ secret: SECRET, previousSecrets: [OLD_SECRET] });
    await expect(rotated.verifyAccess(token, 'support')).resolves.toEqual({
      visitorId: OTHER_VISITOR,
    });
    const retired = await createTokenService({ secret: SECRET });
    await expect(retired.verifyAccess(token, 'support')).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('refuses short or low-entropy secrets at startup', async () => {
    await expect(createTokenService({ secret: 'too-short' })).rejects.toThrow(/at least 32/);
    await expect(createTokenService({ secret: 'a'.repeat(64) })).rejects.toThrow(/random/);
    await expect(createTokenService({ secret: SECRET, previousSecrets: ['xx'] })).rejects.toThrow(
      /CHAT_SECRET_PREVIOUS must be/,
    );
  });
});

describe('attachment handles', () => {
  const grant = { visitorId: VISITOR, fileId: 'file-Abc123', kind: 'pdf', tokens: 4500 } as const;

  it('round-trips the file and keeps its ID opaque', async () => {
    const tokens = await createTokenService({ secret: SECRET });
    const { token } = await tokens.issueAttachment('support', grant);
    expect(token).not.toContain('Abc123');
    await expect(tokens.verifyAttachment(token, 'support')).resolves.toEqual(grant);
  });

  it('rejects raw file IDs, other token types, other bots and expired handles', async () => {
    let clock = 1_000_000;
    const tokens = await createTokenService({ secret: SECRET, now: () => clock });
    const invalid = { code: 'invalid_input' };
    await expect(tokens.verifyAttachment('file-Abc123', 'support')).rejects.toMatchObject(invalid);
    const access = await tokens.issueAccess('support', VISITOR);
    await expect(tokens.verifyAttachment(access.token, 'support')).rejects.toMatchObject(invalid);
    const { token } = await tokens.issueAttachment('support', grant);
    await expect(tokens.verifyAttachment(token, 'sales')).rejects.toMatchObject(invalid);
    clock += 60 * 60 + 1;
    await expect(tokens.verifyAttachment(token, 'support')).rejects.toMatchObject(invalid);
  });
});

describe('newVisitorId', () => {
  it('produces unique, unguessable identifiers in the accepted format', () => {
    const ids = new Set(Array.from({ length: 100 }, newVisitorId));
    expect(ids.size).toBe(100);
    expect([...ids][0]).toMatch(/^v_[0-9a-f]{32}$/);
  });
});
