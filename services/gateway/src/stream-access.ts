import { randomBytes } from 'node:crypto';
import type { AuthUser } from './auth.js';

const tickets = new Map<string, { user: AuthUser; expiresAt: number }>();
const TTL_MS = 30_000;

export function issueStreamTicket(user: AuthUser, now = Date.now()): string {
  if (!user.id || user.id === 'anonymous' || !user.tenantId) throw new Error('Authenticated principal required');
  for (const [key, ticket] of tickets) if (ticket.expiresAt <= now) tickets.delete(key);
  if (tickets.size >= 1000) throw new Error('Too many pending stream tickets');
  const key = randomBytes(32).toString('hex');
  tickets.set(key, { user: { ...user }, expiresAt: now + TTL_MS });
  return key;
}

export function consumeStreamTicket(key: string, now = Date.now()): AuthUser | undefined {
  const ticket = tickets.get(key);
  tickets.delete(key);
  return ticket && ticket.expiresAt > now ? ticket.user : undefined;
}

export function revokeStreamTickets(user: Pick<AuthUser, 'id' | 'tenantId'>): void {
  for (const [key, ticket] of tickets) {
    if (ticket.user.id === user.id && ticket.user.tenantId === user.tenantId) tickets.delete(key);
  }
}

export function canReadStreamResource(user: AuthUser, resource?: { tenantId?: string; userId?: string }): boolean {
  return Boolean(user.id && user.id !== 'anonymous' && user.tenantId && resource?.tenantId === user.tenantId &&
    (resource.userId === user.id || user.role === 'admin' || user.role === 'operator'));
}

export function isAllowedBrowserOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  const configured = process.env.CORS_ALLOWED_ORIGINS ?? (process.env.NODE_ENV !== 'production' ? 'http://localhost:3010,http://127.0.0.1:3010' : '');
  return configured.split(',').map(value => value.trim()).filter(Boolean).includes(origin);
}
