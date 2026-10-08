import { describe, expect, it } from 'vitest';
import { VaultKV2 } from './vault-kv2.js';
import { isOwnedSecretPath } from './namespace.js';

// Real principal shapes: oidc-provider.ts derives `oidc:<sha256(iss, sub)>`, and
// EAOS_DEMO_MODE=local acts as `demo:local`.
const SSO_USER = `oidc:${'3f2a'.repeat(16)}`;
const OTHER_SSO_USER = `oidc:${'9c1d'.repeat(16)}`;

describe('tenant-scoped Vault KV v2', () => {
  it('pins versions and resolves only the requested field', async () => {
    const requests: unknown[] = [];
    const vault = new VaultKV2({ tenantId: 'tenant', userId: 'owner', address: 'https://vault.example.invalid', token: async () => 'fixture-auth', request: async request => { requests.push(request); return { data: { data: { token: 'fixture-value' }, metadata: { version: 2, destroyed: false, deletion_time: '' } } }; } });
    const value = await vault.get({ provider: 'vault', path: 'tenant/owner/github', key: 'token', version: '2' });
    expect(value.value).toBe('fixture-value');
    expect(value.version).toBe('2');
    expect((requests[0] as { url: string }).url).toBe('https://vault.example.invalid/v1/secret/data/tenant/owner/github?version=2');
    expect(JSON.stringify(vault.auditLog())).not.toContain('fixture-value');
    expect(JSON.stringify(vault.auditLog())).not.toContain('fixture-auth');
  });
  it('rotates with CAS, preserves unrelated fields and verifies the new version', async () => {
    let version = 2;
    let fields = { token: 'fixture-old', retained: 'fixture-other' };
    const vault = new VaultKV2({ tenantId: 'tenant', userId: 'owner', address: 'https://vault.example.invalid', token: async () => 'fixture-auth', request: async request => {
      if (request.method === 'POST') {
        const body = request.body as { options: { cas: number }; data: typeof fields };
        expect(body.options.cas).toBe(version);
        expect(body.data.retained).toBe('fixture-other');
        version++; fields = body.data;
        return { data: { version } };
      }
      return { data: { data: fields, metadata: { version, destroyed: false, deletion_time: '' } } };
    } });
    await vault.rotate({ provider: 'vault', path: 'tenant/owner/github', version: '2' }, 'fixture-new');
    expect((await vault.get({ provider: 'vault', path: 'tenant/owner/github', version: '3' })).value).toBe('fixture-new');
    expect(JSON.stringify(vault.auditLog())).not.toContain('fixture-new');
  });
  it('denies cross-owner, traversal, provider confusion and deleted versions without leaking responses', async () => {
    let calls = 0;
    const vault = new VaultKV2({ tenantId: 'tenant', userId: 'owner', address: 'https://vault.example.invalid', token: async () => 'fixture-auth', request: async () => { calls++; return { data: { data: { token: 'fixture-value' }, metadata: { version: 3, destroyed: true } } }; } });
    for (const path of ['tenant/other/token', 'tenant/owner/../token', 'tenant/owner/%2e%2e/token', 'tenant/owner//token']) await expect(vault.get({ provider: 'vault', path })).rejects.toThrow();
    await expect(vault.get({ provider: 'env', path: 'tenant/owner/token' })).rejects.toThrow();
    expect(calls).toBe(0);
    await expect(vault.get({ provider: 'vault', path: 'tenant/owner/token' })).rejects.toThrow('Secret version is unavailable');
  });
  it.each([SSO_USER, 'demo:local'])('resolves the verbatim namespace of a %s owner, percent-encoding the colon', async userId => {
    const requests: Array<{ url: string }> = [];
    const vault = new VaultKV2({ tenantId: 'default', userId, address: 'https://vault.example.invalid', token: async () => 'fixture-auth', request: async request => { requests.push(request); return { data: { data: { token: 'fixture-value' }, metadata: { version: 1, destroyed: false, deletion_time: '' } } }; } });
    expect((await vault.get({ provider: 'vault', path: `default/${userId}/github` })).value).toBe('fixture-value');
    expect(requests[0]!.url).toBe(`https://vault.example.invalid/v1/secret/data/default/${userId.replace(':', '%3A')}/github`);
  });
  it('keeps colon-bearing owners isolated from each other and from look-alike namespaces', async () => {
    let calls = 0;
    const vault = new VaultKV2({ tenantId: 'default', userId: SSO_USER, address: 'https://vault.example.invalid', token: async () => 'fixture-auth', request: async () => { calls++; return {}; } });
    for (const path of [`default/${OTHER_SSO_USER}/github`, `default/oidc/${SSO_USER.slice(5)}/github`, `default/${SSO_USER}:x/github`, `default/${SSO_USER}`, `default/${SSO_USER}/`, `default/${SSO_USER}/../${OTHER_SSO_USER}/github`, `default/${SSO_USER}/a:b`, `other/${SSO_USER}/github`]) {
      await expect(vault.get({ provider: 'vault', path })).rejects.toThrow('outside the authorized scope');
    }
    expect(calls).toBe(0);
  });
  it('gives no namespace to an owner id that is not exactly one safe path segment', () => {
    for (const userId of ['a/b', '..', '.', ':x', 'a..b', '', 'a\nb', 'x'.repeat(201)]) {
      expect(() => new VaultKV2({ tenantId: 'default', userId, address: 'https://vault.example.invalid', token: async () => '', request: async () => ({}) })).toThrow('Invalid Vault scope');
      expect(isOwnedSecretPath(`default/${userId}/github`, { tenantId: 'default', userId })).toBe(false);
    }
    // A slash in an id would otherwise let owner `a` claim owner `a/b`'s secrets by prefix.
    expect(isOwnedSecretPath('default/a/b/github', { tenantId: 'default', userId: 'a' })).toBe(true);
    expect(isOwnedSecretPath('default/a/b/github', { tenantId: 'default', userId: 'a/b' })).toBe(false);
  });
});
