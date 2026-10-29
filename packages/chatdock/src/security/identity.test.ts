import { SignJWT, UnsecuredJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createIdentityVerifier, identityKey } from './identity';

const SECRET = 'aWRlbnRpdHktdGVzdHMtc2VjcmV0LTEyMzQ1Njc4OTA';
const NOW = 1_800_000_000;
const verifier = createIdentityVerifier({ secret: SECRET, now: () => NOW });

/** What a site's backend does: HS256 with IDENTITY_SECRET, the bot as audience. */
function sign(
  claims: Record<string, unknown> = {},
  options: { secret?: string; audience?: string; issuedAt?: number; expires?: number } = {},
) {
  return new SignJWT({ name: 'Ada Lovelace', ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('user-42')
    .setAudience(options.audience ?? 'support')
    .setIssuedAt(options.issuedAt ?? NOW)
    .setExpirationTime(options.expires ?? NOW + 3600)
    .sign(new TextEncoder().encode(options.secret ?? SECRET));
}

describe('identity tokens', () => {
  it('turns a valid token into the identity tools see, with flat extra claims', async () => {
    const token = await sign({ email: 'ada@example.com', plan: 'pro', seats: 3, team: { id: 1 } });
    await expect(verifier.verify(token, 'support')).resolves.toEqual({
      ok: true,
      verified: {
        identity: {
          id: 'user-42',
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          claims: { plan: 'pro', seats: 3 },
        },
        expiresAt: NOW + 3600,
      },
    });
  });

  it('refuses forged, foreign, expired and overlong tokens', async () => {
    const cases = [
      [await sign({}, { secret: 'b3RoZXItc2l0ZS1zZWNyZXQtMTIzNDU2Nzg5MGFiY2Q' }), 'signature'],
      [await sign({}, { audience: 'sales' }), 'audience'],
      [await sign({}, { issuedAt: NOW - 7200, expires: NOW - 3600 }), 'expired'],
      [await sign({}, { expires: NOW + 25 * 3600 }), 'lifetime'],
      [await sign({ name: 'x'.repeat(201) }), 'claims'],
      [await sign({ notes: 'x'.repeat(3000) }), 'too_large'],
      [new UnsecuredJWT({ sub: 'user-42', aud: 'support' }).encode(), 'malformed'],
      ['not.a.token', 'malformed'],
    ] as const;
    for (const [token, reason] of cases) {
      await expect(verifier.verify(token, 'support')).resolves.toEqual({ ok: false, reason });
    }
  });

  it('requires a strong IDENTITY_SECRET that differs from CHAT_SECRET', () => {
    expect(() => createIdentityVerifier({ secret: 'short' })).toThrow(/at least 32/);
    expect(() => createIdentityVerifier({ secret: SECRET, chatSecret: SECRET })).toThrow(
      /differ from CHAT_SECRET/,
    );
  });

  it('keys conversations by bot and user without revealing the user', async () => {
    const identity = { id: 'user-42', claims: {} };
    const key = await identityKey('support', identity);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain('42');
    expect(await identityKey('sales', identity)).not.toBe(key);
  });
});
