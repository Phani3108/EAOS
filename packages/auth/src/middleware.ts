/**
 * Auth middleware — JWT verification + RBAC + API key hashing
 *
 * Production: JWT with HMAC-SHA256 signature verification + expiration.
 * Development: Falls back to anonymous user when no auth provided.
 * API keys: Hashed comparison (never stored in plain text in production).
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type UserRole = 'user' | 'operator' | 'admin';
export type PersonaScope = 'engineering' | 'product' | 'hr' | 'marketing' | '*';

export interface AuthUser {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    teams: string[];
    /** Persona scopes — restricts which persona APIs the user can access */
    personaScopes?: PersonaScope[];
    /** Tenant this user belongs to (default: 'default') */
    tenantId: string;
    sessionId?: string;
    tokenExpiresAt?: number;
}

/** Result of generating a new API key — raw key is shown once, only hash is stored. */
export interface GeneratedApiKey {
    rawKey: string;
    keyHash: string;
    keyPrefix: string;
}

/**
 * Generate a cryptographically random API key.
 * Returns the raw key (show once to user), its HMAC-SHA256 hash, and a safe prefix for display.
 */
export function generateApiKey(secret?: string): GeneratedApiKey {
    const rawKey = `ak_${randomBytes(32).toString('hex')}`;
    // No hardcoded fallback secret: an API key hash is only meaningful when a real
    // signing secret exists. Require an explicit secret or JWT_SECRET — never a
    // predictable constant baked into the source.
    const signingSecret = secret ?? (process.env.API_KEY_HASH_SECRET || JWT_SECRET).split(',').map(value => value.trim()).find(Boolean);
    if (!signingSecret) throw new Error('generateApiKey: no signing secret (set JWT_SECRET/AUTH_SECRET or pass one)');
    const keyHash = createHmac('sha256', signingSecret).update(rawKey).digest('hex');
    const keyPrefix = rawKey.slice(0, 10);
    return { rawKey, keyHash, keyPrefix };
}

// Dev mode API keys — in production, these are hashed and stored in DB
const DEV_API_KEYS: Record<string, AuthUser> = {
    'eos-dev-key': { id: 'dev-user', email: 'dev@agentos.dev', name: 'Developer', role: 'admin', teams: ['engineering'], personaScopes: ['*'], tenantId: 'default' },
    'eos-demo-key': { id: 'demo-user', email: 'demo@agentos.dev', name: 'Demo User', role: 'user', teams: ['engineering', 'marketing'], personaScopes: ['engineering', 'marketing'], tenantId: 'default' },
    'eos-operator-key': { id: 'ops-user', email: 'ops@agentos.dev', name: 'Operator', role: 'operator', teams: ['engineering', 'product', 'marketing', 'hr'], personaScopes: ['*'], tenantId: 'default' },
};

/** JWT signing secret — set via env (required in production) */
const JWT_SECRET = process.env.JWT_SECRET || process.env.AUTH_SECRET || '';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Anonymous fallback. Opt-IN, defaulting to false.
 *
 * This was `process.env.ALLOW_ANON !== 'false'` — i.e. ON unless explicitly
 * disabled, and ON for any typo (`ALLOW_ANON=no` enabled it). An access-control
 * default that fails open is a finding waiting to happen, so it is now opt-in and
 * `@agentos/config` rejects a value that is neither "true" nor "false" instead of
 * coercing it.
 *
 * Local development that relies on the anonymous fallback must set
 * `ALLOW_ANON=true` explicitly — see .env.example.
 */
const ALLOW_ANON = process.env.ALLOW_ANON === 'true';

/**
 * Require a verifiable HMAC signature on every JWT. Defaults to ON.
 *
 * Explicit rather than derived from NODE_ENV. The audit found five places where
 * security behaviour branched on the environment, which guaranteed that tests
 * exercised a different program than production — and is precisely why the
 * unsigned-token hole below survived. Opting out is possible, loud, and
 * deliberate.
 */
const REQUIRE_SIGNED_TOKENS = process.env.REQUIRE_SIGNED_TOKENS !== 'false';

/**
 * Honour the hardcoded `eos-dev-key` / `eos-operator-key` / `eos-demo-key`.
 *
 * Opt-in, default OFF. These grant admin and operator, and were previously
 * reachable whenever NODE_ENV was anything other than 'production' — so a
 * deployment that merely forgot to set NODE_ENV handed admin to anyone who had
 * read the repository.
 */
const ALLOW_DEV_API_KEYS = process.env.ALLOW_DEV_API_KEYS === 'true';

// NOTE: the fail-fast check for a missing JWT_SECRET used to live here as a
// top-level `throw`. A throw during module evaluation exits before any logger,
// health endpoint or listener exists, so a misconfigured container restart-looped
// with no diagnostic. Validation now runs in `boot()` via
// `loadEnvOrExit()` from @agentos/config, which prints a set/missing table and
// exits 78 (EX_CONFIG). Do not reintroduce a module-scope throw here.

export async function authenticateRequest(headers: Record<string, string | undefined>): Promise<AuthResult> {
    // 1. Try X-API-Key header first
    const apiKey = headers['x-api-key'];
    if (apiKey) {
        const user = await resolveApiKey(apiKey);
        if (user) return { authenticated: true, user };
        return { authenticated: false, error: 'Invalid API key' };
    }

    // 2. Try Bearer token (JWT)
    const authHeader = headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        // Check if it's a known API key (for backward compat)
        const keyUser = await resolveApiKey(token);
        if (keyUser) return { authenticated: true, user: keyUser };

        // Verify as JWT
        try {
            const user = verifyJWT(token);
            if (user?.sessionId) {
                const current = await sessionResolver?.(user.sessionId);
                if (!current || current.id !== user.id || current.tenantId !== user.tenantId) return { authenticated: false, error: 'Session expired or revoked' };
                return { authenticated: true, user: { ...current, sessionId: user.sessionId, tokenExpiresAt: Math.min(current.tokenExpiresAt ?? Infinity, user.tokenExpiresAt ?? Infinity) } };
            }
            if (user) return { authenticated: true, user };
            return { authenticated: false, error: 'Invalid or expired token' };
        } catch {
            return { authenticated: false, error: 'Token verification failed' };
        }
    }

    // 3. Anonymous fallback. Opt-IN via ALLOW_ANON=true, and @agentos/config
    //    refuses to boot with it enabled under NODE_ENV=production, so the
    //    IS_PRODUCTION check here is defence-in-depth rather than the only guard.
    if (!IS_PRODUCTION && ALLOW_ANON) {
        return {
            authenticated: true,
            user: { id: 'anonymous', email: 'anon@local', name: 'Anonymous', role: 'user', teams: [], personaScopes: ['*'], tenantId: 'default' },
        };
    }

    return { authenticated: false, error: 'Missing authentication' };
}

/** Check if user has the required minimum role */
export function requireRole(user: AuthUser, requiredRole: UserRole): boolean {
    const hierarchy: Record<UserRole, number> = { user: 0, operator: 1, admin: 2 };
    return hierarchy[user.role] >= hierarchy[requiredRole];
}

/** Check if user has access to a specific persona */
export function requirePersonaAccess(user: AuthUser, persona: string): boolean {
    if (!user.personaScopes || user.personaScopes.length === 0) return false;
    if (user.personaScopes.includes('*')) return true;
    return user.personaScopes.includes(persona as PersonaScope);
}

/** Generate a signed JWT token (for issuing tokens from auth endpoints) */
export function generateJWT(user: AuthUser, expiresInSec = 86400): string {
    const secret = JWT_SECRET.split(',').map(value => value.trim()).find(Boolean);
    if (!secret) throw new Error('JWT_SECRET not configured');
    if (!Number.isInteger(expiresInSec) || expiresInSec < 1 || expiresInSec > 86400) throw new Error('Token lifetime must be between 1 and 86400 seconds');
    if (!user.id || !user.tenantId) throw new Error('Token principal and tenant are required');

    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        sub: user.id,
        iss: 'eaos',
        aud: 'eaos-api',
        sid: user.sessionId,
        email: user.email,
        name: user.name,
        role: user.role,
        teams: user.teams,
        personaScopes: user.personaScopes ?? ['*'],
        tenantId: user.tenantId ?? 'default',
        iat: now,
        exp: now + expiresInSec,
    };

    const encodedHeader = base64url(JSON.stringify(header));
    const encodedPayload = base64url(JSON.stringify(payload));
    const signature = hmacSign(`${encodedHeader}.${encodedPayload}`, secret);

    return `${encodedHeader}.${encodedPayload}.${signature}`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolves a raw API key to a principal, typically against a database.
 *
 * Injected rather than imported so this package keeps no DB dependency — it is
 * loaded early and must not be able to fail on a driver or a connection.
 */
export type ApiKeyResolver = (rawKey: string) => Promise<AuthUser | undefined>;

let apiKeyResolver: ApiKeyResolver | undefined;
let sessionResolver: ((id: string) => Promise<AuthUser | undefined>) | undefined;

export function setSessionResolver(resolver: (id: string) => Promise<AuthUser | undefined>): void {
    sessionResolver = resolver;
}

/** Register the backing key store. Called once from the gateway's boot. */
export function setApiKeyResolver(resolver: ApiKeyResolver): void {
    apiKeyResolver = resolver;
}

/**
 * Hash a raw API key for storage and lookup.
 *
 * Exported so the resolver can query by hash without reimplementing this, which
 * is how the two sides silently drift apart.
 */
export function hashApiKey(rawKey: string, secret?: string): string {
    const signingSecret = secret ?? (process.env.API_KEY_HASH_SECRET || JWT_SECRET).split(',').map(value => value.trim()).find(Boolean);
    if (!signingSecret) throw new Error('hashApiKey: no signing secret (set JWT_SECRET/AUTH_SECRET)');
    return createHmac('sha256', signingSecret).update(rawKey).digest('hex');
}

export function hashApiKeyCandidates(rawKey: string): string[] {
    const raw = process.env.API_KEY_HASH_SECRET || JWT_SECRET;
    return [...new Set([...raw.split(',').map(value => value.trim()).filter(Boolean), raw].filter(Boolean).map(secret => hashApiKey(rawKey, secret)))];
}

async function resolveApiKey(key: string): Promise<AuthUser | undefined> {
    // The hardcoded demo keys grant admin and operator, so they are opt-in and
    // default OFF. They were previously reachable on a `!IS_PRODUCTION` branch,
    // which meant any deployment that forgot to set NODE_ENV=production handed
    // admin to anyone who had read the source.
    if (ALLOW_DEV_API_KEYS && !IS_PRODUCTION) {
        const devUser = DEV_API_KEYS[key];
        if (devUser) return devUser;
    }

    // The real path. Previously this returned `undefined` unconditionally in
    // production — its own comment admitted "no API key can authenticate in
    // production" — which, combined with the anonymous fallback being off and the
    // token endpoint sitting behind the auth gate, left no way to obtain a
    // credential at all.
    if (apiKeyResolver) return apiKeyResolver(key);
    return undefined;
}

function verifyJWT(token: string): AuthUser | null {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        const [encodedHeader, encodedPayload, signature] = parts;

        // Reject anything that is not HS256. This implementation only ever applies
        // HS256, so it was already immune to the `alg: none` and RS256-confusion
        // attacks — but relying on that implicitly means a future refactor could
        // reintroduce them silently. Assert it.
        try {
            const header = JSON.parse(Buffer.from(encodedHeader!, 'base64url').toString()) as { alg?: string };
            if (header.alg !== 'HS256') return null;
        } catch {
            return null;
        }

        // Signature verification.
        //
        // This used to be gated on `IS_PRODUCTION`: with no JWT_SECRET set and
        // NODE_ENV !== 'production', the HMAC check was skipped ENTIRELY, so
        // anyone could base64 `{"sub":"x","role":"admin","tenantId":"victim"}`,
        // append any third segment, and be admin in any tenant.
        //
        // Environment-conditional security is also why none of this was caught:
        // the test suite ran a different program than production did. The switch
        // is now an explicit flag that defaults to ON, so CI exercises the same
        // code path with the same setting.
        if (REQUIRE_SIGNED_TOKENS) {
            // Cannot verify without a key, so nothing is trusted.
            if (!JWT_SECRET) return null;

            // Comma-separated secrets allow rotation: sign with the first, accept
            // any. Without this, rotating the secret logs every user out at once.
            const secrets = JWT_SECRET.split(',').map(s => s.trim()).filter(Boolean);
            const signingInput = `${encodedHeader}.${encodedPayload}`;
            const sigBuf = Buffer.from(signature!, 'base64url');

            const matched = secrets.some(secret => {
                const expectedBuf = Buffer.from(hmacSign(signingInput, secret), 'base64url');
                return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
            });
            if (!matched) return null;
        }

        const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString());

        // Check expiration
        if (!Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000) ||
            payload.iss !== 'eaos' || payload.aud !== 'eaos-api' ||
            typeof payload.sub !== 'string' || !payload.sub || typeof payload.tenantId !== 'string' || !payload.tenantId ||
            !['user', 'operator', 'admin'].includes(payload.role ?? 'user') ||
            (payload.nbf !== undefined && (!Number.isFinite(payload.nbf) || payload.nbf > Date.now() / 1000)) ||
            (payload.sid !== undefined && typeof payload.sid !== 'string')) {
            return null; // Token expired
        }

        return {
            id: payload.sub ?? payload.id,
            email: payload.email ?? '',
            name: payload.name ?? '',
            role: payload.role ?? 'user',
            teams: payload.teams ?? [],
            personaScopes: payload.personaScopes ?? ['*'],
            tenantId: payload.tenantId,
            sessionId: payload.sid,
            tokenExpiresAt: payload.exp * 1000,
        };
    } catch {
        return null;
    }
}

function hmacSign(data: string, secret: string): string {
    return createHmac('sha256', secret).update(data).digest('base64url');
}

function base64url(str: string): string {
    return Buffer.from(str).toString('base64url');
}

export interface AuthResult {
    authenticated: boolean;
    user?: AuthUser;
    error?: string;
}
