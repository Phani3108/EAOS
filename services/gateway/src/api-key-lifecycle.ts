import { randomUUID } from 'node:crypto';
import { generateApiKey, type AuthUser } from './auth.js';
import { getApiKeyForUser, persistApiKey, revokeApiKeyForUser } from './api-key-store.js';
import { withTenantContext } from './tenant-middleware.js';
import { revokeLocalUserSessions } from './auth-sessions.js';

type KeyPool = Parameters<typeof withTenantContext>[0];

export class ApiKeyScopeError extends Error {
  readonly statusCode = 403;
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
      const generated = generateApiKey();
      const id = `key_${randomUUID()}`;
      await client.query('DELETE FROM api_keys WHERE id=$1 AND user_id=$2 AND tenant_id=$3', [keyId, user.id, user.tenantId]);
      await client.query(
        'INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, scopes, expires_at, created_at, tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8)',
        [id, user.id, generated.keyHash, generated.keyPrefix, existing.name, scopes, existing.expires_at, user.tenantId],
      );
      await client.query("UPDATE browser_auth_sessions SET data=jsonb_set(data,'{revoked}','true'::jsonb) WHERE data->'user'->>'id'=$1 AND data->'user'->>'tenantId'=$2", [user.id, user.tenantId]);
      return { id, rawKey: generated.rawKey, keyPrefix: generated.keyPrefix, scopes, expiresAt: existing.expires_at };
    });
  }

  const existing = getApiKeyForUser(keyId, user);
  if (!existing) return undefined;
  const scopes = resolveApiKeyScopes(user, existing.scopes);
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
    expiresAt: existing.expiresAt,
  });
  if (!revokeApiKeyForUser(keyId, user)) {
    revokeApiKeyForUser(id, user);
    throw new Error('API key rotation could not revoke the original key');
  }
  revokeLocalUserSessions(user);
  return { id, rawKey: generated.rawKey, keyPrefix: generated.keyPrefix, scopes, expiresAt: existing.expiresAt };
}
