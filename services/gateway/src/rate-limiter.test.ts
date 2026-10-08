import { readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkRateLimit, rateLimitWindowCount } from './model-router.js';
import { applyUnauthenticatedRateLimit, unauthenticatedBudget } from './rate-limiter.js';
import { parseTrustedProxies, type AddressMatcher } from './request-origin.js';

afterEach(() => { vi.useRealTimers(); });

describe('rate-limit windows', () => {
  it('limits a key to its budget within one window', () => {
    for (let call = 0; call < 3; call++) expect(checkRateLimit('fixture-budget', 3).allowed).toBe(true);
    expect(checkRateLimit('fixture-budget', 3).allowed).toBe(false);
    expect(checkRateLimit('fixture-other', 3).allowed).toBe(true);
  });

  it('does not keep the windows of keys that never come back', () => {
    // Unauthenticated keys are per client address or browser session, and clients
    // pick some of those; a map that only ever grows is a memory leak on demand.
    // Far enough ahead that windows opened on the real clock above have expired too.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2099-01-01T00:00:00Z'));
    for (let visitor = 0; visitor < 10_000; visitor++) checkRateLimit(`fixture-visitor-${visitor}`, 10);
    expect(rateLimitWindowCount()).toBeGreaterThanOrEqual(10_000);
    vi.setSystemTime(new Date('2099-01-01T00:02:00Z'));
    checkRateLimit('fixture-next-visitor', 10);
    expect(rateLimitWindowCount()).toBe(1);
  });
});

describe('unauthenticated sign-in calls behind the bundled web proxy', () => {
  // The shipped topology: browsers reach the gateway only through the web tier's
  // /_/gateway rewrite, which adds no X-Forwarded-For, and a first visit carries no
  // cookie. Every visitor is therefore the same subject — the web server — whether
  // or not the operator listed it in EAOS_TRUSTED_PROXIES.
  beforeEach(() => { vi.stubEnv('CORS_ALLOWED_ORIGINS', 'http://localhost:3010'); });
  afterEach(() => { vi.unstubAllEnvs(); });

  const response = () => ({ setHeader() { /* headers are not under test */ } }) as unknown as ServerResponse;
  const firstVisit = (webTier: string) => ({ socket: { remoteAddress: webTier }, headers: { host: 'gateway:3000', origin: 'http://localhost:3010' } });
  const blocked = (webTier: string, trusted: AddressMatcher, method: string, path: string) =>
    applyUnauthenticatedRateLimit(response(), firstVisit(webTier), method, path, trusted)?.blocked ?? false;

  it.each([
    ['listed in EAOS_TRUSTED_PROXIES', '10.89.0.5', parseTrustedProxies('10.89.0.0/24')],
    ['not listed (the compose default)', '10.89.1.5', parseTrustedProxies(undefined)],
  ])('lets 11 distinct first-time visitors load sign-in and start the demo when the web tier is %s', (_label, webTier, trusted) => {
    for (let visitor = 0; visitor < 11; visitor++) {
      expect(blocked(webTier, trusted, 'GET', '/api/auth/config')).toBe(false);
      expect(blocked(webTier, trusted, 'POST', '/api/auth/demo')).toBe(false);
      expect(blocked(webTier, trusted, 'GET', '/api/auth/oidc/authorize')).toBe(false);
    }
  });

  it('never limits the sign-in configuration, which reads flags and nothing else', () => {
    const trusted = parseTrustedProxies('10.89.2.5');
    for (let call = 0; call < 1_000; call++) expect(blocked('10.89.2.5', trusted, 'GET', '/api/auth/config')).toBe(false);
  });

  it('still bounds the calls that create state, and keeps setup-token guesses on the strict budget', () => {
    const trusted = parseTrustedProxies('10.89.3.5');
    const allowed = (method: string, path: string) =>
      Array.from({ length: 70 }, () => blocked('10.89.3.5', trusted, method, path)).filter(refused => !refused).length;
    expect(allowed('POST', '/api/auth/demo')).toBe(60);
    expect(allowed('GET', '/api/auth/oidc/authorize')).toBe(60);
    expect(allowed('POST', '/api/setup')).toBe(10);
  });

  it('keeps per-client buckets when a trusted proxy names the client', () => {
    const trusted = parseTrustedProxies('10.89.4.5');
    const named = (client: string) => applyUnauthenticatedRateLimit(response(), {
      socket: { remoteAddress: '10.89.4.5' }, headers: { host: 'gateway:3000', 'x-forwarded-for': client },
    }, 'POST', '/api/setup', trusted)?.blocked ?? false;
    for (let call = 0; call < 10; call++) expect(named('198.51.100.7')).toBe(false);
    expect(named('198.51.100.7')).toBe(true);
    expect(named('198.51.100.8')).toBe(false);
  });

  it('is configurable in the shipped deployment', () => {
    // The production compose file lists the gateway's environment explicitly, so a
    // setting it omits is silently dropped: operators following the docs set
    // EAOS_TRUSTED_PROXIES (and EAOS_DEMO_MODE=public) and the gateway never saw it.
    const compose = readFileSync(fileURLToPath(new URL('../../../deploy/docker-compose.production.yml', import.meta.url)), 'utf8');
    const gateway = /\n {2}gateway:\n([\s\S]*?)\n {2}\S/.exec(compose)?.[1] ?? '';
    for (const key of ['EAOS_TRUSTED_PROXIES', 'EAOS_DEMO_MODE']) {
      expect(gateway).toMatch(new RegExp(`\\n\\s+- ${key}=\\$\\{${key}(?::-[^}]*)?\\}`));
    }
  });

  it('exempts and widens only the exact method and path', () => {
    expect(unauthenticatedBudget('GET', '/api/auth/config')).toBe('exempt');
    expect(unauthenticatedBudget('POST', '/api/auth/config')).toBe('unauthenticated');
    expect(unauthenticatedBudget('GET', '/api/auth/config/')).toBe('unauthenticated');
    expect(unauthenticatedBudget('POST', '/api/auth/demo')).toBe('signIn');
    expect(unauthenticatedBudget('GET', '/api/auth/demo')).toBe('unauthenticated');
    expect(unauthenticatedBudget('GET', '/api/auth/oidc/authorize')).toBe('signIn');
    expect(unauthenticatedBudget('GET', '/api/auth/oidc/callback')).toBe('unauthenticated');
    expect(unauthenticatedBudget('POST', '/api/auth/token/refresh')).toBe('unauthenticated');
    expect(unauthenticatedBudget('POST', '/api/setup')).toBe('unauthenticated');
  });
});
