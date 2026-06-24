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
    const signingSecret = secret ?? JWT_SECRET;
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
const JWT_SECRET = process.env.JWT_SECRET ?? process.env.AUTH_SECRET ?? '';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
/** Opt-out anonymous fallback in non-prod via explicit env (ALLOW_ANON='false') */
const ALLOW_ANON = process.env.ALLOW_ANON !== 'false';

// Fail fast: refuse to run in production without a signing secret.
if (IS_PRODUCTION && !JWT_SECRET) {
    throw new Error(
        '[auth] FATAL: JWT_SECRET (or AUTH_SECRET) must be set when NODE_ENV=production',
    );
}

export function authenticateRequest(headers: Record<string, string | undefined>): AuthResult {
    // 1. Try X-API-Key header first
    const apiKey = headers['x-api-key'];
    if (apiKey) {
        const user = resolveApiKey(apiKey);
        if (user) return { authenticated: true, user };
        return { authenticated: false, error: 'Invalid API key' };
    }

    // 2. Try Bearer token (JWT)
    const authHeader = headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        // Check if it's a known API key (for backward compat)
        const keyUser = resolveApiKey(token);
        if (keyUser) return { authenticated: true, user: keyUser };

        // Verify as JWT
        try {
            const user = verifyJWT(token);
            if (user) return { authenticated: true, user };
            return { authenticated: false, error: 'Invalid or expired token' };
        } catch {
            return { authenticated: false, error: 'Token verification failed' };
        }
    }

    // 3. Dev-only anonymous fallback. Hard-off in production (per governance moat).
    //    Additionally opt-out-able in any environment via ALLOW_ANON=false.
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
    if (!user.personaScopes || user.personaScopes.length === 0) return true;
    if (user.personaScopes.includes('*')) return true;
    return user.personaScopes.includes(persona as PersonaScope);
}

/** Generate a signed JWT token (for issuing tokens from auth endpoints) */
export function generateJWT(user: AuthUser, expiresInSec = 86400): string {
    const secret = JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET not configured');

    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        sub: user.id,
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

function resolveApiKey(key: string): AuthUser | undefined {
    // Dev mode: direct lookup against the hardcoded demo keys (eos-dev-key, etc.).
    // These keys grant admin/operator and MUST NEVER be honored in production —
    // they are only reachable on this non-production branch.
    if (!IS_PRODUCTION) {
        return DEV_API_KEYS[key];
    }
    // Production: the hardcoded DEV_API_KEYS are rejected outright (never consulted
    // here). Real API keys would be hashed with JWT_SECRET and compared (timing-safe)
    // against DB-stored hashes. We never substitute a predictable constant for the
    // secret, and there is no DB-backed key store wired up yet, so no API key can
    // authenticate in production. The eos-dev-key/eos-demo-key/eos-operator-key
    // demo keys therefore cannot grant access under NODE_ENV=production.
    void key;
    return undefined;
}

function verifyJWT(token: string): AuthUser | null {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        const [encodedHeader, encodedPayload, signature] = parts;

        // Signature verification.
        // Production: MANDATORY — a token whose signature cannot be verified is
        // rejected. (IS_PRODUCTION guarantees JWT_SECRET is set via the fail-fast
        // check at module load, so an unsigned/unverifiable token is rejected.)
        // Development: lenient — if no JWT_SECRET is configured we skip the HMAC
        // path entirely rather than substitute a known/predictable key.
        if (JWT_SECRET) {
            const expectedSig = hmacSign(`${encodedHeader}.${encodedPayload}`, JWT_SECRET);
            const sigBuf = Buffer.from(signature, 'base64url');
            const expectedBuf = Buffer.from(expectedSig, 'base64url');
            if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
                return null; // Signature mismatch
            }
        } else if (IS_PRODUCTION) {
            // Defense-in-depth: never accept an unverifiable token in production.
            return null;
        }

        const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString());

        // Check expiration
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
            return null; // Token expired
        }

        return {
            id: payload.sub ?? payload.id,
            email: payload.email ?? '',
            name: payload.name ?? '',
            role: payload.role ?? 'user',
            teams: payload.teams ?? [],
            personaScopes: payload.personaScopes ?? ['*'],
            tenantId: payload.tenantId ?? 'default',
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
