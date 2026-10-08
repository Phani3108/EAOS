-- Migration 007 — First-run bootstrap, the missing tenants table, and an
-- authentication lookup that RLS does not break.
--
-- Three problems, all on the path from "fresh database" to "first authenticated
-- request".

-- -------------------------------------------------------------------------
-- 1. tenants — referenced everywhere, defined nowhere
-- -------------------------------------------------------------------------
-- Migration 005 added a tenant_id column to seven tables and built RLS policies
-- around it, but no migration ever created the table those ids refer to. There
-- is consequently no list of tenants, no place to record when one was created,
-- and no way to name one.

CREATE TABLE IF NOT EXISTS tenants (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The implicit tenant every pre-005 row was backfilled into.
INSERT INTO tenants (id, name) VALUES ('default', 'Default')
  ON CONFLICT (id) DO NOTHING;

-- -------------------------------------------------------------------------
-- 2. setup_state — the single-use lock for POST /api/setup
-- -------------------------------------------------------------------------
-- One row, id = 'singleton'. The primary key IS the lock: the first replica to
-- win the index insert owns the bootstrap, every other one sees rowCount 0 and
-- answers 410 Gone. No advisory lock and no coordination required.
--
-- Deliberately NOT under row-level security. RLS filters SELECT; it does not
-- hide a unique-index conflict, but a policy here would make the row invisible
-- to the very check that reads it — and this row is global, not tenant-scoped.

CREATE TABLE IF NOT EXISTS setup_state (
  id           TEXT PRIMARY KEY,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tenant_id    TEXT NOT NULL,
  user_id      TEXT NOT NULL
);

-- -------------------------------------------------------------------------
-- 3. authenticate_api_key — the lookup RLS currently makes impossible
-- -------------------------------------------------------------------------
-- Migration 005 enabled RLS on api_keys and users with
--   USING (tenant_id = current_setting('app.tenant_id', TRUE))
-- and current_setting returns NULL when the GUC is unset, so the predicate
-- evaluates to NULL — not true — and the query returns zero rows.
--
-- Authentication cannot set that GUC, because the tenant is not known until the
-- key has been resolved. Tenant-scoping the credential lookup is circular: the
-- row is the thing that tells you the tenant.
--
-- So the lookup runs as a SECURITY DEFINER function, which executes with the
-- privileges of its owner and is therefore not subject to the caller's policies.
-- This is the standard Postgres shape for an authentication probe. It is safe
-- because it takes a key HASH — an unguessable secret — and returns exactly the
-- one row that hash identifies. It grants no ability to enumerate: without a
-- valid hash it returns nothing.
--
-- Everything else about api_keys (listing, revoking, rotating) stays under RLS.

CREATE OR REPLACE FUNCTION authenticate_api_key(p_key_hash TEXT)
RETURNS TABLE (
  user_id   TEXT,
  email     TEXT,
  name      TEXT,
  role      TEXT,
  scopes    TEXT[],
  tenant_id TEXT
)
LANGUAGE sql
SECURITY DEFINER
-- Pin the search path: a SECURITY DEFINER function that resolves object names
-- through a caller-controlled search_path is a privilege-escalation primitive.
SET search_path = pg_catalog, public
AS $$
  SELECT u.id, u.email, u.name, u.role, k.scopes, k.tenant_id
    FROM api_keys k
    JOIN users u ON u.id = k.user_id
   WHERE k.key_hash = p_key_hash
     AND (k.expires_at IS NULL OR k.expires_at > NOW())
   LIMIT 1;
$$;

COMMENT ON FUNCTION authenticate_api_key(TEXT) IS
  'Resolves an API key hash to a principal, bypassing RLS because the tenant is '
  'not known until the key is resolved. Takes a hash, never a raw key.';

-- Stamp last_used_at without granting the caller write access to the table.
CREATE OR REPLACE FUNCTION touch_api_key(p_key_hash TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE api_keys SET last_used_at = NOW() WHERE key_hash = p_key_hash;
$$;

-- -------------------------------------------------------------------------
-- OPEN QUESTION — tenant isolation is currently unverified
-- -------------------------------------------------------------------------
-- Postgres exempts a table's OWNER from its own RLS policies unless the table is
-- marked FORCE ROW LEVEL SECURITY. Nothing in deploy/ states which role the
-- gateway connects as, so migration 005's isolation is in one of two states:
--
--   * app role IS the owner    → RLS is silently inert. Cross-tenant reads are
--                                possible today and the policies are decorative.
--   * app role is NOT the owner → policies apply, and every raw-pool query that
--                                does not set app.tenant_id returns zero rows.
--
-- Determine with:  SELECT current_user, tableowner FROM pg_tables
--                   WHERE tablename = 'api_keys';
--
-- The fix (ALTER TABLE ... FORCE ROW LEVEL SECURITY, plus a non-owner app role)
-- is deliberately NOT applied here: it is a live behaviour change to every
-- query in the gateway, and it belongs with the tenancy phase where it can be
-- tested. The functions above are correct under either state.
