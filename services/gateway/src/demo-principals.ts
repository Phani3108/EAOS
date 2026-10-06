/**
 * Demo principals must exist as users on PostgreSQL: the durable runtime and the
 * workspace tables reference users(tenant_id, id), so a run started by an
 * unprovisioned demo principal fails its foreign key.
 *
 * Provisioning is idempotent, and it never creates the tenant. A demo must not
 * claim a deployment — the tenant comes from migration 007 (`default`) or from
 * first-run setup — so a missing tenant is reported, not papered over.
 */
import { isDemoPrincipal, type AuthUser } from './auth.js';
import { withTenantContext } from './tenant-middleware.js';

type Pool = Parameters<typeof withTenantContext>[0];

export class DemoTenantMissingError extends Error {
  constructor(tenantId: string) {
    super(`Tenant "${tenantId}" does not exist yet — run first-time setup (POST /api/setup) before enabling the demo`);
    this.name = 'DemoTenantMissingError';
  }
}

export async function provisionDemoUser(pool: Pool | undefined, user: AuthUser): Promise<void> {
  if (!isDemoPrincipal(user)) throw new Error('Only demo principals are provisioned here');
  if (!pool) return; // the file store has no user foreign keys
  await withTenantContext(pool, user.tenantId, async client => {
    const tenant = await client.query('SELECT id FROM tenants WHERE id=$1', [user.tenantId]) as { rows: unknown[] };
    if (!tenant.rows.length) throw new DemoTenantMissingError(user.tenantId);
    await client.query(
      'INSERT INTO users (id,email,name,role,tenant_id,created_at) VALUES ($1,$2,$3,$4,$5,NOW()) ON CONFLICT (id) DO NOTHING',
      [user.id, user.email, user.name, user.role, user.tenantId],
    );
  });
}
