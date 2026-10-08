/**
 * Gateway-level rate limiter.
 * Wraps model-router's checkRateLimit() with per-role / per-persona limits
 * and sets standard rate-limit response headers.
 */

import { checkRateLimit } from './model-router.js';
import type { AuthUser } from './auth.js';
import type { ServerResponse } from 'node:http';
import { rateLimitSubject, type AddressMatcher } from './request-origin.js';

// ---------------------------------------------------------------------------
// Limits (requests per minute)
// ---------------------------------------------------------------------------

const LIMITS = {
  unauthenticated: 10,
  /** The calls that start a sign-in; see unauthenticatedBudget. */
  signIn: 60,
  user: 120,
  operator: 300,
  admin: 500,
  persona: {
    engineering: 30,
    product: 30,
    hr: 20,
    marketing: 60,
    'talent-acquisition': 20,
    'program-management': 30,
  } as Record<string, number>,
};

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  blocked: boolean;
  limit: number;
  remaining: number;
  resetInMs: number;
}

/**
 * Check and enforce gateway rate limits.
 * Sets X-RateLimit-* headers on the response object.
 * Returns `{ blocked: true }` when the caller should return 429.
 */
export function applyRateLimit(
  res: ServerResponse,
  userId: string,
  role: AuthUser['role'] | Exclude<UnauthenticatedBudget, 'exempt'> = 'unauthenticated',
  persona?: string,
): RateLimitResult {
  // Per-user global limit
  const roleLimits = LIMITS as Record<string, number | Record<string, number>>;
  const globalMax = (typeof roleLimits[role] === 'number' ? roleLimits[role] : LIMITS.user) as number;
  const globalKey = `gw:${userId}:global`;
  const global = checkRateLimit(globalKey, globalMax);

  // Per-persona limit (stricter)
  let personaResult = global;
  if (persona && persona in LIMITS.persona) {
    const personaMax = LIMITS.persona[persona];
    const personaKey = `gw:${userId}:persona:${persona}`;
    personaResult = checkRateLimit(personaKey, personaMax);
  }

  // Most restrictive of the two
  const blocked = !global.allowed || !personaResult.allowed;
  const remaining = Math.min(global.remaining, personaResult.remaining);
  const resetInMs = Math.max(global.resetInMs, personaResult.resetInMs);
  const limit = Math.min(globalMax, persona && LIMITS.persona[persona] ? LIMITS.persona[persona] : globalMax);

  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, remaining)));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetInMs / 1000)));

  return { blocked, limit, remaining, resetInMs };
}

// ---------------------------------------------------------------------------
// Unauthenticated (public-path) requests
// ---------------------------------------------------------------------------

export type UnauthenticatedBudget = 'exempt' | 'signIn' | 'unauthenticated';

/**
 * Which budget a request without a principal draws on.
 *
 * rateLimitSubject tells clients apart only when something in front of the web
 * tier forwards their addresses (or the browser already holds sign-in material).
 * The bundled deployment has no such edge: the Next rewrite adds no
 * X-Forwarded-For, so a visitor's FIRST calls — which carry no cookie either —
 * all key on the web server, and at 10 a minute the 11th visitor of the minute
 * could not load the sign-in screen or start the demo. Those calls therefore get
 * budgets that hold up even when the subject is the whole deployment:
 *
 *  - GET /api/auth/config is exempt, like the health probes. It reads three
 *    flags from configuration — no storage, no credential check, no state — so a
 *    limit protects nothing, and it decides whether the sign-in screen renders.
 *  - POST /api/auth/demo and GET /api/auth/oidc/authorize get `signIn`. They do
 *    create state (a visitor and its session; a pending SSO state, capped in
 *    oidc-provider.ts), so they stay bounded, but at a rate a busy public demo
 *    does not reach.
 *  - Everything else keeps the strict limit: /api/setup is a setup-token guess
 *    that SHOULD share one bucket, and the refresh/callback/exchange paths key on
 *    the browser's own session or login binding when the client is unknown.
 *
 * A single client can still spend the `signIn` budget for everyone when the
 * subject is the deployment; a per-client limit needs a proxy that names the
 * client (EAOS_TRUSTED_PROXIES), and nothing short of that can provide one.
 */
export function unauthenticatedBudget(method: string, path: string): UnauthenticatedBudget {
  if (method === 'GET' && path === '/api/auth/config') return 'exempt';
  if ((method === 'POST' && path === '/api/auth/demo') || (method === 'GET' && path === '/api/auth/oidc/authorize')) return 'signIn';
  return 'unauthenticated';
}

/**
 * The rate limit for a request without a principal: its budget, charged to the
 * client as rateLimitSubject attributes it, per path. `undefined` when exempt.
 */
export function applyUnauthenticatedRateLimit(
  res: ServerResponse,
  req: Parameters<typeof rateLimitSubject>[0],
  method: string,
  path: string,
  trusted: AddressMatcher,
): RateLimitResult | undefined {
  const budget = unauthenticatedBudget(method, path);
  if (budget === 'exempt') return undefined;
  return applyRateLimit(res, `${rateLimitSubject(req, trusted)}:${path}`, budget);
}
