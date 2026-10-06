import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryStore } from '../../../packages/db/src/connection.js';
import type { AuthUser } from './auth.js';

let sessions: typeof import('./auth-sessions.js');
const user: AuthUser = { id: 'a', tenantId: 'tenant-a', role: 'user', name: '', email: '', teams: [], personaScopes: ['engineering'] };
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('JWT_SECRET', 'fixture-auth-session-signing-key');
  sessions = await import('./auth-sessions.js');
  sessions.initAuthSessions(new InMemoryStore());
});
describe('durable browser session lifecycle', () => {
  it('rotates refresh credentials and revokes the family on reuse', async () => {
    const first = await sessions.createBrowserSession(user);
    const second = await sessions.refreshBrowserSession(first.refreshToken);
    expect(second?.refreshToken).not.toBe(first.refreshToken);
    expect(await sessions.getSessionUser(first.user.sessionId!)).toMatchObject({ id: user.id });
    expect(await sessions.refreshBrowserSession(first.refreshToken)).toBeUndefined();
    expect(await sessions.getSessionUser(first.user.sessionId!)).toBeUndefined();
    expect(await sessions.refreshBrowserSession(second!.refreshToken)).toBeUndefined();
  });
  it('does not revoke a session for an unknown random credential', async () => {
    const issued = await sessions.createBrowserSession(user);
    expect(await sessions.refreshBrowserSession(`${issued.user.sessionId}.invalid`)).toBeUndefined();
    expect(await sessions.getSessionUser(issued.user.sessionId!)).toBeDefined();
  });
  it('invalidates access after logout', async () => {
    const issued = await sessions.createBrowserSession(user);
    await sessions.revokeBrowserSession(issued.user.sessionId!);
    expect(await sessions.getSessionUser(issued.user.sessionId!)).toBeUndefined();
  });
  it('makes OIDC handoff codes one-time and browser-bound', async () => {
    const code = sessions.issueLoginCode(user, 'browser-binding');
    expect(sessions.consumeLoginCode(code, 'wrong-browser')).toBeUndefined();
    expect(sessions.consumeLoginCode(code, 'browser-binding')).toBeUndefined();
    const valid = sessions.issueLoginCode(user, 'browser-binding');
    expect(sessions.consumeLoginCode(valid, 'browser-binding')).toMatchObject({ id: user.id });
    expect(sessions.consumeLoginCode(valid, 'browser-binding')).toBeUndefined();
  });
});
