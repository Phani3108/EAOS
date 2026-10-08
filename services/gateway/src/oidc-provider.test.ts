import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let oidc: typeof import('./oidc-provider.js');
const issuer = 'https://identity.example.invalid';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
function token(claims: Record<string, unknown>, kid = 'fixture', key: KeyObject = privateKey) {
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${enc({ alg: 'RS256', kid })}.${enc(claims)}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
}

/** The identity provider: discovery, a JWKS that tests can change or stall, and a token endpoint. */
let jwks: () => Promise<Response>;
let tokenEndpoint: () => Promise<Response>;
let jwksFetches = 0;
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('OIDC_ISSUER_URL', issuer);
  vi.stubEnv('OIDC_CLIENT_ID', 'fixture-client');
  vi.stubEnv('OIDC_CLIENT_SECRET', 'fixture-secret');
  vi.stubEnv('OIDC_REDIRECT_URI', 'https://app.example.invalid/api/auth/oidc/callback');
  vi.stubEnv('OIDC_DEFAULT_TENANT', 'tenant-a');
  jwksFetches = 0;
  jwks = () => json({ keys: [{ ...jwk, kid: 'fixture' }] });
  tokenEndpoint = () => json({ error: 'not configured' }, 400);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('well-known')) return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/keys` });
    if (url.endsWith('/keys')) { jwksFetches++; return jwks(); }
    return tokenEndpoint();
  }));
  oidc = await import('./oidc-provider.js');
});
afterEach(() => { vi.useRealTimers(); });

const valid = () => ({ sub: 'subject', iss: issuer, aud: 'fixture-client', exp: Math.floor(Date.now() / 1000) + 60, nonce: 'expected' });

describe('strict OIDC verification', () => {
  it('always verifies signatures, issuer, audience, expiry and nonce', async () => {
    await oidc.prewarmJWKS();
    expect(oidc.verifyIdToken(token(valid()), 'expected').sub).toBe('subject');
    for (const patch of [{ iss: 'https://other.invalid' }, { nonce: undefined }, { exp: undefined }, { aud: 'other-client' }]) {
      expect(() => oidc.verifyIdToken(token({ ...valid(), ...patch }), 'expected')).toThrow();
    }
    expect(() => oidc.verifyIdToken(token(valid()).slice(0, -8) + 'invalid', 'expected')).toThrow();
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

describe('the shared key cache', () => {
  it('stays usable while another login refreshes it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await oidc.prewarmJWKS();
    vi.setSystemTime(Date.now() + 11 * 60_000); // stale: the next load refetches
    let release!: () => void;
    jwks = () => new Promise(resolve => { release = () => resolve(new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'fixture' }] }))); });
    const refreshing = oidc.prewarmJWKS();
    await vi.waitFor(() => expect(jwksFetches).toBe(2));
    // Every exchange used to empty the cache before refetching, so a login verifying
    // in this window failed with 'OIDC JWKS unavailable'.
    expect(oidc.verifyIdToken(token(valid()), 'expected').sub).toBe('subject');
    release();
    await refreshing;
  });

  it('keeps the previous keys when a refresh fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await oidc.prewarmJWKS();
    vi.setSystemTime(Date.now() + 31_000);
    jwks = () => json({}, 503);
    await expect(oidc.loadJWKS('rotated')).rejects.toThrow('Unable to load OIDC JWKS');
    // One failed refetch used to leave no keys for any login.
    expect(oidc.verifyIdToken(token(valid()), 'expected').sub).toBe('subject');
    expect(await oidc.loadJWKS('fixture')).toHaveLength(1);
  });

  it('shares one fetch between concurrent logins and serves fresh keys from cache', async () => {
    await Promise.all([oidc.loadJWKS(), oidc.loadJWKS(), oidc.loadJWKS('fixture')]);
    expect(jwksFetches).toBe(1);
    await oidc.loadJWKS('fixture');
    expect(jwksFetches).toBe(1);
  });

  it('refetches for a rotated signing key, but not on every login with an unknown kid', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await oidc.loadJWKS();
    await oidc.loadJWKS('unknown');
    expect(jwksFetches).toBe(1); // inside the cooldown
    vi.setSystemTime(Date.now() + 31_000);
    const { privateKey: rotatedKey, publicKey: rotatedPublic } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    jwks = () => json({ keys: [{ ...rotatedPublic.export({ format: 'jwk' }), kid: 'rotated' }] });
    const keys = await oidc.loadJWKS('rotated');
    expect(jwksFetches).toBe(2);
    expect(oidc.verifyIdToken(token(valid(), 'rotated', rotatedKey), 'expected', keys).sub).toBe('subject');
  });

  it('completes a login with keys loaded for its own token', async () => {
    const authorization = await oidc.buildAuthorizationUrl('browser');
    const nonce = new URL(authorization.url).searchParams.get('nonce')!;
    tokenEndpoint = () => json({ id_token: token({ ...valid(), nonce }), access_token: 'fixture', token_type: 'Bearer' });
    expect((await oidc.completeAuthorization('code', authorization.state, 'browser')).sub).toBe('subject');
  });
});
