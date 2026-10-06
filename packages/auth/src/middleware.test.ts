import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from './middleware.js';

const user: AuthUser = { id: 'a', tenantId: 'tenant-a', email: '', name: '', role: 'user', teams: [], personaScopes: ['engineering'] };
let auth: typeof import('./middleware.js');
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('JWT_SECRET', 'current-fixture-key,previous-fixture-key');
  vi.stubEnv('REQUIRE_SIGNED_TOKENS', 'true');
  vi.stubEnv('ALLOW_DEV_API_KEYS', 'false');
  auth = await import('./middleware.js');
});
function signed(payload: Record<string, unknown>) {
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${enc({ alg: 'HS256' })}.${enc({ iss: 'eaos', aud: 'eaos-api', ...payload })}`;
  return `${input}.${createHmac('sha256', 'previous-fixture-key').update(input).digest('base64url')}`;
}
describe('JWT rotation and claims', () => {
  it('verifies tokens signed during rotation', async () => {
    expect((await auth.authenticateRequest({ authorization: `Bearer ${auth.generateJWT(user)}` })).authenticated).toBe(true);
  });
  it.each([
    { sub: 'a', tenantId: 'tenant-a' },
    { sub: 'a', tenantId: 'tenant-a', exp: 'not-a-number' },
    { sub: 'a', tenantId: 'tenant-a', exp: Math.floor(Date.now() / 1000) },
    { sub: 'a', tenantId: 'tenant-a', exp: 9999999999, role: 'superuser' },
    { tenantId: 'tenant-a', exp: 9999999999 },
    { sub: 'a', exp: 9999999999 },
  ])('rejects invalid claims %j', async claims => {
    expect((await auth.authenticateRequest({ authorization: `Bearer ${signed(claims)}` })).authenticated).toBe(false);
  });
  it('accepts the previous JWT signing key with valid claims', async () => {
    const token = signed({ sub: 'a', tenantId: 'tenant-a', role: 'user', exp: Math.floor(Date.now() / 1000) + 60 });
    expect((await auth.authenticateRequest({ authorization: `Bearer ${token}` })).authenticated).toBe(true);
  });
  it('retains API-key lookup candidates while rotating signing keys', () => {
    const previous = auth.generateApiKey('previous-fixture-key');
    expect(auth.hashApiKeyCandidates(previous.rawKey)).toContain(previous.keyHash);
    const current = auth.generateApiKey();
    expect(current.keyHash).toBe(auth.hashApiKey(current.rawKey, 'current-fixture-key'));
  });
  it('rejects invalid token lifetimes', () => {
    for (const ttl of [0, -1, Infinity, 86401]) expect(() => auth.generateJWT(user, ttl)).toThrow();
  });
});

describe('demo principals', () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  it('stays unauthenticated when demo mode is off', async () => {
    expect((await auth.authenticateRequest({})).authenticated).toBe(false);
  });
  it('signs unauthenticated requests in as the named local demo admin in local mode', async () => {
    vi.resetModules(); vi.stubEnv('EAOS_DEMO_MODE', 'local'); vi.stubEnv('EAOS_TENANT_ID', 'tenant-a');
    const local = await import('./middleware.js');
    const result = await local.authenticateRequest({});
    expect(result.user).toMatchObject({ id: 'demo:local', role: 'admin', tenantId: 'tenant-a' });
    expect(local.isDemoPrincipal(result.user)).toBe(true);
  });
  it('never signs in a local demo principal under production', async () => {
    vi.resetModules(); vi.stubEnv('EAOS_DEMO_MODE', 'local'); vi.stubEnv('NODE_ENV', 'production');
    const prod = await import('./middleware.js');
    expect((await prod.authenticateRequest({})).authenticated).toBe(false);
  });
  it('grants public demo visitors nothing without a minted session', async () => {
    vi.resetModules(); vi.stubEnv('EAOS_DEMO_MODE', 'public');
    const pub = await import('./middleware.js');
    expect((await pub.authenticateRequest({})).authenticated).toBe(false);
  });
  it('recognises only demo:-prefixed ids as demo principals', () => {
    expect(auth.isDemoPrincipal({ id: 'demo:abc' })).toBe(true);
    expect(auth.isDemoPrincipal({ id: 'anonymous' })).toBe(false);
    expect(auth.isDemoPrincipal(undefined)).toBe(false);
  });
});
