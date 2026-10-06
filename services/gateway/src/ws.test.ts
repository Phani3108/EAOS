import http from 'node:http';
import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from './auth.js';
const bridge = vi.hoisted(() => ({ receive: undefined as ((channel: string, payload: string) => void) | undefined }));
vi.mock('./redis-client.js', async () => {
  const { default: Redis } = await import('ioredis') as any;
  return {
    getRedis: async () => ({ publish: async () => 0 }),
    redisUrl: () => 'redis://test',
    connectRedis: async () => { const client = new Redis(); await client.connect(); return client; },
  };
});
vi.mock('ioredis', () => ({ default: class {
  async connect() {}
  async subscribe() {}
  on(_event: string, listener: typeof bridge.receive) { bridge.receive = listener; }
} }));
import { attachWebSocket, broadcastEvent, disconnectStreamUser } from './ws.js';
import { canReadStreamResource, consumeStreamTicket, issueStreamTicket } from './stream-access.js';

const user: AuthUser = { id: 'a', tenantId: 'tenant-a', role: 'user', email: '', name: '', teams: [] };
const sockets: net.Socket[] = [];
const servers: http.Server[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

async function handshake(authorization?: string, authorize: (principal: AuthUser, channel: string) => boolean | Promise<boolean> = () => false) {
  const server = http.createServer();
  servers.push(server);
  attachWebSocket(server, { authenticate: async req => req.headers.authorization === 'Bearer valid' ? user : undefined, authorize });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as net.AddressInfo;
  return new Promise<string>((resolve, reject) => {
    const socket = net.connect(address.port, '127.0.0.1', () => {
      socket.write(`GET /ws HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n${authorization ? `Authorization: ${authorization}\r\n` : ''}\r\n`);
    });
    sockets.push(socket);
    socket.once('data', data => resolve(data.toString()));
    socket.once('error', reject);
    socket.setTimeout(2000, () => reject(new Error('Handshake timed out')));
  });
}

function frame(value: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(value));
  const mask = Buffer.from([1, 2, 3, 4]);
  for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ mask[i % 4]!;
  return Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, payload]);
}

describe('stream authentication', () => {
  it('filters both local and Redis delivery and rechecks resource access', async () => {
    let allowed = true;
    const authorize = vi.fn(async (_principal: AuthUser, channel: string) => allowed && channel === 'owned');
    await handshake('Bearer valid', authorize);
    const socket = sockets.at(-1)!;
    let received = '';
    socket.on('data', data => { received += data.toString(); });
    const subscribe = frame({ type: 'subscribe', channel: 'owned' });
    socket.write(subscribe.subarray(0, 3));
    socket.write(subscribe.subarray(3));
    await vi.waitFor(() => expect(authorize).toHaveBeenCalled());
    broadcastEvent('other', 'test', { text: 'foreign-local' }, user.tenantId);
    broadcastEvent('owned', 'test', { text: 'foreign-tenant-same-id' }, 'tenant-b');
    broadcastEvent('owned', 'test', { text: 'visible-local' }, user.tenantId);
    await vi.waitFor(() => expect(received).toContain('visible-local'));
    await vi.waitFor(() => expect(bridge.receive).toBeDefined());
    bridge.receive!('events', JSON.stringify({ instanceId: 'remote', tenantId: user.tenantId, sessionId: 'other', type: 'test', data: { text: 'foreign-redis' } }));
    bridge.receive!('events', JSON.stringify({ instanceId: 'remote', tenantId: user.tenantId, sessionId: 'owned', type: 'test', data: { text: 'visible-redis' } }));
    await vi.waitFor(() => expect(received).toContain('visible-redis'));
    bridge.receive!('events', JSON.stringify({ instanceId: 'remote', tenantId: 'tenant-b', sessionId: 'owned', type: 'test', data: { text: 'foreign-tenant-redis' } }));
    allowed = false;
    broadcastEvent('owned', 'test', { text: 'revoked-access' }, user.tenantId);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(received).not.toContain('foreign-');
    expect(received).not.toContain('revoked-access');
  });
  it('invalidates pending tickets on logout or credential revocation', () => {
    const ticket = issueStreamTicket(user);
    disconnectStreamUser(user);
    expect(consumeStreamTicket(ticket)).toBeUndefined();
  });
  it('rejects wildcard subscriptions even if a policy accidentally allows them', async () => {
    await handshake('Bearer valid', () => true);
    const socket = sockets.at(-1)!;
    const closed = new Promise<void>(resolve => socket.once('close', () => resolve()));
    socket.write(frame({ type: 'subscribe', sessionId: '*' }));
    await closed;
  });
  it('rejects anonymous upgrades', async () => expect(await handshake()).toContain('401'));
  it('rejects invalid credentials', async () => expect(await handshake('Bearer invalid')).toContain('401'));
  it('accepts a verified principal', async () => expect(await handshake('Bearer valid')).toContain('101'));
  it('makes browser tickets short-lived and single-use', () => {
    const ticket = issueStreamTicket(user, 100);
    expect(consumeStreamTicket(ticket, 101)).toMatchObject(user);
    expect(consumeStreamTicket(ticket, 102)).toBeUndefined();
    expect(consumeStreamTicket(issueStreamTicket(user, 100), 30_100)).toBeUndefined();
  });
  it('never grants tenant administrators access to another tenant', () => {
    expect(canReadStreamResource({ ...user, role: 'admin' }, { tenantId: 'tenant-b', userId: 'a' })).toBe(false);
    expect(canReadStreamResource(user, { tenantId: 'tenant-a', userId: 'b' })).toBe(false);
    expect(canReadStreamResource(user, { tenantId: 'tenant-a', userId: 'a' })).toBe(true);
    expect(canReadStreamResource(user, { userId: 'a' })).toBe(false);
  });
});
