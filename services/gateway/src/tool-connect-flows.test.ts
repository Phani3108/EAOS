import { describe, expect, it } from 'vitest';
import { beginToolAuthorization, consumeToolAuthorization } from './tool-connect-flows.js';
import { renderOAuthResultHtml } from './oauth-callback.js';
import type { AuthUser } from './auth.js';

const user: AuthUser = { id: 'a', tenantId: 'tenant-a', sessionId: 'session-a', role: 'admin', email: '', name: '', teams: [] };
describe('connector authorization boundaries', () => {
  it('binds single-use state to the connector, tenant and browser session', () => {
    const flow = { toolId: 'hubspot', authType: 'oauth' as const, oauthUrl: 'https://identity.example.invalid/authorize', redirectUri: 'https://app.example.invalid/callback' };
    const url = new URL(beginToolAuthorization(flow, user));
    const state = url.searchParams.get('state')!;
    expect(consumeToolAuthorization(state, 'hubspot', { ...user, sessionId: 'other' })).toBeUndefined();
    expect(consumeToolAuthorization(state, 'hubspot', user)).toBeUndefined();
    const next = new URL(beginToolAuthorization(flow, user)).searchParams.get('state')!;
    expect(consumeToolAuthorization(next, 'hubspot', user)?.redirectUri).toBe(flow.redirectUri);
    expect(consumeToolAuthorization(next, 'hubspot', user)).toBeUndefined();
  });
  it('does not permit callback messages to break out of script context', () => {
    const html = renderOAuthResultHtml('fixture', false, '</script><script>window.fixture=true</script>');
    expect(html).not.toContain('<script>window.fixture=true');
    expect(html).not.toContain("}, '*')");
  });
});
