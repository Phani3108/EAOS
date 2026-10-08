import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryStore } from '../../../packages/db/src/connection.js';
import type { AuthUser } from './auth.js';

let lifecycle: typeof import('./api-key-lifecycle.js');
let keys: typeof import('./api-key-store.js');
let auth: typeof import('./auth.js');
const owner: AuthUser = { id: 'user-a', tenantId: 'tenant-a', email: 'a@example.invalid', name: 'A', role: 'user', teams: [], personaScopes: ['engineering'] };

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('JWT_SECRET', 'fixture-only-api-key-signing-secret');
  lifecycle = await import('./api-key-lifecycle.js');
  keys = await import('./api-key-store.js');
  auth = await import('./auth.js');
  keys.initApiKeyStore(new InMemoryStore());
});

function seed() {
  const generated = auth.generateApiKey();
  keys.persistApiKey({ ...generated, id: 'old-key', userId: owner.id, tenantId: owner.tenantId, email: owner.email, name: owner.name, role: owner.role, scopes: ['engineering'], label: 'fixture', expiresAt: '2099-01-01T00:00:00Z' });
  return generated;
}

function fakePool(failInsert = false, exists = true) {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.includes('SELECT name, scopes, expires_at')) return { rows: exists ? [{ name: 'fixture', scopes: ['engineering'], expires_at: '2099-01-01T00:00:00Z' }] : [] };
    if (sql.startsWith('INSERT') && failInsert) throw new Error('write failed');
    return { rows: sql.startsWith('DELETE') && exists ? [{ id: 'old-key' }] : [] };
  });
  const release = vi.fn();
  return { pool: { connect: vi.fn(async () => ({ query, release })) }, query, release };
}

describe('API key scope attenuation', () => {
  it('inherits the issuer scopes rather than defaulting to wildcard', () => {
    expect(lifecycle.resolveApiKeyScopes(owner)).toEqual(['engineering']);
  });

  it.each([{ requested: ['*'] }, { requested: ['hr'] }, { requested: [] }])('rejects invalid or amplified scopes $requested', ({ requested }) => {
    expect(() => lifecycle.resolveApiKeyScopes(owner, requested)).toThrow();
  });

  it('allows an unrestricted issuer to create a restricted key', () => {
    expect(lifecycle.resolveApiKeyScopes({ ...owner, personaScopes: ['*'] }, ['engineering'])).toEqual(['engineering']);
  });
});

describe('API key lifecycle', () => {
  it('rotates a stored key and preserves its restrictions', async () => {
    const old = seed();
    const replacement = await lifecycle.rotateApiKey('old-key', owner);
    expect(replacement).toBeDefined();
    expect(keys.lookupApiKey(old.rawKey)).toBeUndefined();
    expect(keys.lookupApiKey(replacement!.rawKey)?.personaScopes).toEqual(['engineering']);
    expect(keys.getApiKeyForUser(replacement!.id, owner)).toMatchObject({ label: 'fixture', expiresAt: '2099-01-01T00:00:00Z' });
  });

  it('does not create a replacement for a missing or foreign key', async () => {
    const old = seed();
    expect(await lifecycle.rotateApiKey('missing', owner)).toBeUndefined();
    expect(await lifecycle.rotateApiKey('old-key', { ...owner, tenantId: 'tenant-b' })).toBeUndefined();
    expect(keys.lookupApiKey(old.rawKey)).toBeDefined();
  });

  it('revokes the file-backed key through the same service', async () => {
    const old = seed();
    expect(await lifecycle.revokeApiKey('old-key', owner)).toBe(true);
    expect(keys.lookupApiKey(old.rawKey)).toBeUndefined();
  });

  it('rotates PostgreSQL keys with tenant context and a transaction', async () => {
    const { pool, query, release } = fakePool();
    const result = await lifecycle.rotateApiKey('old-key', owner, pool);
    expect(result?.scopes).toEqual(['engineering']);
    expect(query.mock.calls[0]?.[0]).toBe('BEGIN');
    expect(query.mock.calls.some(([sql, params]) => sql.includes('set_config') && params?.[0] === owner.tenantId)).toBe(true);
    const lookup = query.mock.calls.find(([sql]) => sql.includes('FOR UPDATE'));
    expect(lookup?.[1]).toEqual(['old-key', owner.id, owner.tenantId]);
    const insert = query.mock.calls.find(([sql]) => sql.startsWith('INSERT'));
    expect(insert?.[0]).toContain('name, scopes');
    expect(insert?.[0]).not.toContain('label');
    expect(insert?.[1]).toContainEqual(['engineering']);
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back a failed PostgreSQL rotation before releasing the client', async () => {
    const { pool, query, release } = fakePool(true);
    await expect(lifecycle.rotateApiKey('old-key', owner, pool)).rejects.toThrow('write failed');
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(false);
    expect(release).toHaveBeenCalledOnce();
  });

  it('does not report a nonexistent PostgreSQL key revoked', async () => {
    const { pool } = fakePool(false, false);
    expect(await lifecycle.revokeApiKey('missing', owner, pool)).toBe(false);
  });
});

describe('credentials minted from an expiring key', () => {
  const inAnHour = Date.now() + 3600_000;
  const shortLived = { ...owner, authorityExpiresAt: inAnHour };

  it('caps what a bounded principal asks for, and leaves everyone else alone', () => {
    expect(lifecycle.boundedKeyExpiry(null, shortLived)).toBe(new Date(inAnHour).toISOString());
    expect(lifecycle.boundedKeyExpiry('2099-01-01T00:00:00Z', shortLived)).toBe(new Date(inAnHour).toISOString());
    const sooner = new Date(Date.now() + 60_000).toISOString();
    expect(lifecycle.boundedKeyExpiry(sooner, shortLived)).toBe(sooner);
    expect(lifecycle.boundedKeyExpiry(null, owner)).toBeNull();
    expect(lifecycle.boundedKeyExpiry('2099-01-01T00:00:00Z', owner)).toBe('2099-01-01T00:00:00Z');
  });

  it('cannot rotate a longer-lived sibling key into a fresh one that outlives it', async () => {
    seed();
    const replacement = await lifecycle.rotateApiKey('old-key', shortLived);
    expect(replacement?.expiresAt).toBe(new Date(inAnHour).toISOString());
    expect(keys.lookupApiKey(replacement!.rawKey)?.authorityExpiresAt).toBe(inAnHour);
  });

  it('caps a PostgreSQL rotation the same way', async () => {
    const { pool, query } = fakePool();
    const replacement = await lifecycle.rotateApiKey('old-key', shortLived, pool);
    expect(replacement?.expiresAt).toBe(new Date(inAnHour).toISOString());
    expect(query.mock.calls.find(([sql]) => sql.startsWith('INSERT'))?.[1]).toContain(new Date(inAnHour).toISOString());
  });
});

describe('PostgreSQL key resolution', () => {
  const principal = { user_id: owner.id, email: owner.email, name: owner.name, role: 'user', scopes: ['engineering'], tenant_id: owner.tenantId };

  /** authenticate_api_key answers for `storedHash`; api_keys holds it with `expiresAt`. */
  function lookupPool(storedHash: string, expiresAt: string | null, options: { revoked?: boolean; failUpdate?: boolean } = {}) {
    let hash = storedHash;
    const direct = vi.fn(async (sql: string, params?: unknown[]) => ({ rows: sql.includes('authenticate_api_key') && params?.[0] === hash ? [principal] : [] }));
    const scoped = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith('SELECT expires_at')) return { rows: !options.revoked && params?.[0] === hash ? [{ expires_at: expiresAt }] : [] };
      if (sql.startsWith('UPDATE api_keys SET key_hash')) {
        if (options.failUpdate) throw new Error('permission denied for table api_keys');
        if (params?.[1] === hash) hash = params[0] as string;
      }
      return { rows: [] };
    });
    return { pool: { query: direct, connect: vi.fn(async () => ({ query: scoped, release: vi.fn() })) }, direct, scoped, stored: () => hash };
  }
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));

  it('carries the key expiry, read under the tenant context', async () => {
    const generated = auth.generateApiKey();
    const { pool, scoped } = lookupPool(generated.keyHash, '2099-01-01T00:00:00Z');
    const user = await lifecycle.resolvePostgresApiKey(pool, generated.rawKey);
    expect(user).toMatchObject({ id: owner.id, tenantId: owner.tenantId, authorityExpiresAt: Date.parse('2099-01-01T00:00:00Z') });
    expect(scoped.mock.calls.some(([sql, params]) => sql.includes('set_config') && params?.[0] === owner.tenantId)).toBe(true);
    expect(scoped.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
  });

  it('denies a key revoked between the lookup and the expiry read', async () => {
    const generated = auth.generateApiKey();
    expect(await lifecycle.resolvePostgresApiKey(lookupPool(generated.keyHash, null, { revoked: true }).pool, generated.rawKey)).toBeUndefined();
  });

  it('resolves a key hashed before API_KEY_HASH_SECRET was set, then moves it onto the current hash', async () => {
    const legacy = auth.generateApiKey();
    vi.resetModules();
    vi.stubEnv('API_KEY_HASH_SECRET', 'fixture-independent-key-hash-secret');
    lifecycle = await import('./api-key-lifecycle.js');
    auth = await import('./auth.js');
    const { pool, direct, stored } = lookupPool(legacy.keyHash, null);
    expect(await lifecycle.resolvePostgresApiKey(pool, legacy.rawKey)).toMatchObject({ id: owner.id, authorityExpiresAt: undefined });
    await settle();
    expect(stored()).toBe(auth.hashApiKey(legacy.rawKey));
    expect(direct.mock.calls.find(([sql]) => sql.includes('touch_api_key'))?.[1]).toEqual([stored()]);
    // Next use finds it under the current hash first.
    expect(await lifecycle.resolvePostgresApiKey(pool, legacy.rawKey)).toMatchObject({ id: owner.id });
    vi.unstubAllEnvs();
  });

  it('keeps a legacy key working when the move is not permitted', async () => {
    const legacy = auth.generateApiKey();
    vi.resetModules();
    vi.stubEnv('API_KEY_HASH_SECRET', 'fixture-independent-key-hash-secret');
    lifecycle = await import('./api-key-lifecycle.js');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { pool, stored } = lookupPool(legacy.keyHash, null, { failUpdate: true });
    expect(await lifecycle.resolvePostgresApiKey(pool, legacy.rawKey)).toMatchObject({ id: owner.id });
    expect(await lifecycle.resolvePostgresApiKey(pool, legacy.rawKey)).toMatchObject({ id: owner.id });
    await settle();
    expect(stored()).toBe(legacy.keyHash);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    vi.unstubAllEnvs();
  });
});
