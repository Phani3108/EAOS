/**
 * Paths reachable without a credential.
 *
 * Why this exists
 * ----------------------------------------------------------------------------
 * The gateway was unreachable in production by construction. `authenticateRequest`
 * ran ahead of every route with no exemptions, so:
 *
 *   - `/api/health` and `/api/ready` returned 401. Container healthchecks,
 *     load-balancer probes and the CI smoke test could therefore never pass, and
 *     an orchestrator would restart-loop a perfectly healthy process.
 *   - The only two ways to obtain a credential — `POST /api/auth/token` and the
 *     OIDC authorize/callback handshake — sat behind the gate they were meant to
 *     open. With the anonymous fallback disabled in production and
 *     `resolveApiKey()` returning undefined there, no principal could ever be
 *     minted. There was no bootstrap path.
 *
 * Design rules
 * ----------------------------------------------------------------------------
 *  1. **Exact method + path matches only.** No prefix or regex matching, so an
 *     entry can never silently widen to a subtree. `/api/auth` must not exempt
 *     `/api/auth/admin-tokens`.
 *  2. **Additions are a security review.** Anything added here is world-readable
 *     or world-callable. The list is short and every entry carries its reason.
 *  3. Handlers on these paths still enforce their own rules — `/api/setup`
 *     requires a setup token and is single-use; the OIDC callback validates
 *     state and nonce.
 */

interface PublicPath {
  method: 'GET' | 'POST' | 'OPTIONS';
  path: string;
  /** Why this is safe to expose. Required. */
  reason: string;
}

const PUBLIC_PATHS: readonly PublicPath[] = [
  // ── Probes ────────────────────────────────────────────────────────────────
  {
    method: 'GET',
    path: '/api/live',
    reason: 'Liveness. Process-up only, no dependencies, no tenant data.',
  },
  {
    method: 'GET',
    path: '/api/ready',
    reason:
      'Readiness for a load balancer. Reports dependency reachability as booleans, never values or counts.',
  },
  {
    method: 'GET',
    path: '/api/health',
    reason:
      'Container healthcheck. Must be unauthenticated or the container never becomes healthy. ' +
      'Detailed fields are gated inside the handler.',
  },
  // NOTE: there is deliberately no `/metrics` entry.
  //
  // It was declared here with the reason "aggregate counters only", and both
  // halves of that were false: no `/metrics` route exists (the real one is
  // `/api/metrics`, so the declared path simply 404'd), and `/api/metrics`
  // returns JSON including `llm.cost_meter` and per-provider circuit state —
  // i.e. spend. Publishing that unauthenticated tells the internet what a tenant
  // is spending and which providers are failing.
  //
  // Probes are already covered by `/api/live` and `/api/ready`. If a Prometheus
  // scrape target is needed later it should be a separate `text/plain` endpoint
  // exposing request/error/latency/uptime counters only, behind an explicit
  // opt-in flag — not this route.

  // ── Credential acquisition ────────────────────────────────────────────────
  {
    method: 'POST',
    path: '/api/setup',
    reason:
      'First-run bootstrap. Requires EAOS_SETUP_TOKEN and returns 410 once a tenant exists, ' +
      'so it is single-use and unusable without the operator-supplied secret.',
  },
  {
    method: 'GET',
    path: '/api/auth/oidc/authorize',
    reason: 'Starts the OIDC redirect. Cannot require a credential — it exists to obtain one.',
  },
  {
    method: 'GET',
    path: '/api/auth/oidc/callback',
    reason: 'OIDC redirect target. Validates state and nonce inside the handler.',
  },
  {
    method: 'POST',
    path: '/api/auth/oidc/exchange',
    reason:
      'Exchanges a one-time code for a token. Replaces returning the JWT in a URL query string, ' +
      'which leaked it into browser history, Referer headers and proxy logs.',
  },
  // NOTE: there is deliberately no `/api/auth/login` entry.
  //
  // It was declared as "password/token login" — but there are no passwords in
  // this system. The `users` table has no password_hash column, and
  // `authenticateRequest` accepts exactly two credential types: an API key and
  // an HS256 JWT. Implementing it would mean inventing a password store,
  // hashing, reset, and lockout — a whole subsystem, to justify an allowlist
  // entry that was added by mistake.
  //
  // The credential chain that does exist:
  //   EAOS_SETUP_TOKEN → POST /api/setup → API key → POST /api/auth/token → JWT
  //   or: OIDC authorize → callback → exchange → JWT
  {
    method: 'GET',
    path: '/api/auth/config',
    reason:
      'Tells the sign-in screen which options exist (demo mode, SSO). Booleans and an enum only; ' +
      'no tenant data, no secrets.',
  },
  {
    method: 'POST',
    path: '/api/auth/demo',
    reason:
      'Mints an isolated demo-visitor session when EAOS_DEMO_MODE=public (404 otherwise). The principal ' +
      'is a fresh role=user identity whose runs are forced to simulation, so it can neither spend LLM ' +
      'budget nor read another visitor\'s work. Rate limited per client on the sign-in budget (rate-limiter.ts).',
  },
  {
    method: 'POST',
    path: '/api/auth/token/refresh',
    reason:
      'Refresh flow. Authenticated by the HttpOnly refresh cookie, not the Authorization ' +
      'header, so it cannot require one. Single-use: rotation revokes the whole family on reuse.',
  },
];

/** Exact method+path match. Deliberately not prefix-based. */
export function isPublicPath(method: string, path: string): boolean {
  // Preflight carries no credentials by design.
  if (method === 'OPTIONS') return true;
  return PUBLIC_PATHS.some(p => p.method === method && p.path === path);
}

/** Introspection for docs and for the generated auth deny-matrix test. */
export function listPublicPaths(): readonly PublicPath[] {
  return PUBLIC_PATHS;
}
