import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryStore } from '../../../packages/db/src/connection.js';
import { bindDeploymentTenant, deploymentTenant } from './deployment-tenant.js';

afterEach(() => { vi.unstubAllEnvs(); });
describe('single-tenant M0 deployment boundary', () => {
  it('binds an empty deployment and refuses reassignment', async () => {
    const store = new InMemoryStore();
    vi.stubEnv('EAOS_TENANT_ID', 'tenant-a');
    expect(await bindDeploymentTenant(store)).toBe('tenant-a');
    vi.stubEnv('EAOS_TENANT_ID', 'tenant-b');
    await expect(bindDeploymentTenant(store)).rejects.toThrow('does not own');
  });
  it('honors existing bootstrap ownership', async () => {
    const store = new InMemoryStore();
    store.insert('setup_state', 'singleton', { tenantId: 'original' });
    vi.stubEnv('EAOS_TENANT_ID', 'other');
    await expect(bindDeploymentTenant(store)).rejects.toThrow('does not own');
  });
  it('refuses implicit reassignment of legacy file data', async () => {
    const store = Object.assign(new InMemoryStore(), { stats: () => ({ totalRows: 1 }) });
    vi.stubEnv('EAOS_TENANT_ID', 'tenant-a');
    await expect(bindDeploymentTenant(store)).rejects.toThrow('explicit tenant migration');
  });
  it('rejects malformed identifiers', () => {
    vi.stubEnv('EAOS_TENANT_ID', '../other');
    expect(deploymentTenant).toThrow();
  });
});
