import { beforeEach, describe, expect, it } from 'vitest';
import { _importSessions, addMessage, archiveSession, configureChatRepository, createSession, getSession, listMessages, listSessions } from './chat-store.js';

const owner = { userId: 'user-a', tenantId: 'tenant-a' };
const otherUser = { userId: 'user-b', tenantId: 'tenant-a' };
const otherTenant = { userId: 'user-a', tenantId: 'tenant-b' };

beforeEach(() => { configureChatRepository(undefined); _importSessions({ sessions: [] }); });

describe('chat ownership', () => {
  it('records the verified tenant on creation', async () => {
    expect((await createSession(owner)).tenantId).toBe(owner.tenantId);
  });
  it('requires a nonempty tenant and user', async () => {
    await expect(createSession({ ...owner, tenantId: '' })).rejects.toThrow();
    await expect(createSession({ ...owner, userId: '' })).rejects.toThrow();
  });
  it('allows only the owning user in the owning tenant to read', async () => {
    const session = await createSession(owner);
    expect(await getSession(session.sessionId, owner)).toEqual(session);
    expect(await getSession(session.sessionId, otherUser)).toBeUndefined();
    expect(await getSession(session.sessionId, otherTenant)).toBeUndefined();
  });
  it('scopes listings even when user IDs coincide across tenants', async () => {
    const session = await createSession(owner);
    await createSession(otherTenant);
    expect((await listSessions(owner)).map(s => s.sessionId)).toEqual([session.sessionId]);
    expect(await listSessions(otherUser)).toEqual([]);
  });
  it('does not let another principal archive a conversation', async () => {
    const session = await createSession(owner);
    expect(await archiveSession(session.sessionId, otherTenant)).toBe(false);
    expect(await archiveSession(session.sessionId, otherUser)).toBe(false);
    expect(await getSession(session.sessionId, owner)).toBeDefined();
    expect(await archiveSession(session.sessionId, owner)).toBe(true);
    expect(await getSession(session.sessionId, owner)).toBeUndefined();
    expect(await listSessions(owner)).toEqual([]);
  });
  it('does not assign legacy unscoped sessions to a requesting tenant', async () => {
    const session = await createSession(owner);
    const { tenantId, ...legacy } = session;
    _importSessions({ sessions: [legacy as typeof session] });
    expect(await getSession(session.sessionId, owner)).toBeUndefined();
    expect(await listSessions(owner)).toEqual([]);
  });
  it('requires the owner for message writes and prevents late replies after archive', async () => {
    const session = await createSession(owner);
    expect(await addMessage({ ...otherTenant, sessionId: session.sessionId, role: 'user', content: 'denied' })).toBeUndefined();
    await addMessage({ ...owner, sessionId: session.sessionId, role: 'user', content: 'fixture' });
    expect(await listMessages(session.sessionId, otherUser)).toEqual([]);
    expect(await listMessages(session.sessionId, owner)).toHaveLength(1);
    await archiveSession(session.sessionId, owner);
    expect(await addMessage({ ...owner, sessionId: session.sessionId, role: 'agent', content: 'late' })).toBeUndefined();
  });
});
