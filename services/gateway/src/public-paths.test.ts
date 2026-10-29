/**
 * The allowlist and the router must agree.
 *
 * `isPublicPath()` runs ahead of `authenticateRequest` for every request, so an
 * entry here is a promise that the path is reachable without a credential. Four
 * entries did not keep that promise — `/api/setup`, `/api/auth/login`,
 * `/api/auth/token/refresh` and `/api/auth/oidc/exchange` were declared public
 * and had no handler at all, so they answered 404 to the very clients that
 * needed them to obtain a credential. `/metrics` was declared while the real
 * route was `/api/metrics`.
 *
 * That is worse than the bug it replaced. Before the allowlist the gateway 401'd
 * everything including its own healthcheck; after it, the probes pass and there
 * is still no way to authenticate — a failure that looks like success from the
 * outside.
 *
 * This test is the counter for that class of defect. It parses `server.ts` as
 * text rather than booting the server, so it stays a unit test: no port, no
 * store, no LLM provider.
 *
 * It is also the first caller of `listPublicPaths()`, which was written "for the
 * generated auth deny-matrix test" and then had none for the entire life of the
 * file.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isPublicPath, listPublicPaths } from './public-paths.js';

const serverSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'server.ts'),
  'utf8',
);

/**
 * Does `server.ts` route this exact path?
 *
 * Routing is a 5,000-line `if`-cascade of `path === '<literal>' && method === 'X'`
 * guards, so a literal match on the source is an accurate test of reachability
 * and needs no server process. Guards are written in both orders, and some
 * compare `method` first, so the two clauses are checked independently on the
 * same source line.
 */
function hasRouteFor(method: string, path: string): boolean {
  const lines = serverSource.split('\n');
  return lines.some(line => {
    const matchesPath =
      line.includes(`path === '${path}'`) || line.includes(`path === "${path}"`);
    if (!matchesPath) return false;
    // A guard with no method clause handles every method.
    if (!line.includes('method ===')) return true;
    return line.includes(`method === '${method}'`) || line.includes(`method === "${method}"`);
  });
}

describe('public paths — every declared entry is actually routed', () => {
  for (const entry of listPublicPaths()) {
    it(`${entry.method} ${entry.path} has a handler in server.ts`, () => {
      expect(
        hasRouteFor(entry.method, entry.path),
        `${entry.method} ${entry.path} is declared public but server.ts has no ` +
          `\`path === '${entry.path}'\` guard, so it returns 404. A declared-public ` +
          `path with no handler is a dead bootstrap route: either add the handler ` +
          `or remove the entry.`,
      ).toBe(true);
    });
  }
});

describe('public paths — the allowlist cannot widen by accident', () => {
  it('matches exactly, never by prefix', () => {
    // `/api/auth/oidc/authorize` is public. A prefix-matching implementation
    // would also expose every future route beneath `/api/auth/oidc/`.
    expect(isPublicPath('GET', '/api/auth/oidc/authorize')).toBe(true);
    expect(isPublicPath('GET', '/api/auth/oidc/authorize/admin')).toBe(false);
    expect(isPublicPath('GET', '/api/auth')).toBe(false);
    expect(isPublicPath('GET', '/api/auth/oidc')).toBe(false);
  });

  it('does not let a public GET open the same path to writes', () => {
    expect(isPublicPath('GET', '/api/health')).toBe(true);
    expect(isPublicPath('POST', '/api/health')).toBe(false);
    expect(isPublicPath('DELETE', '/api/health')).toBe(false);
  });

  it('keeps the protected surface protected', () => {
    // A representative sample. If any of these ever go public it is a finding,
    // not a refactor.
    for (const path of [
      '/api/skills',
      '/api/personas',
      '/api/connections',
      '/api/metrics',
      '/api/auth/me',
      '/api/users/apikeys',
      '/api/governance/audit',
    ]) {
      expect(isPublicPath('GET', path), `${path} must require a credential`).toBe(false);
      expect(isPublicPath('POST', path), `${path} must require a credential`).toBe(false);
    }
  });

  it('exempts preflight, which carries no credentials by design', () => {
    expect(isPublicPath('OPTIONS', '/api/anything')).toBe(true);
  });

  it('requires a stated reason on every entry', () => {
    // The reason is the review artifact. An entry without one is an entry
    // nobody argued for.
    for (const entry of listPublicPaths()) {
      expect(entry.reason.length, `${entry.path} needs a reason`).toBeGreaterThan(20);
    }
  });
});
