import { describe, expect, it } from 'vitest';
import { createTokenService, newVisitorId } from './tokens';

const SECRET = 'a'.repeat(32) + '-current-secret';
const OLD_SECRET = 'b'.repeat(32) + '-previous-secret';

describe('token service', () => {
  it('round-trips an access token for the same bot', async () => {
    const tokens = await createTokenService({ secret: SECRET });
    const { token, expiresAt } = await tokens.issueAccess('support', 'v_1');
    await expect(tokens.verifyAccess(token, 'support')).resolves.toEqual({ visitorId: 'v_1' });
    expect(expiresAt).toBeGreaterThan(Date.now() / 1000);
  });

  it('round-trips a resume token and keeps the conversation ID opaque', async () => {
    const tokens = await createTokenService({ secret: SECRET });
    const { token } = await tokens.issueResume('support', {
      visitorId: 'v_1',
      conversationId: 'conv_secret123',
    });
    expect(token).not.toContain('conv_secret123');
    const [, payload = ''] = token.split('.');
    expect(Buffer.from(payload, 'base64url').toString('latin1')).not.toContain('conv_');
    await expect(tokens.verifyResume(token, 'support')).resolves.toEqual({
      visitorId: 'v_1',
      conversationId: 'conv_secret123',
    });
  });

  it('rejects a token issued for another bot', async () => {
    const tokens = await createTokenService({ secret: SECRET });
    const { token } = await tokens.issueAccess('support', 'v_1');
    await expect(tokens.verifyAccess(token, 'sales')).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('does not accept one token type as the other', async () => {
    const tokens = await createTokenService({ secret: SECRET });
    const access = await tokens.issueAccess('support', 'v_1');
    const resume = await tokens.issueResume('support', { visitorId: 'v_1', conversationId: 'c' });
    await expect(tokens.verifyResume(access.token, 'support')).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(tokens.verifyAccess(resume.token, 'support')).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('rejects tampered and foreign tokens', async () => {
    const tokens = await createTokenService({ secret: SECRET });
    const foreign = await createTokenService({ secret: 'c'.repeat(40) });
    const { token } = await tokens.issueAccess('support', 'v_1');
    const tampered = `${token.slice(0, -2)}${token.endsWith('A') ? 'B' : 'A'}${token.slice(-1)}`;
    await expect(tokens.verifyAccess(tampered, 'support')).rejects.toMatchObject({
      code: 'unauthorized',
    });
    const other = await foreign.issueAccess('support', 'v_1');
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
    const { token } = await tokens.issueAccess('support', 'v_1');
    clock += 15 * 60 + 1;
    await expect(tokens.verifyAccess(token, 'support')).rejects.toMatchObject({
      code: 'session_expired',
    });
  });

  it('accepts tokens signed with a previous secret during rotation', async () => {
    const old = await createTokenService({ secret: OLD_SECRET });
    const { token } = await old.issueAccess('support', 'v_1');
    const rotated = await createTokenService({ secret: SECRET, previousSecrets: [OLD_SECRET] });
    await expect(rotated.verifyAccess(token, 'support')).resolves.toEqual({ visitorId: 'v_1' });
    const retired = await createTokenService({ secret: SECRET });
    await expect(retired.verifyAccess(token, 'support')).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('refuses short secrets at startup', async () => {
    await expect(createTokenService({ secret: 'too-short' })).rejects.toThrow(/at least 32/);
  });
});

describe('newVisitorId', () => {
  it('produces unique, unguessable identifiers', () => {
    const ids = new Set(Array.from({ length: 100 }, newVisitorId));
    expect(ids.size).toBe(100);
    expect([...ids][0]).toMatch(/^v_[0-9a-f]{32}$/);
  });
});
