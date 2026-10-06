/**
 * Gateway WebSocket Server — Live Execution Streaming with Backpressure
 *
 * Provides real-time streaming of execution events to connected clients.
 * Uses RFC 6455 WebSocket framing with per-client backpressure tracking.
 *
 * Protocol:
 *   Client sends:   { type: 'subscribe', sessionId: string }
 *                   { type: 'subscribe', channel: string }
 *                   { type: 'unsubscribe', sessionId: string }
 *                   { type: 'unsubscribe', channel: string }
 *   Server sends:   StreamEvent JSON
 *
 * Backpressure:
 *   - Each client has a writableLength threshold (1 MB).
 *   - Clients exceeding threshold for 3 consecutive ticks are disconnected.
 *   - Per-client ring buffer (64 slots) for messages during backpressure.
 *   - Overflow of ring buffer → disconnect.
 *
 * Connect: ws://localhost:3000/ws
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import { createHash, randomUUID } from 'node:crypto';
import type http from 'node:http';
import type { Duplex } from 'node:stream';
import { getRedis } from './redis-client.js';
import type { AuthUser } from './auth.js';
import { consumeStreamTicket, isAllowedBrowserOrigin, revokeStreamTickets } from './stream-access.js';

const WS_CHANNEL = 'agentos:ws:events';
const INSTANCE_ID = randomUUID();

// Initialize Redis pub/sub for multi-instance broadcast on startup
(async () => {
    try {
        const redis = await getRedis();
        if (!redis) return;

        // Subscriber uses a dedicated connection
        const { default: Redis } = await import('ioredis') as any;
        const sub = new Redis((process.env.REDIS_URL ?? 'redis://localhost:6379'), {
            lazyConnect: true, connectTimeout: 3000, maxRetriesPerRequest: 1, enableOfflineQueue: false,
        });
        await sub.connect();
        await sub.subscribe(WS_CHANNEL);
        sub.on('message', (_ch: string, msg: string) => {
            try { if (JSON.parse(msg).instanceId === INSTANCE_ID) return; } catch { return; }
            // Deliver to all local WS clients
            for (const client of clients) {
                writeToClient(client, msg);
            }
        });
    } catch { /* Redis unavailable — single-instance mode */ }
})();

// ---------------------------------------------------------------------------
// Types & Constants
// ---------------------------------------------------------------------------

const BACKPRESSURE_THRESHOLD_BYTES = 1_048_576; // 1 MB
const SLOW_TICKS_BEFORE_DISCONNECT = 3;
const RING_BUFFER_SIZE = 64;
const STALL_TIMEOUT_MS = 2_000;

interface WSClient {
    socket: Duplex;
    user: AuthUser;
    expiresAt: number;
    authorize: (user: AuthUser, channel: string) => boolean | Promise<boolean>;
    /** Legacy session-ID subscriptions (kept for backwards compatibility) */
    subscriptions: Set<string>;
    /** New channel-based subscriptions (agents, chat:<id>, execution:<id>) */
    channels: Set<string>;
    alive: boolean;
    /** Number of consecutive ticks where writableLength exceeded threshold */
    slowTicks: number;
    /** Buffered messages when socket is draining */
    pendingBuffer: string[];
    /** Total messages dropped for this client */
    droppedCount: number;
    /** Last time the socket drained below threshold */
    lastDrainAt: number;
    connectedAt: number;
    delivery: Promise<void>;
    queuedChecks: number;
}

type BroadcastEvent = {
    instanceId: string;
    tenantId: string;
    type: string;
    sessionId: string;
    timestamp: string;
    data: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// WebSocket Server State
// ---------------------------------------------------------------------------

const clients = new Set<WSClient>();
let totalDroppedMessages = 0;
let totalDisconnectedForSlow = 0;

/**
 * Attach WebSocket handling to an existing HTTP server.
 */
export interface StreamAuthOptions {
    authenticate: (req: http.IncomingMessage) => Promise<AuthUser | undefined>;
    authorize: (user: AuthUser, channel: string) => boolean | Promise<boolean>;
}

export function attachWebSocket(server: http.Server, options: StreamAuthOptions = { authenticate: async () => undefined, authorize: () => false }): void {
    server.on('upgrade', async (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
        socket.on('error', () => socket.destroy());
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!['/ws', '/_/gateway/ws'].includes(url.pathname)) {
            socket.destroy();
            return;
        }

        const key = req.headers['sec-websocket-key'];
        if (req.method !== 'GET' || req.headers['sec-websocket-version'] !== '13' || typeof key !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(key)) {
            socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
            return;
        }
        const protocols = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map(value => value.trim());
        const ticket = protocols.find(value => value.startsWith('eaos-ticket.'))?.slice('eaos-ticket.'.length);
        if ((req.headers.origin || ticket) && !isAllowedBrowserOrigin(req.headers.origin)) {
            socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
            return;
        }
        let user: AuthUser | undefined;
        try { user = ticket ? consumeStreamTicket(ticket) : await options.authenticate(req); } catch {}
        if (!user?.id || user.id === 'anonymous' || !user.tenantId) {
            socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
            return;
        }

        // Compute accept key per RFC 6455
        const MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
        const accept = createHash('sha1')
            .update(key + MAGIC)
            .digest('base64');

        socket.write(
            'HTTP/1.1 101 Switching Protocols\r\n' +
            'Upgrade: websocket\r\n' +
            'Connection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${accept}\r\n` +
            (protocols.includes('eaos') ? 'Sec-WebSocket-Protocol: eaos\r\n' : '') +
            '\r\n',
        );

        const now = Date.now();
        const client: WSClient = {
            socket,
            user,
            expiresAt: Math.min(user.tokenExpiresAt ?? Infinity, now + 15 * 60_000),
            authorize: options.authorize,
            subscriptions: new Set(),
            channels: new Set(),
            alive: true,
            slowTicks: 0,
            pendingBuffer: [],
            droppedCount: 0,
            lastDrainAt: now,
            connectedAt: now,
            delivery: Promise.resolve(),
            queuedChecks: 0,
        };
        clients.add(client);

        // When socket drains, try to flush the ring buffer
        socket.on('drain', () => {
            client.lastDrainAt = Date.now();
            client.slowTicks = 0;
            flushPending(client);
        });

        let incoming = Buffer.alloc(0);
        const receive = async (): Promise<void> => {
            let parsed: ReturnType<typeof decodeFrame>;
            try { parsed = decodeFrame(incoming); } catch { removeClient(client); return; }
            if (!parsed) return;
            incoming = incoming.subarray(parsed.bytesRead);

            if (parsed.opcode === 0x8) {
                // Close frame
                removeClient(client);
                return;
            }

            if (parsed.opcode === 0x9) {
                socket.write(encodeFrame(0xa, parsed.payload));
                return;
            }
            if (parsed.opcode === 0xa) {
                // Pong
                client.alive = true;
                return;
            }

            if (parsed.opcode === 0x1) {
                // Text frame
                try {
                    const msg = JSON.parse(parsed.payload) as {
                        type: string;
                        sessionId?: string;
                        channel?: string;
                    };
                    if (msg.type === 'subscribe') {
                        const channel = msg.channel ?? msg.sessionId;
                        if (typeof channel !== 'string' || !channel || channel === '*' || client.expiresAt <= Date.now() ||
                            !(await client.authorize(client.user, channel)) || client.channels.size + client.subscriptions.size >= 64) {
                            removeClient(client);
                            return;
                        }
                        if (msg.sessionId) client.subscriptions.add(channel);
                        if (msg.channel) client.channels.add(channel);
                        writeToClient(client, JSON.stringify({ type: 'stream.subscribed', tenantId: client.user.tenantId, sessionId: channel, data: {} }));
                    } else if (msg.type === 'unsubscribe') {
                        if (msg.sessionId) client.subscriptions.delete(msg.sessionId);
                        if (msg.channel) client.channels.delete(msg.channel);
                    }
                } catch {
                    // Ignore malformed messages
                }
            }
        };
        let receiving = false;
        socket.on('data', (buf: Buffer) => {
            if (incoming.length + buf.length > 65536) { removeClient(client); return; }
            incoming = Buffer.concat([incoming, buf]);
            if (receiving) return;
            receiving = true;
            void (async () => {
                try {
                    while (incoming.length >= 2 && !socket.destroyed) {
                        const before = incoming;
                        await receive();
                        if (incoming === before) break;
                    }
                } finally { receiving = false; }
            })().catch(() => removeClient(client));
        });
        if (head.length) socket.emit('data', head);
        socket.on('end', () => removeClient(client));

        socket.on('close', () => removeClient(client));
        socket.on('error', () => removeClient(client));
    });

    // Heartbeat + backpressure sweep every 1s (faster than old 30s heartbeat
    // because backpressure checks want sub-second reaction).
    setInterval(() => {
        const now = Date.now();
        for (const client of clients) {
            const buffered = (client.socket as any).writableLength ?? 0;

            // Check backpressure threshold
            if (buffered > BACKPRESSURE_THRESHOLD_BYTES) {
                client.slowTicks++;
                if (client.slowTicks >= SLOW_TICKS_BEFORE_DISCONNECT) {
                    console.warn(`[ws] disconnecting slow client (buffered ${buffered}b, ${client.slowTicks} slow ticks)`);
                    totalDisconnectedForSlow++;
                    removeClient(client);
                    continue;
                }
            } else {
                client.slowTicks = 0;
            }

            // Stall timeout: buffer isn't draining
            if (client.pendingBuffer.length > 0 && (now - client.lastDrainAt) > STALL_TIMEOUT_MS) {
                console.warn(`[ws] disconnecting stalled client (${client.pendingBuffer.length} pending, ${now - client.lastDrainAt}ms since drain)`);
                totalDisconnectedForSlow++;
                removeClient(client);
                continue;
            }
        }
    }, 1_000).unref();

    // Separate slower heartbeat (15s) for ping/pong liveness
    setInterval(() => {
        for (const client of clients) {
            if (!client.alive) {
                removeClient(client);
                continue;
            }
            client.alive = false;
            // Send ping
            try {
                client.socket.write(encodeFrame(0x9, ''));
            } catch {
                removeClient(client);
            }
        }
    }, 15_000).unref();
}

// ---------------------------------------------------------------------------
// Writing & Backpressure Handling
// ---------------------------------------------------------------------------

function scheduleDelivery(client: WSClient, work: () => Promise<void>): void {
    if (!clients.has(client)) return;
    if (client.queuedChecks >= RING_BUFFER_SIZE) { removeClient(client); return; }
    client.queuedChecks++;
    client.delivery = client.delivery.then(work).catch(() => { removeClient(client); }).finally(() => { client.queuedChecks--; });
}

function writeToClient(client: WSClient, payload: string): void {
    try {
        const event = JSON.parse(payload) as BroadcastEvent;
        if (event.tenantId !== client.user.tenantId || !(client.subscriptions.has(event.sessionId) || client.channels.has(event.sessionId))) return;
    } catch { return; }
    scheduleDelivery(client, () => deliverToClient(client, payload));
}

/** Try to flush pending messages from the per-client ring buffer. */
function flushPending(client: WSClient): void {
    if (!client.pendingBuffer.length) return;
    scheduleDelivery(client, async () => {
        while (client.pendingBuffer.length > 0) {
            const msg = client.pendingBuffer.shift()!;
            if (!(await canDeliver(client, msg))) continue;
            const canWrite = client.socket.writable && !(client.socket as any).writableNeedDrain;
            if (!canWrite) {
                // Put it back; we'll flush again on next drain
                client.pendingBuffer.unshift(msg);
                return;
            }
            try {
                client.socket.write(encodeFrame(0x1, msg));
            } catch {
                removeClient(client);
                return;
            }
        }
    });
}

/** Write a message to a client with backpressure handling. */
async function deliverToClient(client: WSClient, payload: string): Promise<void> {
    if (!(await canDeliver(client, payload))) return;
    // If the socket needs draining, enqueue to the ring buffer instead
    const needDrain = (client.socket as any).writableNeedDrain === true;
    if (needDrain) {
        if (client.pendingBuffer.length >= RING_BUFFER_SIZE) {
            // Ring buffer overflow → drop oldest, increment dropped count
            client.pendingBuffer.shift();
            client.droppedCount++;
            totalDroppedMessages++;
            if (client.droppedCount > RING_BUFFER_SIZE * 2) {
                // Persistent overflow → disconnect
                removeClient(client);
                return;
            }
        }
        client.pendingBuffer.push(payload);
        return;
    }

    try {
        const ok = client.socket.write(encodeFrame(0x1, payload));
        if (!ok) {
            // Backpressure signal — next write should enqueue until drain
            client.lastDrainAt = Date.now();
        }
    } catch {
        removeClient(client);
    }
}

/**
 * Broadcast an event to all clients subscribed to the given sessionId or channel.
 * Backwards compatible: `sessionId` is still matched against both old subscriptions
 * and new channels.
 */
export function broadcastEvent(
    sessionId: string,
    type: string,
    data: Record<string, unknown> = {},
    tenantId = process.env.EAOS_TENANT_ID || 'default',
): void {
    const event: BroadcastEvent = {
        instanceId: INSTANCE_ID,
        tenantId,
        type,
        sessionId,
        timestamp: new Date().toISOString(),
        data,
    };
    const payload = JSON.stringify(event);

    // Local delivery
    for (const client of clients) {
        if (
            client.subscriptions.has(sessionId) ||
            client.subscriptions.has('*') ||
            client.channels.has(sessionId)
        ) {
            writeToClient(client, payload);
        }
    }

    // Redis pub/sub for multi-instance delivery (fire-and-forget)
    getRedis().then(redis => {
        if (redis) redis.publish(WS_CHANNEL, payload).catch(() => {});
    }).catch(() => {});
}

/**
 * Get count of connected WebSocket clients.
 */
export function getWSClientCount(): number {
    return clients.size;
}

/**
 * Get WebSocket server metrics.
 */
export function getWSMetrics(): {
    total: number;
    slow: number;
    totalDropped: number;
    totalDisconnectedForSlow: number;
    avgBufferedBytes: number;
    uptimeMs: number;
} {
    let slow = 0;
    let totalBuffered = 0;
    const now = Date.now();
    let oldestConnection = now;
    for (const c of clients) {
        if (c.slowTicks > 0) slow++;
        totalBuffered += (c.socket as any).writableLength ?? 0;
        if (c.connectedAt < oldestConnection) oldestConnection = c.connectedAt;
    }
    return {
        total: clients.size,
        slow,
        totalDropped: totalDroppedMessages,
        totalDisconnectedForSlow,
        avgBufferedBytes: clients.size > 0 ? Math.round(totalBuffered / clients.size) : 0,
        uptimeMs: clients.size > 0 ? now - oldestConnection : 0,
    };
}

// ---------------------------------------------------------------------------
// Helpers — Minimal RFC 6455 frame encode/decode
// ---------------------------------------------------------------------------

async function canDeliver(client: WSClient, payload: string): Promise<boolean> {
    if (!clients.has(client)) return false;
    if (client.expiresAt <= Date.now()) { removeClient(client); return false; }
    try {
        const event = JSON.parse(payload) as BroadcastEvent;
        const allowed = event.tenantId === client.user.tenantId && typeof event.sessionId === 'string' && event.sessionId !== '*' &&
            (client.subscriptions.has(event.sessionId) || client.channels.has(event.sessionId)) &&
            await client.authorize(client.user, event.sessionId);
        return allowed && clients.has(client) && client.expiresAt > Date.now();
    } catch { return false; }
}

export function closeWebSockets(): void {
    for (const client of clients) removeClient(client);
}

export function disconnectStreamUser(user: Pick<AuthUser, 'id' | 'tenantId'>): void {
    revokeStreamTickets(user);
    for (const client of clients) {
        if (client.user.id === user.id && client.user.tenantId === user.tenantId) removeClient(client);
    }
}

function removeClient(client: WSClient): void {
    clients.delete(client);
    client.pendingBuffer.length = 0;
    try {
        client.socket.destroy();
    } catch {
        /* already closed */
    }
}

function encodeFrame(opcode: number, payload: string): Buffer {
    const data = Buffer.from(payload, 'utf-8');
    const len = data.length;

    let header: Buffer;
    if (len < 126) {
        header = Buffer.alloc(2);
        header[0] = 0x80 | opcode;
        header[1] = len;
    } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x80 | opcode;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x80 | opcode;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
    }

    return Buffer.concat([header, data]);
}

function decodeFrame(
    buf: Buffer,
): { opcode: number; payload: string; bytesRead: number } | null {
    if (buf.length < 2) return null;

    const opcode = buf[0]! & 0x0f;
    const masked = !!(buf[1]! & 0x80);
    let payloadLen = buf[1]! & 0x7f;
    let offset = 2;

    if (payloadLen === 126) {
        if (buf.length < 4) return null;
        payloadLen = buf.readUInt16BE(2);
        offset = 4;
    } else if (payloadLen === 127) {
        if (buf.length < 10) return null;
        payloadLen = Number(buf.readBigUInt64BE(2));
        offset = 10;
    }

    if (!masked || !(buf[0]! & 0x80) || (buf[0]! & 0x70) || ![1, 8, 9, 10].includes(opcode) ||
        !Number.isSafeInteger(payloadLen) || payloadLen > 65522 || (opcode >= 8 && payloadLen > 125)) throw new Error('Invalid WebSocket frame');
    let maskKey: Buffer | null = null;
    if (masked) {
        if (buf.length < offset + 4) return null;
        maskKey = buf.subarray(offset, offset + 4);
        offset += 4;
    }

    if (buf.length < offset + payloadLen) return null;

    const data = buf.subarray(offset, offset + payloadLen);

    if (maskKey) {
        for (let i = 0; i < data.length; i++) {
            data[i] = data[i]! ^ maskKey[i % 4]!;
        }
    }

    return { opcode, payload: data.toString('utf-8'), bytesRead: offset + payloadLen };
}
