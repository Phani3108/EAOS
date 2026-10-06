import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryStore } from '../../../packages/db/src/connection.js';
let runSetup: typeof import('./setup.js')['runSetup'];
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('JWT_SECRET', 'fixture-setup-signing-key');
  ({ runSetup } = await import('./setup.js'));
});
const request = { setupToken: 'fixture-token', email: 'a@example.invalid', tenantId: 'tenant-a' };
function fixture(fail = false) {
  const query = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (fail && sql.includes('INSERT INTO users')) throw new Error('fixture insert failed');
    return { rows: [], rowCount: 1 };
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  return { query, release, connect };
}
describe('transactional bootstrap', () => {
  it('commits the lock and principal together on a tenant-bound client', async () => {
    const pgPool = fixture();
    const result = await runSetup(request, { store: new InMemoryStore(), setupToken: 'fixture-token', pgPool });
    expect(result.ok).toBe(true);
    expect(pgPool.connect).toHaveBeenCalledOnce();
    expect(pgPool.query.mock.calls[0]?.[0]).toBe('BEGIN');
    expect(pgPool.query.mock.calls.some(([sql, params]) => sql.includes('set_config') && params?.[0] === 'tenant-a')).toBe(true);
    expect(pgPool.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(pgPool.release).toHaveBeenCalledOnce();
  });
  it('rolls back the setup lock if a later write fails', async () => {
    const pgPool = fixture(true);
    const result = await runSetup(request, { store: new InMemoryStore(), setupToken: 'fixture-token', pgPool });
    expect(result.ok).toBe(false);
    expect(pgPool.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(pgPool.release).toHaveBeenCalledOnce();
  });
});
