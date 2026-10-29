/**
 * First-run bootstrap — `POST /api/setup`.
 *
 * The problem it solves
 * ----------------------------------------------------------------------------
 * With the anonymous fallback off by default and the token endpoint sitting
 * behind the auth gate, a fresh instance had no way to produce a first
 * credential. `/api/auth/token` requires an authenticated user, and
 * `/api/users/apikeys` requires one too — both mint a *second* credential, not a
 * first. The allowlist declared `/api/setup` public, but no handler existed, so
 * it answered 404 to the one client that needed it.
 *
 * Why a setup token rather than the alternatives
 * ----------------------------------------------------------------------------
 *  - **OIDC-only** cannot bootstrap: configuring an IdP requires logging in to
 *    configure it. Chicken and egg.
 *  - **A random first-run password printed to logs** leaks into whatever
 *    aggregates those logs, and N replicas would each print a different one.
 *  - An **operator-supplied token** is already in the operator's hands before
 *    the process starts, is never generated or logged by us, and is the same on
 *    every replica.
 *
 * Single-use, and how that is enforced
 * ----------------------------------------------------------------------------
 * A row is the lock. On Postgres it is `INSERT ... ON CONFLICT DO NOTHING` on a
 * primary key: whichever replica wins the index insert wins the race, the losers
 * see `rowCount === 0` and answer 410. No advisory lock, no coordination.
 *
 * On the file store there is no CAS, so the guard is a synchronous critical
 * section: every `await` happens before the check, and no `await` sits between
 * the check and the writes. Node's single thread makes that atomic in-process,
 * which is the correct scope — the file store is single-replica by construction
 * (`PersistentStore` throws on a duplicate open of the same path).
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { Store } from './db.js';
import { generateApiKey, hashApiKey } from './auth.js';
import { persistApiKey } from './api-key-store.js';
import { setTenantContext } from './tenant-middleware.js';

/** Row id for the single setup-state record. The row IS the lock. */
const SETUP_ROW_ID = 'singleton';
const SETUP_TABLE = 'setup_state';

export interface SetupRequest {
  setupToken?: unknown;
  email?: unknown;
  name?: unknown;
  tenantId?: unknown;
}

export type SetupResult =
  | {
      ok: true;
      apiKey: string;
      keyPrefix: string;
      userId: string;
      tenantId: string;
    }
  | { ok: false; status: number; error: string; detail?: string };

export interface SetupDeps {
  /** The configured bootstrap token. Setup is disabled when absent. */
  setupToken?: string;
  /** Shared store — always present. */
  store: Store;
  /** Raw pool when a relational store is configured. */
  pgPool?: {
    query(...args: any[]): Promise<any>;
    connect(): Promise<{ query(...args: any[]): Promise<any>; release(): void }>;
  };
}

/**
 * Constant-time comparison of two secrets of unequal length.
 *
 * `timingSafeEqual` throws when the buffers differ in length, and guarding that
 * with a length check leaks the length. Hashing both sides first makes them
 * fixed-width, so only the comparison itself is observable.
 */
function secretsMatch(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function runSetup(body: SetupRequest, deps: SetupDeps): Promise<SetupResult> {
  const { setupToken, store, pgPool } = deps;

  // ── Is setup even enabled? ────────────────────────────────────────────────
  // 503 rather than 401: this is an operator configuration problem, and
  // answering "unauthorized" would send them hunting for a credential that does
  // not exist yet.
  if (!setupToken) {
    return {
      ok: false,
      status: 503,
      error: 'Setup is not enabled',
      detail:
        'EAOS_SETUP_TOKEN is not set. Generate one (openssl rand -hex 32), set it in the ' +
        'environment, restart, and call this endpoint again.',
    };
  }

  const presented = typeof body.setupToken === 'string' ? body.setupToken : '';
  if (!presented || !secretsMatch(presented, setupToken)) {
    return { ok: false, status: 401, error: 'Invalid setup token' };
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!email || !email.includes('@')) {
    return { ok: false, status: 400, error: 'A valid email is required' };
  }
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : email;
  const tenantId = typeof body.tenantId === 'string' && body.tenantId.trim()
    ? body.tenantId.trim()
    : 'default';

  const userId = `user_${createHash('sha256').update(`${tenantId}:${email}`).digest('hex').slice(0, 16)}`;

  // Generated BEFORE the lock is taken so that the critical section below stays
  // synchronous on the file-store path.
  const { rawKey, keyHash, keyPrefix } = generateApiKey();

  return pgPool
    ? setupOnPostgres({ pgPool, tenantId, userId, email, name, rawKey, keyHash, keyPrefix })
    : setupOnStore({ store, tenantId, userId, email, name, rawKey, keyHash, keyPrefix });
}

interface SetupArgs {
  tenantId: string;
  userId: string;
  email: string;
  name: string;
  rawKey: string;
  keyHash: string;
  keyPrefix: string;
}

async function setupOnPostgres(
  args: SetupArgs & { pgPool: NonNullable<SetupDeps['pgPool']> },
): Promise<SetupResult> {
  const { pgPool, tenantId, userId, email, name, rawKey, keyHash, keyPrefix } = args;
  let client: Awaited<ReturnType<typeof pgPool.connect>> | undefined;

  try {
    client = await pgPool.connect();
    await client.query('BEGIN');
    await setTenantContext(client, tenantId);
    // The lock. Whoever wins this index insert owns the bootstrap; everyone else
    // reads rowCount 0. Deliberately first, before any other write.
    const claim = await client.query(
      `INSERT INTO ${SETUP_TABLE} (id, completed_at, tenant_id, user_id)
       VALUES ($1, NOW(), $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [SETUP_ROW_ID, tenantId, userId],
    );
    if (claim.rowCount === 0) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        status: 410,
        error: 'Setup has already been completed',
        detail: 'Use an existing credential, or the OIDC sign-in flow.',
      };
    }

    await client.query(
      `INSERT INTO tenants (id, name, created_at) VALUES ($1, $2, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [tenantId, tenantId],
    );
    await client.query(
      `INSERT INTO users (id, email, name, role, tenant_id, created_at)
       VALUES ($1, $2, $3, 'admin', $4, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [userId, email, name, tenantId],
    );
    // scopes '{*}' — the column default is '{read,execute}', which
    // `requirePersonaAccess` reads as "no personas", producing an admin key that
    // authenticates and is then refused by every persona route.
    await client.query(
      `INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, scopes, created_at, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)`,
      [
        `key_setup_${keyPrefix}`,
        userId,
        keyHash,
        keyPrefix,
        'bootstrap admin key',
        ['*'],
        tenantId,
      ],
    );

    await client.query('COMMIT');
    return { ok: true, apiKey: rawKey, keyPrefix, userId, tenantId };
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    const message = (err as Error).message;
    // A fresh database with no migrations applied is the likeliest cause, and
    // the fix is a command — so name it rather than returning a bare 500.
    if (/relation ".*" does not exist/i.test(message)) {
      return {
        ok: false,
        status: 503,
        error: 'Database schema is not initialised',
        detail: `Run migrations first: pnpm --filter @agentos/db migrate  (${message})`,
      };
    }
    return { ok: false, status: 500, error: 'Setup failed', detail: message };
  } finally { client?.release(); }
}

function setupOnStore(args: SetupArgs & { store: Store }): SetupResult {
  const { store, tenantId, userId, email, name, rawKey, keyHash, keyPrefix } = args;

  // ── Critical section — no `await` from here to the end. ───────────────────
  // The Store interface is a synchronous KV with no compare-and-set, so
  // single-threaded execution is the atomicity guarantee. Introducing an await
  // between the check and the writes reintroduces the race.
  if (store.get(SETUP_TABLE, SETUP_ROW_ID)) {
    return {
      ok: false,
      status: 410,
      error: 'Setup has already been completed',
      detail: 'Use an existing credential, or the OIDC sign-in flow.',
    };
  }

  store.insert('tenants', tenantId, { id: tenantId, name: tenantId, createdAt: new Date().toISOString() });
  store.insert('users', userId, {
    id: userId,
    email,
    name,
    role: 'admin',
    tenantId,
    createdAt: new Date().toISOString(),
  });
  persistApiKey({
    id: `key_setup_${keyPrefix}`,
    keyHash,
    keyPrefix,
    userId,
    email,
    name,
    role: 'admin',
    tenantId,
    scopes: ['*'],
    label: 'bootstrap admin key',
  });
  store.insert(SETUP_TABLE, SETUP_ROW_ID, { completedAt: new Date().toISOString(), tenantId, userId });
  // ── End critical section. ─────────────────────────────────────────────────

  return { ok: true, apiKey: rawKey, keyPrefix, userId, tenantId };
}

/** Whether setup has run. Surfaced on /api/health so operators can see it. */
export function isSetupComplete(store: Store, pgPoolPresent: boolean): boolean | undefined {
  // On Postgres this needs a query; the caller decides whether to pay for it.
  if (pgPoolPresent) return undefined;
  return Boolean(store.get(SETUP_TABLE, SETUP_ROW_ID));
}

export { SETUP_TABLE, SETUP_ROW_ID, hashApiKey };
