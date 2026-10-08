import { describe, expect, it } from 'vitest';
import { getAvailableProviders, PROVIDER_CALL_TIMEOUT_MS } from './llm-provider.js';
import { REVIEW_DEADLINE_MS } from './review-pipeline.js';

// Browsers reach this gateway through the web tier's /_/gateway rewrite. If that
// proxy gives up before a synchronous route answers, the user sees a bare 500
// while the provider calls behind it are still billed, so the web tier's budget
// must stay above every bound the gateway enforces on a synchronous LLM route.
describe('web proxy timeout', () => {
  it('outlasts the gateway synchronous LLM routes', async () => {
    const configUrl = new URL('../../../apps/web/next.config.mjs', import.meta.url).href;
    const { default: nextConfig, GATEWAY_PROXY_TIMEOUT_MS } = await import(configUrl);
    const proxyTimeout = nextConfig.experimental?.proxyTimeout;
    expect(proxyTimeout).toBe(GATEWAY_PROXY_TIMEOUT_MS);
    // Finite: a hung gateway must not hold proxy sockets forever.
    expect(Number.isFinite(proxyTimeout)).toBe(true);
    expect(proxyTimeout).toBeGreaterThan(REVIEW_DEADLINE_MS);
    // A chat reply is one callLLM, which may fall back through every provider.
    expect(proxyTimeout).toBeGreaterThan(getAvailableProviders().length * PROVIDER_CALL_TIMEOUT_MS);
  });
});
