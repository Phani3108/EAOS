import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryStore } from '../../../packages/db/src/connection.js';
import type { AuthUser } from './auth.js';

let keys: typeof import('./api-key-store.js');
let auth: typeof import('./auth.js');
let store: InMemoryStore;
const owner: AuthUser = { id: 'user-a', tenantId: 'tenant-a', email: 'a@example.invalid', name: 'A', role: 'user', teams: [], personaScopes: ['engineering'] };

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('JWT_SECRET', 'fixture-only-api-key-signing-secret');
  keys = await import('./api-key-store.js');
  auth = await import('./auth.js');
  store = new InMemoryStore();
  keys.initApiKeyStore(store);
});

function createKey(expiresAt: string | null = null) {
  const generated = auth.generateApiKey();
  keys.persistApiKey({ ...generated, id: 'key-public-id', userId: owner.id, tenantId: owner.tenantId, email: owner.email, name: owner.name, role: owner.role, scopes: ['engineering'], label: 'fixture', expiresAt });
  return generated;
}

describe('API key storage lifecycle', () => {
  it('retains the public management ID separately from its secret hash', () => {
    const generated = createKey();
    expect(keys.getApiKeyForUser('key-public-id', owner)?.keyId).toBe('key-public-id');
    const listed = keys.listApiKeysForUser(owner);
    expect(listed[0]?.id).toBe('key-public-id');
    expect(JSON.stringify(listed)).not.toContain(generated.keyHash);
    expect(JSON.stringify(listed)).not.toContain(generated.rawKey);
  });

  it('revokes using the ID returned at creation', () => {
    const generated = createKey();
    expect(keys.lookupApiKey(generated.rawKey)?.id).toBe(owner.id);
    expect(keys.revokeApiKeyForUser('key-public-id', owner)).toBe(true);
    expect(keys.lookupApiKey(generated.rawKey)).toBeUndefined();
    expect(keys.revokeApiKeyForUser('key-public-id', owner)).toBe(false);
  });

  it('denies cross-user and cross-tenant management', () => {
    const generated = createKey();
    for (const foreign of [{ ...owner, id: 'other-user' }, { ...owner, tenantId: 'other-tenant' }]) {
      expect(keys.getApiKeyForUser('key-public-id', foreign)).toBeUndefined();
      expect(keys.revokeApiKeyForUser('key-public-id', foreign)).toBe(false);
      expect(keys.listApiKeysForUser(foreign)).toEqual([]);
    }
    expect(keys.lookupApiKey(generated.rawKey)).toBeDefined();
  });

  it.each(['invalid-date', '2000-01-01T00:00:00Z'])('rejects invalid or expired keys: %s', expiresAt => {
    const generated = createKey(expiresAt);
    expect(keys.lookupApiKey(generated.rawKey)).toBeUndefined();
  });

  it('provides a safe management ID for legacy records without publishing the hash', () => {
    const generated = createKey();
    const row = store.get(keys.API_KEY_TABLE, generated.keyHash)!;
    delete row.keyId;
    const listed = keys.listApiKeysForUser(owner);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).not.toBe(generated.keyHash);
    expect(keys.revokeApiKeyForUser(listed[0]!.id, owner)).toBe(true);
    expect(keys.lookupApiKey(generated.rawKey)).toBeUndefined();
  });
});
