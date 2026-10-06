import type { Store } from './db.js';

export function deploymentTenant(): string {
  const tenant = process.env.EAOS_TENANT_ID ?? 'default';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(tenant)) throw new Error('EAOS_TENANT_ID must be a valid tenant identifier');
  return tenant;
}

export async function bindDeploymentTenant(store: Store, pool?: { query(sql: string, params?: unknown[]): Promise<any> }): Promise<string> {
  const tenantId = deploymentTenant();
  if (pool) {
    const setup = await pool.query("SELECT tenant_id FROM setup_state WHERE id='singleton'");
    if (setup.rows[0] && setup.rows[0].tenant_id !== tenantId) throw new Error('Configured tenant does not own this deployment');
    const existing = await pool.query("SELECT tenant_id FROM deployment_identity WHERE id='singleton'");
    if (!existing.rows.length) {
      const table = await pool.query("SELECT to_regclass('public.kv_store') AS name");
      if (table.rows[0]?.name && (await pool.query('SELECT 1 FROM kv_store LIMIT 1')).rows.length) throw new Error('Legacy unbound data requires an explicit tenant migration');
    }
    await pool.query("INSERT INTO deployment_identity (id, tenant_id) VALUES ('singleton',$1) ON CONFLICT (id) DO NOTHING", [tenantId]);
    const result = await pool.query("SELECT tenant_id FROM deployment_identity WHERE id='singleton'");
    if (result.rows[0]?.tenant_id !== tenantId) throw new Error('Configured tenant does not own this deployment');
  } else {
    const setup = store.get('setup_state', 'singleton');
    const binding = store.get('deployment_identity', 'singleton');
    if ((setup && setup.tenantId !== tenantId) || (binding && binding.tenantId !== tenantId)) throw new Error('Configured tenant does not own this deployment');
    const stats = (store as Store & { stats?: () => { totalRows: number } }).stats?.();
    if (!binding && stats && stats.totalRows > 0) throw new Error('Legacy unbound data requires an explicit tenant migration');
    if (!binding) store.insert('deployment_identity', 'singleton', { tenantId });
  }
  return tenantId;
}
