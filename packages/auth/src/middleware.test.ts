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
afterEach(() => { vi.unstubAllEnvs(); });
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
  it('keeps keys hashed under the JWT secret findable once API_KEY_HASH_SECRET is set', async () => {
    const legacy = auth.generateApiKey();
    vi.resetModules(); vi.stubEnv('API_KEY_HASH_SECRET', 'independent-key-hash-secret');
    const migrated = await import('./middleware.js');
    const candidates = migrated.hashApiKeyCandidates(legacy.rawKey);
    // Current hash first: new keys and lookups agree on it, and a key found under
    // a later candidate is the store's cue to move it there.
    expect(candidates[0]).toBe(migrated.hashApiKey(legacy.rawKey, 'independent-key-hash-secret'));
    expect(candidates[0]).toBe(migrated.hashApiKey(legacy.rawKey));
    expect(candidates).toContain(legacy.keyHash);
    expect(candidates).toContain(migrated.hashApiKey(legacy.rawKey, 'previous-fixture-key'));
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
  it('signs a local request in as the named local demo admin in local mode', async () => {
    vi.resetModules(); vi.stubEnv('EAOS_DEMO_MODE', 'local'); vi.stubEnv('EAOS_TENANT_ID', 'tenant-a');
    const local = await import('./middleware.js');
    const result = await local.authenticateRequest({}, { localDemo: { allowed: true } });
    expect(result.user).toMatchObject({ id: 'demo:local', role: 'admin', tenantId: 'tenant-a' });
    expect(local.isDemoPrincipal(result.user)).toBe(true);
    expect(local.isDemoVisitor(result.user)).toBe(false);
  });
  it('refuses the local demo admin unless the caller vouched for the request', async () => {
    vi.resetModules(); vi.stubEnv('EAOS_DEMO_MODE', 'local');
    const local = await import('./middleware.js');
    // No verdict is a refusal: the headers alone cannot show where a request came from.
    expect((await local.authenticateRequest({})).authenticated).toBe(false);
    const refused = await local.authenticateRequest({}, { localDemo: { allowed: false, reason: 'the client is not on this machine' } });
    expect(refused.authenticated).toBe(false);
    expect(refused.error).toContain('the client is not on this machine');
  });
  it('never signs in a local demo principal under production', async () => {
    vi.resetModules(); vi.stubEnv('EAOS_DEMO_MODE', 'local'); vi.stubEnv('NODE_ENV', 'production');
    const prod = await import('./middleware.js');
    expect((await prod.authenticateRequest({}, { localDemo: { allowed: true } })).authenticated).toBe(false);
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
    expect(auth.isDemoVisitor({ id: 'demo:abc' })).toBe(true);
    expect(auth.isDemoVisitor({ id: 'demo:local' })).toBe(false);
  });
  it.each([
    { mode: 'off', local: false, visitor: false },
    { mode: 'local', local: true, visitor: false },
    { mode: 'public', local: false, visitor: true },
  ])('permits demo identities only while their mode is on ($mode)', async ({ mode, local, visitor }) => {
    vi.resetModules(); vi.stubEnv('EAOS_DEMO_MODE', mode);
    const current = await import('./middleware.js');
    expect(current.demoPrincipalPermitted({ id: 'demo:local' })).toBe(local);
    expect(current.demoPrincipalPermitted({ id: 'demo:3f1c' })).toBe(visitor);
    expect(current.demoPrincipalPermitted({ id: 'user_admin' })).toBe(true);
    expect(current.demoPrincipalPermitted(undefined)).toBe(true);
  });
  it('rejects credentials minted for demo identities once demo mode is off', async () => {
    vi.resetModules(); vi.stubEnv('EAOS_DEMO_MODE', 'off');
    const off = await import('./middleware.js');
    const visitor = { ...user, id: 'demo:3f1c' };
    // An API key a visitor minted during the demo, and the bearer token of its session.
    off.setApiKeyResolver(async () => visitor);
    const byKey = await off.authenticateRequest({ 'x-api-key': `ak_${'a'.repeat(64)}` });
    expect(byKey).toEqual({ authenticated: false, error: off.DEMO_DISABLED_ERROR });
    off.setApiKeyResolver(async () => undefined);
    const byToken = await off.authenticateRequest({ authorization: `Bearer ${off.generateJWT(visitor)}` });
    expect(byToken).toEqual({ authenticated: false, error: off.DEMO_DISABLED_ERROR });
    // An ordinary principal on the same path is unaffected.
    expect((await off.authenticateRequest({ authorization: `Bearer ${off.generateJWT(user)}` })).authenticated).toBe(true);
  });
  it('accepts the same visitor credential while the public demo is on', async () => {
    vi.resetModules(); vi.stubEnv('EAOS_DEMO_MODE', 'public');
    const pub = await import('./middleware.js');
    const visitor = { ...user, id: 'demo:3f1c' };
    expect((await pub.authenticateRequest({ authorization: `Bearer ${pub.generateJWT(visitor)}` })).user).toMatchObject({ id: 'demo:3f1c' });
  });
});
