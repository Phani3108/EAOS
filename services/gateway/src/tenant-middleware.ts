/**
 * Tenant context middleware.
 * Sets the PostgreSQL session GUC `app.tenant_id` before each query so that
 * Row-Level Security policies (migration 005) enforce tenant isolation automatically.
 */

interface Pool {
  connect(): Promise<PoolClient>;
}
interface PoolClient {
  query(sql: string, params?: unknown[]): Promise<unknown>;
  release(): void;
}
interface AuthUser {
  tenantId?: string;
  [key: string]: unknown;
}

/**
 * Extract tenant ID from the authenticated user.
 * Uses the verified principal; caller-supplied headers cannot select a tenant.
 */
export function getTenantId(user: AuthUser, _headers?: Record<string, string | undefined>): string {
  if (!user.tenantId) throw new Error('Verified tenant is required');
  return user.tenantId;
}

/**
 * Set the tenant GUC on a client, scoped to the current transaction.
 *
 * This was `SET LOCAL app.tenant_id = $1`, which **Postgres does not accept**:
 * SET is a utility statement, not a plannable one, so it takes no bind
 * parameters and the server answers `syntax error at or near "$1"`. Every
 * caller therefore threw — which is why `POST /api/users/apikeys`, the only
 * route that mints a second credential, returned 500 rather than a key.
 *
 * `set_config(name, value, is_local)` is the function form and does take
 * parameters, so the tenant id stays bound rather than interpolated. That
 * matters beyond the syntax error: string-interpolating a tenant id into a SET
 * statement is a SQL injection into the row-security predicate itself.
 */
const SET_TENANT_SQL = `SELECT set_config('app.tenant_id', $1, true)`;

/**
 * Run a callback with the PostgreSQL session GUC set to the given tenant.
 *
 * Usage:
 *   await withTenantContext(pool, tenantId, async (client) => {
 *     await client.query('SELECT * FROM users');
 *   });
 */
export async function withTenantContext<T>(
  pool: Pool,
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // `is_local = true` ties the setting to this transaction, so it cannot leak
    // to the next caller that checks out this pooled connection.
    await client.query(SET_TENANT_SQL, [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Set tenant context on an already-checked-out client (no transaction management).
 * Call this when you manage the transaction lifecycle yourself.
 *
 * The `is_local = true` scoping means this only takes effect inside an open
 * transaction — call it after BEGIN, never on a bare connection.
 */
export async function setTenantContext(client: PoolClient, tenantId: string): Promise<void> {
  await client.query(SET_TENANT_SQL, [tenantId]);
}
