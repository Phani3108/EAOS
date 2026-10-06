import { describe, expect, it } from 'vitest';
import { VaultKV2 } from './vault-kv2.js';

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
});
