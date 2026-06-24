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

/**
 * Only NODE_ENV=production tightens id_token verification (RS256 signature
 * check against the provider JWKS). In dev/demo the signature-less path is kept
 * so the anonymous/demo flow boots with no env vars exactly as before.
 */
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

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
  _config = await res.json() as OIDCConfig;
  return _config;
}

// ---------------------------------------------------------------------------
// Authorization URL
// ---------------------------------------------------------------------------

/** In-memory nonce/state store (production: use Redis with TTL) */
const pendingStates = new Map<string, { nonce: string; createdAt: number }>();

export async function buildAuthorizationUrl(): Promise<{ url: string; state: string }> {
  const cfg = await discoverOIDC();
  const state = randomBytes(16).toString('hex');
  const nonce = randomBytes(16).toString('hex');

  pendingStates.set(state, { nonce, createdAt: Date.now() });
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

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const cfg = await discoverOIDC();

  // Pre-warm the JWKS cache (production only) so the subsequent synchronous
  // verifyIdToken() can perform an RS256 signature check. No-op in dev/demo.
  await prewarmJWKS();

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });

  const res = await fetch(cfg.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} — ${text}`);
  }

  return res.json() as Promise<TokenResponse>;
}

// ---------------------------------------------------------------------------
// ID token verification (signature-less in dev; JWKS in production)
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

/** In-module JWKS cache (production: a longer-lived store / Redis could be used). */
let _jwks: JWK[] | null = null;

/**
 * Fetch (and cache in-module) the provider JWKS from the discovery jwks_uri.
 * Guarded with try/catch — on any failure the cache is left empty and the
 * caller fails closed (production refuses tokens it cannot verify).
 */
async function fetchJWKS(): Promise<JWK[]> {
  if (_jwks) return _jwks;
  try {
    const cfg = await discoverOIDC();
    if (!cfg.jwks_uri) throw new Error('discovery doc has no jwks_uri');
    const res = await fetch(cfg.jwks_uri);
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const body = await res.json() as { keys?: JWK[] };
    if (!Array.isArray(body.keys)) throw new Error('JWKS response missing keys[]');
    _jwks = body.keys;
    return _jwks;
  } catch (err) {
    // Leave the cache empty so the next call retries; verification fails closed.
    throw new Error(`Unable to load OIDC JWKS: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Pre-warm the in-module JWKS cache. Called from exchangeCode (async, always
 * runs before verifyIdToken) so that verifyIdToken can stay synchronous — its
 * signature/return type are preserved — while still performing a real RS256
 * signature check against freshly-fetched provider keys in production.
 *
 * In dev/demo (NODE_ENV !== 'production') this is a no-op so the flow needs no
 * IdP keys configured, exactly as before.
 */
export async function prewarmJWKS(): Promise<void> {
  if (!IS_PRODUCTION) return;
  try {
    await fetchJWKS();
  } catch {
    // Swallow here; verifyIdToken fails closed if keys are still unavailable.
  }
}

/**
 * Synchronously verify the RS256 signature of an id_token against the already
 * cached provider JWKS. Selects the JWK by the token header 'kid', builds an
 * RSA public key with node:crypto createPublicKey({ key: jwk, format: 'jwk' })
 * (Node 18+ — no new dependency), and verifies 'RSA-SHA256' over the
 * 'header.payload' bytes with the base64url signature. Throws (fails CLOSED)
 * if the signature cannot be verified or the keys are unavailable.
 */
function verifyIdTokenSignatureSync(parts: string[]): void {
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

  const keys = _jwks;
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

export function verifyIdToken(idToken: string, state: string): OIDCClaims {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Invalid id_token format');

  // ---------------------------------------------------------------------------
  // Signature verification.
  //   PRODUCTION (NODE_ENV === 'production'): RS256 signature is verified
  //     against the provider JWKS (pre-warmed by exchangeCode). Fails CLOSED
  //     (throws) if it cannot be verified. verifyIdToken stays synchronous.
  //   DEV/DEMO (NODE_ENV !== 'production'): KEEP the original signature-less
  //     path — claims are trusted without checking the signature so the
  //     anonymous demo flow keeps working with no IdP keys configured.
  // ---------------------------------------------------------------------------
  if (IS_PRODUCTION) {
    verifyIdTokenSignatureSync(parts);
  }
  // else: dev/demo — signature-less, exactly as before.

  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as OIDCClaims;

  // Expiry
  if (claims.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('id_token expired');
  }

  // Audience
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(CLIENT_ID)) throw new Error('id_token audience mismatch');

  // Nonce (CSRF protection)
  const pending = pendingStates.get(state);
  if (pending && claims.nonce && claims.nonce !== pending.nonce) {
    throw new Error('id_token nonce mismatch');
  }
  if (pending) pendingStates.delete(state);

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
  const emailDomain = email.split('@')[1] ?? 'default';
  const tenantId = process.env.OIDC_DEFAULT_TENANT ?? emailDomain;

  return {
    id: `oidc:${claims.sub}`,
    email,
    name: claims.name ?? ([claims.given_name, claims.family_name].filter(Boolean).join(' ') || email),
    tenantId,
    picture: claims.picture,
  };
}
