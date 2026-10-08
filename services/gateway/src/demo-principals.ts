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

/**
 * Provisioning for the local demo principal, which acts without a session.
 *
 * It used to run inside the deployment-storage check, where a missing tenant — any
 * EAOS_TENANT_ID but the `default` one migration 007 seeds, until setup runs — was
 * swallowed into the generic "storage not verified" 503. That 503 covered every
 * route, POST /api/setup included: the one step that creates the tenant, and the
 * step the swallowed message named. Nothing was logged, and the retry loop could
 * never succeed.
 *
 * Now it is its own step. Each failure is logged with its cause (once per distinct
 * cause), retried on the next local-demo request, and reported to that request
 * only, so setup stays reachable. Resolves to undefined when the principal is
 * ready, or to a message safe to return to the caller.
 */
export function localDemoProvisioner(pool: Pool | undefined, user: AuthUser, log: Pick<Console, 'log' | 'error'> = console): () => Promise<string | undefined> {
  let ready = !pool;
  let pending: Promise<string | undefined> | undefined;
  let lastCause: string | undefined;
  return () => {
    if (ready) return Promise.resolve(undefined);
    pending ??= provisionDemoUser(pool, user).then(
      () => {
        ready = true;
        if (lastCause) log.log(`[demo] local demo user provisioned in tenant "${user.tenantId}"`);
        return undefined;
      },
      (err: unknown) => {
        const cause = err instanceof Error ? err.message : String(err);
        if (cause !== lastCause) {
          log.error(`[demo] LOCAL DEMO UNAVAILABLE — ${cause}. Credential-less requests get 503 until this succeeds; it is retried on each one.`);
          lastCause = cause;
        }
        return err instanceof DemoTenantMissingError ? err.message : 'The local demo user could not be provisioned; the gateway log has the cause';
      },
    ).finally(() => { pending = undefined; });
    return pending;
  };
}
