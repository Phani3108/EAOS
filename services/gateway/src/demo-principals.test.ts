import { describe, expect, it, vi } from 'vitest';
import { localDemoProvisioner } from './demo-principals.js';
import type { AuthUser } from './auth.js';

const local: AuthUser = { id: 'demo:local', email: 'demo@localhost', name: 'Local demo', role: 'admin', teams: [], personaScopes: ['*'], tenantId: 'acme' };

/** A pool whose tenants table holds `tenants`, and that records inserted users. */
function fixturePool(tenants: Set<string>) {
  const users: unknown[][] = [];
  const pool = {
    connect: async () => ({
      query: async (sql: string, params?: unknown[]) => {
        if (sql.startsWith('SELECT id FROM tenants')) return { rows: tenants.has(params![0] as string) ? [{ id: params![0] }] : [] };
        if (sql.startsWith('INSERT INTO users')) users.push(params!);
        return { rows: [] };
      },
      release: () => {},
    }),
  };
  return { pool, users };
}

describe('local demo provisioning', () => {
  it('reports a missing tenant loudly, keeps retrying, and recovers once setup has created it', async () => {
    const tenants = new Set<string>();
    const { pool, users } = fixturePool(tenants);
    const log = { log: vi.fn(), error: vi.fn() };
    const ensure = localDemoProvisioner(pool, local, log);

    const problem = await ensure();
    expect(problem).toContain('Tenant "acme" does not exist yet');
    expect(problem).toContain('POST /api/setup');
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0]![0]).toContain('LOCAL DEMO UNAVAILABLE');

    // The same cause is not logged again on every request.
    expect(await ensure()).toBe(problem);
    expect(log.error).toHaveBeenCalledTimes(1);

    tenants.add('acme'); // POST /api/setup ran
    expect(await ensure()).toBeUndefined();
    expect(users).toHaveLength(1);
    expect(log.log).toHaveBeenCalledTimes(1);

    // Ready is sticky: no further queries.
    expect(await ensure()).toBeUndefined();
    expect(users).toHaveLength(1);
  });

  it('does not echo an unexpected storage error to the caller', async () => {
    const log = { log: vi.fn(), error: vi.fn() };
    const failing = { connect: async () => { throw new Error('password authentication failed for user "eaos"'); } };
    const problem = await localDemoProvisioner(failing, local, log)();
    expect(problem).not.toContain('password');
    expect(log.error.mock.calls[0]![0]).toContain('password authentication failed');
  });

  it('needs nothing on the file store', async () => {
    expect(await localDemoProvisioner(undefined, local)()).toBeUndefined();
  });
});
