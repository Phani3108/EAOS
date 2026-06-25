/**
 * Webhook Connector Runtime — Inbound & Outbound Webhook Management
 *
 * Inbound: Receive HTTP POST webhooks from external systems, verify signatures,
 *          and route events into the event bus.
 * Outbound: Register webhook subscriptions that fire on event-bus patterns.
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { eventBus, type GatewayEvent } from './event-bus.js';
import type { Store } from './db.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookEndpoint {
  id: string;
  name: string;
  /** Source system identifier (e.g. 'github', 'stripe', 'custom') */
  source: string;
  /** Secret for HMAC-SHA256 signature verification */
  secret: string;
  /** Event type prefix to emit (e.g. 'webhook.github' → 'webhook.github.push') */
  eventPrefix: string;
  enabled: boolean;
  receivedCount: number;
  lastReceivedAt?: string;
  createdAt: string;
}

export interface WebhookSubscription {
  id: string;
  name: string;
  /** Event pattern to match (e.g. 'execution.*', 'skill.completed') */
  eventPattern: string;
  /** Target URL to POST to */
  targetUrl: string;
  /** HMAC-SHA256 signing secret for outbound */
  signingSecret: string;
  /** Custom headers to include */
  headers?: Record<string, string>;
  enabled: boolean;
  deliveredCount: number;
  failedCount: number;
  lastDeliveredAt?: string;
  createdAt: string;
}

export interface InboundEvent {
  endpointId: string;
  source: string;
  eventType: string;
  payload: Record<string, unknown>;
  receivedAt: string;
  verified: boolean;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const endpoints = new Map<string, WebhookEndpoint>();
const subscriptions = new Map<string, WebhookSubscription>();
const inboundLog: InboundEvent[] = [];
const MAX_INBOUND_LOG = 200;
let persistentStore: Store | null = null;

const ENDPOINTS_TABLE = 'webhook_endpoints';
const SUBS_TABLE = 'webhook_subscriptions';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// ---------------------------------------------------------------------------
// SSRF Guard — validate outbound target URLs
// ---------------------------------------------------------------------------

/** Cloud-metadata endpoint — ALWAYS blocked, in any mode. */
const CLOUD_METADATA_IP = '169.254.169.254';

/**
 * Validate an outbound webhook target URL to prevent SSRF.
 *
 * Always (any mode):
 *   - require an http(s) scheme
 *   - reject the cloud-metadata IP 169.254.169.254
 *
 * In production additionally rejects loopback / RFC1918 private / link-local /
 * IPv6 loopback / IPv6 ULA hosts so an attacker cannot pivot to internal
 * services. In dev these are allowed so local webhook testing still works.
 *
 * @returns null if allowed, otherwise a human-readable rejection reason.
 */
function validateTargetUrl(targetUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    return 'targetUrl is not a valid URL';
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `targetUrl scheme must be http or https (got '${url.protocol}')`;
  }

  // Strip IPv6 brackets if present.
  const host = url.hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();

  // ALWAYS block the cloud-metadata IP, in any mode.
  if (host === CLOUD_METADATA_IP) {
    return 'targetUrl host 169.254.169.254 (cloud metadata) is not allowed';
  }

  if (IS_PRODUCTION && isPrivateHost(host)) {
    return `targetUrl host '${host}' is private/loopback and not allowed in production`;
  }

  return null;
}

/**
 * True if the host is loopback / RFC1918 private / link-local / IPv6 loopback
 * or IPv6 ULA: 127.0.0.0/8, 10/8, 172.16/12, 192.168/16, ::1, fd00::/8,
 * 169.254/16, plus the 'localhost' name.
 */
function isPrivateHost(host: string): boolean {
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0') return true;

  // IPv6 unique-local addresses (fc00::/7, commonly fd00::/8).
  if (host.includes(':')) {
    return host.startsWith('fc') || host.startsWith('fd');
  }

  // IPv4 octets.
  const octets = host.split('.');
  if (octets.length === 4 && octets.every(o => /^\d{1,3}$/.test(o))) {
    const [a, b] = octets.map(Number);
    if (a === 127) return true;                        // 127.0.0.0/8 loopback
    if (a === 10) return true;                         // 10.0.0.0/8 private
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true;           // 192.168.0.0/16 private
    if (a === 169 && b === 254) return true;           // 169.254.0.0/16 link-local
  }

  return false;
}

export function initWebhookStore(store: Store): void {
  persistentStore = store;
  try {
    for (const row of store.all(ENDPOINTS_TABLE)) {
      const ep = (typeof row.data === 'string' ? JSON.parse(row.data) : row) as WebhookEndpoint;
      if (ep.id) endpoints.set(ep.id, ep);
    }
    for (const row of store.all(SUBS_TABLE)) {
      const sub = (typeof row.data === 'string' ? JSON.parse(row.data) : row) as WebhookSubscription;
      if (sub.id) subscriptions.set(sub.id, sub);
    }
  } catch { /* ignore */ }

  // Wire outbound subscriptions to the event bus
  wireSubscriptions();
}

function persist(table: string, id: string, data: unknown): void {
  if (!persistentStore) return;
  try { persistentStore.insert(table, id, { data: JSON.stringify(data) }); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Inbound Endpoint CRUD
// ---------------------------------------------------------------------------

export function createEndpoint(name: string, source: string, eventPrefix?: string): WebhookEndpoint {
  const id = `wh-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const secret = randomBytes(32).toString('hex');
  const ep: WebhookEndpoint = {
    id, name, source,
    secret,
    eventPrefix: eventPrefix ?? `webhook.${source}`,
    enabled: true,
    receivedCount: 0,
    createdAt: new Date().toISOString(),
  };
  endpoints.set(id, ep);
  persist(ENDPOINTS_TABLE, id, ep);
  return ep;
}

export function getEndpoint(id: string): WebhookEndpoint | undefined {
  return endpoints.get(id);
}

export function listEndpoints(): WebhookEndpoint[] {
  return [...endpoints.values()];
}

export function deleteEndpoint(id: string): boolean {
  const existed = endpoints.delete(id);
  if (existed && persistentStore) {
    try { persistentStore.delete(ENDPOINTS_TABLE, id); } catch { /* ignore */ }
  }
  return existed;
}

// ---------------------------------------------------------------------------
// Outbound Subscription CRUD
// ---------------------------------------------------------------------------

export function createSubscription(
  name: string,
  eventPattern: string,
  targetUrl: string,
  options?: { headers?: Record<string, string> },
): WebhookSubscription {
  // SSRF guard: validate the target before persisting the subscription.
  const rejection = validateTargetUrl(targetUrl);
  if (rejection) throw new Error(`Invalid webhook target: ${rejection}`);

  const id = `wsub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const sub: WebhookSubscription = {
    id, name, eventPattern, targetUrl,
    signingSecret: randomBytes(32).toString('hex'),
    headers: options?.headers,
    enabled: true,
    deliveredCount: 0,
    failedCount: 0,
    createdAt: new Date().toISOString(),
  };
  subscriptions.set(id, sub);
  persist(SUBS_TABLE, id, sub);

  // Wire immediately
  eventBus.on(eventPattern, (event) => deliverOutbound(sub, event));

  return sub;
}

export function getSubscription(id: string): WebhookSubscription | undefined {
  return subscriptions.get(id);
}

export function listSubscriptions(): WebhookSubscription[] {
  return [...subscriptions.values()];
}

export function deleteSubscription(id: string): boolean {
  const existed = subscriptions.delete(id);
  if (existed && persistentStore) {
    try { persistentStore.delete(SUBS_TABLE, id); } catch { /* ignore */ }
  }
  // Note: event bus handler persists until process restart (acceptable trade-off)
  return existed;
}

// ---------------------------------------------------------------------------
// Inbound: Receive & Verify Webhook
// ---------------------------------------------------------------------------

/**
 * Process an inbound webhook. Verifies the HMAC-SHA256 signature.
 *
 * IMPORTANT: `rawBody` MUST be the exact raw request body bytes as received on
 * the wire (the string read from the HTTP request stream), NOT a re-serialized
 * parsed object — re-serialization changes key order / whitespace and breaks
 * HMAC verification. server.ts is responsible for passing the raw body here.
 *
 * Fail-closed: if the endpoint has a secret configured and the signature header
 * is absent OR verification fails, the event is rejected and NOT emitted.
 * Endpoints with no secret continue to work unverified (dev/demo flow).
 *
 * @param endpointId      the inbound endpoint id
 * @param rawBody         the RAW request body string (used both for HMAC and JSON parse)
 * @param signatureHeader the incoming signature header value (e.g. 'sha256=...')
 * @param eventTypeHeader optional event-type override header
 */
export async function receiveWebhook(
  endpointId: string,
  rawBody: string,
  signatureHeader?: string,
  eventTypeHeader?: string,
): Promise<{ accepted: boolean; eventId?: string; error?: string }> {
  const ep = endpoints.get(endpointId);
  if (!ep) return { accepted: false, error: 'Endpoint not found' };
  if (!ep.enabled) return { accepted: false, error: 'Endpoint disabled' };

  // Verify signature over the RAW body bytes.
  let verified = false;
  if (signatureHeader) {
    const computed = createHmac('sha256', ep.secret).update(rawBody).digest('hex');
    const expected = signatureHeader.replace(/^sha256=/, '');
    // Constant-time comparison
    verified = computed.length === expected.length &&
      createHmac('sha256', 'compare').update(computed).digest('hex') ===
      createHmac('sha256', 'compare').update(expected).digest('hex');
  }

  // FAIL CLOSED: an endpoint with a secret requires a present, valid signature.
  // Endpoints with NO secret stay open (dev/demo unaffected).
  if (ep.secret && !verified) {
    return { accepted: false, error: 'signature required/invalid' };
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { accepted: false, error: 'Invalid JSON body' };
  }

  const eventType = eventTypeHeader ?? (payload.type as string) ?? 'event';
  const fullEventType = `${ep.eventPrefix}.${eventType}`;

  // Log inbound
  const inbound: InboundEvent = {
    endpointId: ep.id,
    source: ep.source,
    eventType: fullEventType,
    payload,
    receivedAt: new Date().toISOString(),
    verified,
  };
  inboundLog.push(inbound);
  if (inboundLog.length > MAX_INBOUND_LOG) inboundLog.splice(0, inboundLog.length - MAX_INBOUND_LOG);

  ep.receivedCount++;
  ep.lastReceivedAt = inbound.receivedAt;

  // Emit into event bus
  await eventBus.emit(fullEventType, {
    source: ep.source,
    endpointId: ep.id,
    verified,
    ...payload,
  });

  return { accepted: true, eventId: fullEventType };
}

export function getInboundLog(endpointId?: string, limit = 50): InboundEvent[] {
  let events = inboundLog;
  if (endpointId) events = events.filter(e => e.endpointId === endpointId);
  return events.slice(-limit).reverse();
}

// ---------------------------------------------------------------------------
// Outbound: Deliver to subscriber URL
// ---------------------------------------------------------------------------

async function deliverOutbound(sub: WebhookSubscription, event: GatewayEvent): Promise<void> {
  if (!sub.enabled) return;

  // Re-check subscription still exists (may have been deleted)
  if (!subscriptions.has(sub.id)) return;

  // SSRF guard (defense in depth): re-validate the target before fetching, in
  // case a subscription was persisted before this check existed.
  const rejection = validateTargetUrl(sub.targetUrl);
  if (rejection) {
    sub.failedCount++;
    console.warn(`[webhook-connector] Outbound blocked for ${sub.id}: ${rejection}`);
    return;
  }

  const payload = JSON.stringify({
    id: event.id,
    type: event.type,
    source: event.source,
    time: event.time,
    data: event.data,
    subscriptionId: sub.id,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'AgentOS-Webhooks/1.0',
    ...sub.headers,
  };

  // HMAC-SHA256 signature
  const signature = createHmac('sha256', sub.signingSecret).update(payload).digest('hex');
  headers['X-AgentOS-Signature'] = `sha256=${signature}`;
  headers['X-AgentOS-Event'] = event.type;

  try {
    const res = await fetch(sub.targetUrl, {
      method: 'POST',
      headers,
      body: payload,
    });

    if (res.ok) {
      sub.deliveredCount++;
      sub.lastDeliveredAt = new Date().toISOString();
    } else {
      sub.failedCount++;
      console.warn(`[webhook-connector] Outbound failed for ${sub.id}: ${res.status}`);
    }
  } catch (err) {
    sub.failedCount++;
    console.warn(`[webhook-connector] Outbound error for ${sub.id}: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Wire existing subscriptions on init
// ---------------------------------------------------------------------------

function wireSubscriptions(): void {
  for (const sub of subscriptions.values()) {
    if (sub.enabled) {
      eventBus.on(sub.eventPattern, (event) => deliverOutbound(sub, event));
    }
  }
}
