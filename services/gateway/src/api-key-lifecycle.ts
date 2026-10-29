import { randomUUID } from 'node:crypto';
import { generateApiKey, hashApiKeyCandidates, type AuthUser } from './auth.js';
import { getApiKeyForUser, persistApiKey, revokeApiKeyForUser } from './api-key-store.js';
import { withTenantContext } from './tenant-middleware.js';
import { revokeLocalUserSessions } from './auth-sessions.js';

type KeyPool = Parameters<typeof withTenantContext>[0];
type LookupPool = KeyPool & { query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, any>> }> };

export class ApiKeyScopeError extends Error {
  readonly statusCode = 403;
}

/**
 * The expiry a new or rotated key gets: what was asked for (or the key already
 * had), never later than the authority of the principal minting it. A key that
 * expires in an hour used to mint a key that never did — or rotate a sibling
 * non-expiring key into a fresh raw one — so a leaked short-lived CI key was a
 * permanent credential.
 */
export function boundedKeyExpiry<T extends string | Date>(requested: T | null | undefined, user: Pick<AuthUser, 'authorityExpiresAt'>): T | string | null {
  const cap = user.authorityExpiresAt;
  if (cap === undefined) return requested ?? null;
  if (requested != null && new Date(requested).getTime() <= cap) return requested;
  return new Date(cap).toISOString();
}

let rehashDenied = false;

/**
 * Resolve a raw key against PostgreSQL.
 *
 * The SECURITY DEFINER lookup (migration 007) names the principal and tenant but
 * not the key's expiry, which bounds everything the key mints, so that is read
 * afterwards under the tenant's row security. A key found under an older hash
 * (see hashApiKeyCandidates) is moved onto the current one in the background so
 * it survives that older secret being retired; until it moves, it still resolves.
 */
export async function resolvePostgresApiKey(pool: LookupPool, rawKey: string): Promise<AuthUser | undefined> {
  const candidates = hashApiKeyCandidates(rawKey);
  let keyHash: string | undefined;
  let row: Record<string, any> | undefined;
  for (const candidate of candidates) {
    const result = await pool.query('SELECT * FROM authenticate_api_key($1)', [candidate]);
    if (result.rows[0]) { row = result.rows[0]; keyHash = candidate; break; }
  }
  if (!row || !keyHash) return undefined;
  const tenantId: string = row.tenant_id ?? 'default';
  const matched = keyHash;
  const key = await withTenantContext(pool, tenantId, client => client.query('SELECT expires_at FROM api_keys WHERE key_hash=$1 AND tenant_id=$2', [matched, tenantId])) as { rows: Array<{ expires_at: Date | string | null }> };
  // Revoked or rotated between the two reads.
  if (!key.rows[0]) return undefined;

  const current = candidates[0]!;
  const moved = matched === current ? Promise.resolve(matched) : withTenantContext(pool, tenantId, client => client.query('UPDATE api_keys SET key_hash=$1 WHERE key_hash=$2 AND tenant_id=$3', [current, matched, tenantId]))
    .then(() => current, (err: Error) => {
      if (!rehashDenied) console.warn(`[auth] could not move an API key onto the current hash (it keeps working under the old one): ${err.message}`);
      rehashDenied = true;
      return matched;
    });
  // Best-effort last-used stamp; never block auth on it.
  void moved.then(hash => pool.query('SELECT touch_api_key($1)', [hash])).catch(() => {});

  const expiresAt = key.rows[0].expires_at;
  return {
    id: row.user_id,
    email: row.email ?? '',
    name: row.name ?? '',
    role: (row.role ?? 'user') as AuthUser['role'],
    teams: [],
    personaScopes: Array.isArray(row.scopes) ? row.scopes : ['*'],
    tenantId,
    authorityExpiresAt: expiresAt ? new Date(expiresAt).getTime() : undefined,
  };
}

export function resolveApiKeyScopes(user: AuthUser, requested?: unknown): string[] {
  const allowed: readonly string[] = user.personaScopes ?? ['*'];
  const scopes = requested === undefined ? allowed : requested;
  if (!Array.isArray(scopes) || scopes.length === 0 || scopes.some(scope =>
    typeof scope !== 'string' || !scope.trim() || (!allowed.includes('*') && !allowed.includes(scope)),
  )) {
    throw new ApiKeyScopeError('API key scopes must be a nonempty subset of the issuing principal scopes');
  }
  return [...new Set(scopes as string[])];
}

export async function revokeApiKey(keyId: string, user: AuthUser, pool?: KeyPool): Promise<boolean> {
  if (!user.id || !user.tenantId) return false;
  if (!pool) {
    const revoked = revokeApiKeyForUser(keyId, user);
    if (revoked) revokeLocalUserSessions(user);
    return revoked;
  }
  return withTenantContext(pool, user.tenantId, async client => {
    const result = await client.query(
      'DELETE FROM api_keys WHERE id=$1 AND user_id=$2 AND tenant_id=$3 RETURNING id',
      [keyId, user.id, user.tenantId],
    ) as { rows: unknown[] };
    if (result.rows.length) await client.query("UPDATE browser_auth_sessions SET data=jsonb_set(data,'{revoked}','true'::jsonb) WHERE data->'user'->>'id'=$1 AND data->'user'->>'tenantId'=$2", [user.id, user.tenantId]);
    return result.rows.length > 0;
  });
}

export async function rotateApiKey(keyId: string, user: AuthUser, pool?: KeyPool) {
  if (!user.id || !user.tenantId) return undefined;
  if (pool) {
    return withTenantContext(pool, user.tenantId, async client => {
      const result = await client.query(
        'SELECT name, scopes, expires_at FROM api_keys WHERE id=$1 AND user_id=$2 AND tenant_id=$3 FOR UPDATE',
        [keyId, user.id, user.tenantId],
      ) as { rows: Array<{ name: string; scopes: string[]; expires_at: string | Date | null }> };
      const existing = result.rows[0];
      if (!existing) return undefined;
      const scopes = resolveApiKeyScopes(user, existing.scopes);
      const expiresAt = boundedKeyExpiry(existing.expires_at, user);
      const generated = generateApiKey();
      const id = `key_${randomUUID()}`;
      await client.query('DELETE FROM api_keys WHERE id=$1 AND user_id=$2 AND tenant_id=$3', [keyId, user.id, user.tenantId]);
      await client.query(
        'INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, scopes, expires_at, created_at, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8)',
        [id, user.id, generated.keyHash, generated.keyPrefix, existing.name, scopes, expiresAt, user.tenantId],
      );
      await client.query("UPDATE browser_auth_sessions SET data=jsonb_set(data,'{revoked}','true'::jsonb) WHERE data->'user'->>'id'=$1 AND data->'user'->>'tenantId'=$2", [user.id, user.tenantId]);
      return { id, rawKey: generated.rawKey, keyPrefix: generated.keyPrefix, scopes, expiresAt };
    });
  }

  const existing = getApiKeyForUser(keyId, user);
  if (!existing) return undefined;
  const scopes = resolveApiKeyScopes(user, existing.scopes);
  const expiresAt = boundedKeyExpiry(existing.expiresAt, user);
  const generated = generateApiKey();
  const id = `key_${randomUUID()}`;
  persistApiKey({
    id,
    ...generated,
    userId: user.id,
    tenantId: user.tenantId,
    email: user.email,
    name: user.name,
    role: user.role,
    scopes,
    label: existing.label,
    expiresAt,
  });
  if (!revokeApiKeyForUser(keyId, user)) {
    revokeApiKeyForUser(id, user);
    throw new Error('API key rotation could not revoke the original key');
  }
  revokeLocalUserSessions(user);
  return { id, rawKey: generated.rawKey, keyPrefix: generated.keyPrefix, scopes, expiresAt };
}
