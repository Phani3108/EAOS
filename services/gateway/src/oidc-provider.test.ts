import { generateKeyPairSync, sign } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
let oidc: typeof import('./oidc-provider.js');
const issuer = 'https://identity.example.invalid';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
function token(claims: Record<string, unknown>) {
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${enc({ alg: 'RS256', kid: 'fixture' })}.${enc(claims)}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('OIDC_ISSUER_URL', issuer);
  vi.stubEnv('OIDC_CLIENT_ID', 'fixture-client');
  vi.stubEnv('OIDC_CLIENT_SECRET', 'fixture-secret');
  vi.stubEnv('OIDC_REDIRECT_URI', 'https://app.example.invalid/api/auth/oidc/callback');
  vi.stubEnv('OIDC_DEFAULT_TENANT', 'tenant-a');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('well-known') ? { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/keys` } : { keys: [{ ...jwk, kid: 'fixture' }] }))));
  oidc = await import('./oidc-provider.js');
});
describe('strict OIDC verification', () => {
  it('always verifies signatures, issuer, audience, expiry and nonce', async () => {
    await oidc.prewarmJWKS();
    const valid = { sub: 'subject', iss: issuer, aud: 'fixture-client', exp: Math.floor(Date.now() / 1000) + 60, nonce: 'expected' };
    expect(oidc.verifyIdToken(token(valid), 'expected').sub).toBe('subject');
    for (const patch of [{ iss: 'https://other.invalid' }, { nonce: undefined }, { exp: undefined }, { aud: 'other-client' }]) {
      expect(() => oidc.verifyIdToken(token({ ...valid, ...patch }), 'expected')).toThrow();
    }
    expect(() => oidc.verifyIdToken(token(valid).slice(0, -8) + 'invalid', 'expected')).toThrow();
  });
  it('issues PKCE challenges and rejects unknown or wrong-browser state before exchange', async () => {
    const authorization = await oidc.buildAuthorizationUrl('browser');
    const url = new URL(authorization.url);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    await expect(oidc.completeAuthorization('code', 'unknown', 'browser')).rejects.toThrow();
    await expect(oidc.completeAuthorization('code', authorization.state, 'other-browser')).rejects.toThrow();
  });
});
