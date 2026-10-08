/**
 * API keys on the file / ephemeral store.
 *
 * Why this exists
 * ----------------------------------------------------------------------------
 * The key resolver began with `if (!pgPool) return undefined` — "no relational
 * store → no key store". Combined with `ALLOW_ANON` now defaulting to false,
 * that made the default deployment unauthenticable: the file store is what you
 * get without `DATABASE_URL`, so every request 401'd and no credential could
 * ever be minted or presented. The bootstrap route this module supports would
 * have handed back a key that could not authenticate.
 *
 * `POST /api/users/apikeys` had the matching bug from the other end: it answered
 * `201 {rawKey}` after writing nothing whenever `pgPool` was undefined. The
 * caller stored a credential that had never existed. Same rule as the rest of
 * this pass — nothing ships that lies, including a success response.
 *
 * What is stored
 * ----------------------------------------------------------------------------
 * The HMAC of the key, never the key. `hashApiKey()` from `@agentos/auth` is
 * reused rather than reimplemented so the write and lookup sides cannot drift —
 * that drift is exactly how a key store silently stops matching. The row is
 * keyed by the hash, so a lookup is a single `get()` with no scan.
 *
 * Scope of this path
 * ----------------------------------------------------------------------------
 * Single replica. The file store is a JSON document owned by one process (see
 * the duplicate-open guard in `PersistentStore`), so there is no cross-replica
 * coordination here and none is implied. `@agentos/config` already warns at boot
 * that an unset `DATABASE_URL` means single-replica operation.
 */

import { createHash } from 'node:crypto';
import { hashApiKeyCandidates, type AuthUser } from './auth.js';
import type { Store } from './db.js';

/** Table name in the shared `Store`. Also registered for persistence. */
export const API_KEY_TABLE = 'api_keys';

export interface StoredApiKey {
  /** Row id AND the lookup key: the HMAC of the raw key. */
  id: string;
  keyId?: string;
  keyPrefix: string;
  userId: string;
  email: string;
  name: string;
  role: 'user' | 'operator' | 'admin';
  tenantId: string;
  /** Persona scopes. `['*']` means every persona. */
  scopes: string[];
  label: string;
  createdAt: string;
  lastUsedAt?: string;
  /** ISO timestamp, or null for a key that does not expire. */
  expiresAt?: string | null;
}

export interface PersistApiKeyInput {
  id: string;
  keyHash: string;
  keyPrefix: string;
  userId: string;
  email: string;
  name: string;
  role: 'user' | 'operator' | 'admin';
  tenantId: string;
  scopes: string[];
  label: string;
  expiresAt?: string | null;
}

let store: Store | undefined;

/** Inject the shared store. Called once during gateway boot. */
export function initApiKeyStore(s: Store): void {
  store = s;
}

/**
 * Write a key row, keyed by its hash.
 *
 * Throws when the store is unavailable. The caller must let that surface as a
 * 5xx rather than returning a key it did not persist.
 */
export function persistApiKey(input: PersistApiKeyInput): void {
  if (!store) {
    throw new Error('api-key-store: no store bound — initApiKeyStore() was not called');
  }
  const row: StoredApiKey = {
    id: input.keyHash,
    keyId: input.id,
    keyPrefix: input.keyPrefix,
    userId: input.userId,
    email: input.email,
    name: input.name,
    role: input.role,
    tenantId: input.tenantId,
    scopes: input.scopes.length > 0 ? input.scopes : ['*'],
    label: input.label,
    createdAt: new Date().toISOString(),
    expiresAt: input.expiresAt ?? null,
  };
  store.insert(API_KEY_TABLE, row.id, row as unknown as Record<string, unknown>);
}

/**
 * Resolve a raw key to a principal, or undefined.
 *
 * Returns undefined for every failure — unknown key, expired key, missing store,
 * unusable hash. A lookup failure must deny; it must never fall through to a
 * weaker check.
 */
export function lookupApiKey(rawKey: string): AuthUser | undefined {
  if (!store) return undefined;

  let candidates: string[];
  try {
    candidates = hashApiKeyCandidates(rawKey);
  } catch {
    // No signing secret configured — nothing can be verified, so nothing is.
    return undefined;
  }

  const match = candidates.map(keyHash => ({ keyHash, row: store!.get(API_KEY_TABLE, keyHash) as unknown as StoredApiKey | undefined })).find(candidate => candidate.row);
  if (!match?.row) return undefined;
  let { keyHash } = match;
  const { row } = match;

  const expiresAt = row.expiresAt ? new Date(row.expiresAt).getTime() : undefined;
  if (expiresAt !== undefined && !(expiresAt > Date.now())) return undefined;

  // Found under an older hash (written before API_KEY_HASH_SECRET was set, or
  // under a JWT secret since rotated): move the row onto the current hash, keeping
  // its public id, so the key survives that secret being retired.
  const current = candidates[0]!;
  if (keyHash !== current) {
    try {
      store.insert(API_KEY_TABLE, current, { ...row, id: current, keyId: publicKeyId(row) } as unknown as Record<string, unknown>);
      store.delete(API_KEY_TABLE, keyHash);
      keyHash = current;
    } catch {
      /* the key still resolves under its old hash; the move is retried next use */
    }
  }

  // Best-effort last-used stamp. Never block or fail auth on it.
  try {
    store.update(API_KEY_TABLE, keyHash, { lastUsedAt: new Date().toISOString() });
  } catch {
    /* not worth failing a valid request over */
  }

  return {
    id: row.userId,
    email: row.email ?? '',
    name: row.name ?? '',
    role: row.role ?? 'user',
    teams: [],
    personaScopes: (row.scopes?.length ? row.scopes : ['*']) as AuthUser['personaScopes'],
    tenantId: row.tenantId ?? 'default',
    authorityExpiresAt: expiresAt,
  };
}

/** Revoke by row id (the hash). Returns whether a row was removed. */
export function revokeApiKeyByHash(keyHash: string): boolean {
  if (!store) return false;
  if (!store.get(API_KEY_TABLE, keyHash)) return false;
  store.delete(API_KEY_TABLE, keyHash);
  return true;
}

type KeyOwner = Pick<AuthUser, 'id' | 'tenantId'>;

function publicKeyId(row: StoredApiKey): string {
  return row.keyId ?? `legacy_${createHash('sha256').update(row.id).digest('hex')}`;
}

function ownedKeys(owner: KeyOwner): StoredApiKey[] {
  if (!store || !owner.id || !owner.tenantId) return [];
  return store.query(API_KEY_TABLE, row => row.userId === owner.id && row.tenantId === owner.tenantId) as unknown as StoredApiKey[];
}

export function getApiKeyForUser(keyId: string, owner: KeyOwner): StoredApiKey | undefined {
  return ownedKeys(owner).find(row => publicKeyId(row) === keyId);
}

export function revokeApiKeyForUser(keyId: string, owner: KeyOwner): boolean {
  const row = getApiKeyForUser(keyId, owner);
  return row ? revokeApiKeyByHash(row.id) : false;
}

/** Every key for a user, without the hashes. For listing in a UI. */
export function listApiKeysForUser(owner: KeyOwner) {
  return ownedKeys(owner).map(row => ({
    id: publicKeyId(row),
    keyPrefix: row.keyPrefix,
    label: row.label,
    scopes: row.scopes,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
  }));
}

/** Whether any key exists at all. Used by the first-run setup lock. */
export function hasAnyApiKey(): boolean {
  if (!store) return false;
  return store.all(API_KEY_TABLE).length > 0;
}
