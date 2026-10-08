import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkRateLimit, rateLimitWindowCount } from './model-router.js';

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
