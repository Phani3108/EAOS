import type { RuntimeClient, RuntimePool } from './run-repository.js';

export async function tenantTransaction<T>(pool: RuntimePool, tenantId: string, operation: (client: RuntimeClient) => Promise<T>): Promise<T> {
  if (!tenantId || tenantId.length > 128) throw new Error('Verified tenant is required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally { client.release(); }
}
