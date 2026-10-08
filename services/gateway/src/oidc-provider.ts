/**
 * OIDC / OpenID Connect provider integration.
 * Supports Okta, Azure AD, Auth0, Google Workspace — any OIDC-compliant IdP.
 *
 * Required env vars:
 *   OIDC_ISSUER_URL       — e.g. https://dev-123.okta.com
 *   OIDC_CLIENT_ID
 *   OIDC_CLIENT_SECRET
 *   OIDC_REDIRECT_URI     — e.g. http://localhost:3000/api/auth/oidc/callback
 *   JWT_SECRET            — for signing AgentOS JWTs post-login
 */

import { createHmac, randomBytes, createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';

const ISSUER_URL    = process.env.OIDC_ISSUER_URL ?? '';
const CLIENT_ID     = process.env.OIDC_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET ?? '';
const REDIRECT_URI  = process.env.OIDC_REDIRECT_URI ?? '';

// id_token signatures are verified against the provider JWKS in every
// environment (see verifyIdToken); there is no signature-less development path.

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

interface OIDCConfig {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  issuer: string;
}

let _config: OIDCConfig | null = null;

export async function discoverOIDC(): Promise<OIDCConfig> {
  if (_config) return _config;
  if (!ISSUER_URL) throw new Error('OIDC_ISSUER_URL not set');

  const url = `${ISSUER_URL.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
  const config = await res.json() as OIDCConfig;
  if (config.issuer !== ISSUER_URL) throw new Error('OIDC discovery issuer mismatch');
  for (const endpoint of [config.authorization_endpoint, config.token_endpoint, config.jwks_uri]) {
    if (new URL(endpoint).protocol !== 'https:') throw new Error('OIDC endpoints must use HTTPS');
  }
  _config = config;
  return config;
}

// ---------------------------------------------------------------------------
// Authorization URL
// ---------------------------------------------------------------------------

/** In-memory nonce/state store (production: use Redis with TTL) */
const pendingStates = new Map<string, { nonce: string; createdAt: number; binding: string; verifier: string }>();

export async function buildAuthorizationUrl(binding: string): Promise<{ url: string; state: string }> {
  if (!binding || !CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) throw new Error('OIDC client and browser binding are required');
  const cfg = await discoverOIDC();
  const state = randomBytes(32).toString('hex');
  const nonce = randomBytes(32).toString('hex');
  const verifier = randomBytes(32).toString('base64url');
  if (pendingStates.size >= 1000) throw new Error('Too many pending authorization requests');

  pendingStates.set(state, { nonce, createdAt: Date.now(), binding: createHash('sha256').update(binding).digest('hex'), verifier });
  // Prune states older than 10 minutes
  for (const [k, v] of pendingStates) {
    if (Date.now() - v.createdAt > 600_000) pendingStates.delete(k);
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  });

  return { url: `${cfg.authorization_endpoint}?${params}`, state };
}

// ---------------------------------------------------------------------------
// Code exchange
// ---------------------------------------------------------------------------

interface TokenResponse {
  id_token: string;
  access_token: string;
  token_type: string;
  expires_in?: number;
}

export async function completeAuthorization(code: string, state: string, binding: string): Promise<OIDCClaims> {
  const pending = pendingStates.get(state);
  pendingStates.delete(state);
  if (!pending || Date.now() - pending.createdAt >= 600_000 || !binding ||
      pending.binding !== createHash('sha256').update(binding).digest('hex')) throw new Error('Invalid or expired authorization state');
  const tokens = await exchangeCode(code, pending.verifier);
  // The keys are fetched for this token and handed to verification, not read back
  // from shared state afterwards: another login's refresh can no longer swap them
  // out — or, as it once did, empty them — between the two.
  const keys = await loadJWKS(idTokenKeyId(tokens.id_token));
  return verifyIdToken(tokens.id_token, pending.nonce, keys);
}

export async function exchangeCode(code: string, verifier: string): Promise<TokenResponse> {
  const cfg = await discoverOIDC();

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code_verifier: verifier,
  });

  const res = await fetch(cfg.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    // The identity provider's error body stays in the server log. It used to be
    // put into the thrown message, which the callback handler sends to the browser.
    const text = (await res.text()).slice(0, 500);
    console.warn(`[oidc] token exchange failed: ${res.status} — ${text}`);
    throw new Error(`Token exchange failed (${res.status})`);
  }

  return res.json() as Promise<TokenResponse>;
}

// ---------------------------------------------------------------------------
// ID token verification (RS256 against the provider JWKS)
// ---------------------------------------------------------------------------

interface OIDCClaims {
  sub: string;
  email?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nonce?: string;
}

// ---------------------------------------------------------------------------
// JWKS (production RS256 signature verification)
// ---------------------------------------------------------------------------

/** A single JSON Web Key as published at the provider's jwks_uri. */
interface JWK {
  kty: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  [k: string]: unknown;
}

interface JWTHeader {
  alg: string;
  kid?: string;
  typ?: string;
}

/**
 * In-module JWKS cache: one complete key set and when it was fetched.
 *
 * It is replaced only by a successful fetch and never cleared. Every exchange
 * used to null it before refetching, so a login whose token response arrived
 * while another login's refetch was in flight found no keys and failed (its state
 * already consumed), and one failed refetch left no keys for anyone.
 */
let _jwks: { keys: JWK[]; fetchedAt: number } | null = null;
let _jwksFetch: Promise<JWK[]> | null = null;
/** Keys older than this are refetched before use: rotation reaches us without a restart. */
const JWKS_MAX_AGE_MS = 10 * 60_000;
/** A token naming an unknown kid refetches at most this often, so it cannot drive a fetch per login. */
const JWKS_REFETCH_COOLDOWN_MS = 30_000;

/**
 * Fetch the provider JWKS from the discovery jwks_uri and swap it in. Concurrent
 * callers share one request. Throws on failure, leaving the previous set in place.
 */
async function fetchJWKS(): Promise<JWK[]> {
  _jwksFetch ??= (async () => {
    try {
      const cfg = await discoverOIDC();
      if (!cfg.jwks_uri) throw new Error('discovery doc has no jwks_uri');
      const res = await fetch(cfg.jwks_uri);
      if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
      const body = await res.json() as { keys?: JWK[] };
      if (!Array.isArray(body.keys)) throw new Error('JWKS response missing keys[]');
      _jwks = { keys: body.keys, fetchedAt: Date.now() };
      return body.keys;
    } catch (err) {
      throw new Error(`Unable to load OIDC JWKS: ${err instanceof Error ? err.message : String(err)}`);
    }
  })().finally(() => { _jwksFetch = null; });
  return _jwksFetch;
}

/**
 * Keys able to verify a token signed with `kid`: the cached set while it is fresh
 * and knows that kid, otherwise a refetch (key rotation). Fails closed — throws —
 * when stale keys cannot be refreshed; a kid that is still unknown after a
 * refetch fails later, in verification.
 */
export async function loadJWKS(kid?: string): Promise<JWK[]> {
  const cached = _jwks;
  const age = cached ? Date.now() - cached.fetchedAt : Infinity;
  if (cached && age < JWKS_MAX_AGE_MS && (!kid || cached.keys.some(key => key.kid === kid) || age < JWKS_REFETCH_COOLDOWN_MS)) return cached.keys;
  return fetchJWKS();
}

/** Warm the key cache ahead of a login. Failures are left for loadJWKS to report. */
export async function prewarmJWKS(): Promise<void> {
  try {
    await loadJWKS();
  } catch {
    // Verification fails closed if keys are still unavailable.
  }
}

/** The kid an id_token's header names, if its header can be read at all. */
function idTokenKeyId(idToken: string): string | undefined {
  try {
    const header = JSON.parse(Buffer.from(idToken.split('.')[0] ?? '', 'base64url').toString()) as JWTHeader;
    return typeof header.kid === 'string' ? header.kid : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Synchronously verify the RS256 signature of an id_token against `keys`.
 * Selects the JWK by the token header 'kid', builds an RSA public key with
 * node:crypto createPublicKey({ key: jwk, format: 'jwk' }) (Node 18+ — no new
 * dependency), and verifies 'RSA-SHA256' over the 'header.payload' bytes with the
 * base64url signature. Throws (fails CLOSED) if the signature cannot be verified
 * or no keys are available.
 */
function verifyIdTokenSignatureSync(parts: string[], keys: JWK[] | undefined): void {
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: JWTHeader;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString()) as JWTHeader;
  } catch {
    throw new Error('id_token header is not valid JSON');
  }

  if (header.alg !== 'RS256') {
    throw new Error(`Unsupported id_token alg: ${header.alg ?? 'none'} (expected RS256)`);
  }

  if (!keys) throw new Error('OIDC JWKS unavailable — cannot verify id_token signature');

  const jwk = header.kid
    ? keys.find(k => k.kid === header.kid)
    : keys.find(k => k.kty === 'RSA');
  if (!jwk) throw new Error(`No matching JWK for kid: ${header.kid ?? '(none)'}`);

  let publicKey;
  try {
    publicKey = createPublicKey({ key: jwk as Record<string, unknown>, format: 'jwk' });
  } catch (err) {
    throw new Error(`Unable to build public key from JWK: ${err instanceof Error ? err.message : String(err)}`);
  }

  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`);
  const signature = Buffer.from(signatureB64, 'base64url');

  const ok = cryptoVerify('RSA-SHA256', signingInput, publicKey, signature);
  if (!ok) throw new Error('id_token signature verification failed');
}

/**
 * Verify an id_token's RS256 signature and claims. `keys` defaults to the cached
 * set; completeAuthorization passes the set it loaded for this token's kid.
 */
export function verifyIdToken(idToken: string, state: string, keys: JWK[] | undefined = _jwks?.keys): OIDCClaims {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Invalid id_token format');

  // Signature verification against the provider JWKS, in every environment. Fails
  // CLOSED (throws) if it cannot be verified. Synchronous: the caller loads keys.
  verifyIdTokenSignatureSync(parts, keys);

  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as OIDCClaims;

  // Expiry
  if (!Number.isFinite(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000) || claims.iss !== ISSUER_URL || !claims.sub) {
    throw new Error('id_token expired');
  }

  // Audience
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(CLIENT_ID)) throw new Error('id_token audience mismatch');

  // Nonce (CSRF protection)
  if (!state || claims.nonce !== state) {
    throw new Error('id_token nonce mismatch');
  }

  return claims;
}

// ---------------------------------------------------------------------------
// User provisioning
// ---------------------------------------------------------------------------

export interface OIDCUser {
  id: string;
  email: string;
  name: string;
  tenantId: string;
  picture?: string;
}

/**
 * Map OIDC claims → AgentOS user record.
 * Tenant is derived from email domain or OIDC_DEFAULT_TENANT env var.
 */
export function provisionUser(claims: OIDCClaims): OIDCUser {
  const email = claims.email ?? `${claims.sub}@oidc.local`;
  const tenantId = process.env.OIDC_DEFAULT_TENANT;
  if (!tenantId) throw new Error('OIDC_DEFAULT_TENANT must identify the trusted identity provider tenant');

  return {
    id: `oidc:${createHash('sha256').update(`${claims.iss}\u0000${claims.sub}`).digest('hex')}`,
    email,
    name: claims.name ?? ([claims.given_name, claims.family_name].filter(Boolean).join(' ') || email),
    tenantId,
    picture: claims.picture,
  };
}
