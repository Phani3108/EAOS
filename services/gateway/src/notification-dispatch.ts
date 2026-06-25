/**
 * Notification Dispatch Engine — Multi-channel notification system
 *
 * Channels: Slack, Teams, Email (SMTP), Webhook (HTTP POST)
 * Features: Delivery tracking, retry with exponential backoff, templates,
 *           configurable rules that bind event-bus patterns to channels.
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import type { Store } from './db.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DispatchChannel = 'slack' | 'teams' | 'email' | 'webhook';

export interface ChannelConfig {
  id: string;
  channel: DispatchChannel;
  name: string;
  enabled: boolean;
  config: SlackChannelConfig | TeamsChannelConfig | EmailChannelConfig | WebhookChannelConfig;
  createdAt: string;
}

export interface SlackChannelConfig {
  type: 'slack';
  botToken: string;
  defaultChannel: string;
}

export interface TeamsChannelConfig {
  type: 'teams';
  webhookUrl: string;
}

export interface EmailChannelConfig {
  type: 'email';
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  fromAddress: string;
  useTLS: boolean;
}

export interface WebhookChannelConfig {
  type: 'webhook';
  url: string;
  secret?: string;         // HMAC-SHA256 signing secret
  headers?: Record<string, string>;
}

export type NotificationTrigger =
  | 'execution.completed'
  | 'execution.failed'
  | 'step.approval_needed'
  | 'agent.retraining_flagged'
  | 'vision.decomposed'
  | 'pmo.escalation'
  | 'kpi.threshold_breach'
  | 'custom';

export interface NotificationRule {
  id: string;
  name: string;
  trigger: NotificationTrigger;
  eventPattern?: string;     // event-bus pattern (e.g. 'execution.*')
  channelId: string;         // which channel to dispatch to
  enabled: boolean;
  template?: string;         // message template with {{variable}} interpolation
  recipientOverride?: string; // override default recipient
  createdAt: string;
}

export interface DeliveryRecord {
  id: string;
  ruleId?: string;
  channelId: string;
  channel: DispatchChannel;
  trigger: NotificationTrigger | string;
  subject: string;
  body: string;
  recipient: string;
  status: 'queued' | 'sending' | 'delivered' | 'failed' | 'retrying';
  attempts: number;
  maxAttempts: number;
  lastAttemptAt?: string;
  deliveredAt?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const channels = new Map<string, ChannelConfig>();
const rules = new Map<string, NotificationRule>();
const deliveryLog: DeliveryRecord[] = [];
const MAX_DELIVERY_LOG = 500;
let persistentStore: Store | null = null;

const CHANNELS_TABLE = 'notification_channels';
const RULES_TABLE = 'notification_rules';

export function initNotificationStore(store: Store): void {
  persistentStore = store;
  try {
    const storedChannels = store.all(CHANNELS_TABLE);
    for (const row of storedChannels) {
      const c = (typeof row.data === 'string' ? JSON.parse(row.data) : row) as ChannelConfig;
      if (c.id) channels.set(c.id, c);
    }
    const storedRules = store.all(RULES_TABLE);
    for (const row of storedRules) {
      const r = (typeof row.data === 'string' ? JSON.parse(row.data) : row) as NotificationRule;
      if (r.id) rules.set(r.id, r);
    }
  } catch { /* tables may not exist */ }
}

function persistChannel(c: ChannelConfig): void {
  if (!persistentStore) return;
  try { persistentStore.insert(CHANNELS_TABLE, c.id, { data: JSON.stringify(c) }); } catch { /* ignore */ }
}

function persistRule(r: NotificationRule): void {
  if (!persistentStore) return;
  try { persistentStore.insert(RULES_TABLE, r.id, { data: JSON.stringify(r) }); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Channel CRUD
// ---------------------------------------------------------------------------

export function createChannel(
  channel: DispatchChannel,
  name: string,
  config: ChannelConfig['config'],
): ChannelConfig {
  const id = `ch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const entry: ChannelConfig = { id, channel, name, enabled: true, config, createdAt: new Date().toISOString() };
  channels.set(id, entry);
  persistChannel(entry);
  return entry;
}

export function getChannel(id: string): ChannelConfig | undefined {
  return channels.get(id);
}

export function listChannels(): ChannelConfig[] {
  return [...channels.values()];
}

export function updateChannel(id: string, updates: Partial<Pick<ChannelConfig, 'name' | 'enabled' | 'config'>>): ChannelConfig {
  const ch = channels.get(id);
  if (!ch) throw new Error(`Channel ${id} not found`);
  if (updates.name !== undefined) ch.name = updates.name;
  if (updates.enabled !== undefined) ch.enabled = updates.enabled;
  if (updates.config) ch.config = updates.config;
  persistChannel(ch);
  return ch;
}

export function deleteChannel(id: string): boolean {
  const existed = channels.delete(id);
  if (existed && persistentStore) {
    try { persistentStore.delete(CHANNELS_TABLE, id); } catch { /* ignore */ }
  }
  return existed;
}

// ---------------------------------------------------------------------------
// Rule CRUD
// ---------------------------------------------------------------------------

export function createRule(
  name: string,
  trigger: NotificationTrigger,
  channelId: string,
  options?: { eventPattern?: string; template?: string; recipientOverride?: string },
): NotificationRule {
  const id = `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const entry: NotificationRule = {
    id, name, trigger, channelId,
    enabled: true,
    eventPattern: options?.eventPattern,
    template: options?.template,
    recipientOverride: options?.recipientOverride,
    createdAt: new Date().toISOString(),
  };
  rules.set(id, entry);
  persistRule(entry);
  return entry;
}

export function getRule(id: string): NotificationRule | undefined {
  return rules.get(id);
}

export function listRules(): NotificationRule[] {
  return [...rules.values()];
}

export function updateRule(id: string, updates: Partial<Pick<NotificationRule, 'name' | 'enabled' | 'template' | 'recipientOverride'>>): NotificationRule {
  const rule = rules.get(id);
  if (!rule) throw new Error(`Rule ${id} not found`);
  if (updates.name !== undefined) rule.name = updates.name;
  if (updates.enabled !== undefined) rule.enabled = updates.enabled;
  if (updates.template !== undefined) rule.template = updates.template;
  if (updates.recipientOverride !== undefined) rule.recipientOverride = updates.recipientOverride;
  persistRule(rule);
  return rule;
}

export function deleteRule(id: string): boolean {
  const existed = rules.delete(id);
  if (existed && persistentStore) {
    try { persistentStore.delete(RULES_TABLE, id); } catch { /* ignore */ }
  }
  return existed;
}

// ---------------------------------------------------------------------------
// Dispatch Engine
// ---------------------------------------------------------------------------

/**
 * Dispatch a notification through a specific channel.
 * Returns the delivery record with tracking ID.
 */
export async function dispatch(
  channelId: string,
  subject: string,
  body: string,
  recipient: string,
  options?: { trigger?: NotificationTrigger | string; ruleId?: string; metadata?: Record<string, unknown> },
): Promise<DeliveryRecord> {
  const ch = channels.get(channelId);
  if (!ch) throw new Error(`Channel ${channelId} not found`);

  const delivery: DeliveryRecord = {
    id: `del-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ruleId: options?.ruleId,
    channelId,
    channel: ch.channel,
    trigger: options?.trigger ?? 'custom',
    subject,
    body,
    recipient,
    status: 'queued',
    attempts: 0,
    maxAttempts: 3,
    metadata: options?.metadata,
    createdAt: new Date().toISOString(),
  };

  deliveryLog.push(delivery);
  if (deliveryLog.length > MAX_DELIVERY_LOG) deliveryLog.splice(0, deliveryLog.length - MAX_DELIVERY_LOG);

  // Async dispatch with retry
  executeDelivery(delivery, ch).catch(() => { /* logged in delivery record */ });

  return delivery;
}

/**
 * Dispatch notification to ALL enabled channels that match a trigger.
 */
export async function dispatchByTrigger(
  trigger: NotificationTrigger,
  subject: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<DeliveryRecord[]> {
  const matchingRules = [...rules.values()].filter(r => r.enabled && r.trigger === trigger);
  const deliveries: DeliveryRecord[] = [];

  for (const rule of matchingRules) {
    const ch = channels.get(rule.channelId);
    if (!ch || !ch.enabled) continue;

    const finalBody = rule.template ? interpolateTemplate(rule.template, { subject, body, ...data }) : body;
    const recipient = rule.recipientOverride ?? 'default';

    try {
      const delivery = await dispatch(rule.channelId, subject, finalBody, recipient, {
        trigger, ruleId: rule.id, metadata: data,
      });
      deliveries.push(delivery);
    } catch { /* channel not found — skip */ }
  }

  return deliveries;
}

// ---------------------------------------------------------------------------
// Channel-Specific Dispatch
// ---------------------------------------------------------------------------

async function executeDelivery(delivery: DeliveryRecord, ch: ChannelConfig): Promise<void> {
  const maxAttempts = delivery.maxAttempts;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    delivery.attempts = attempt;
    delivery.status = 'sending';
    delivery.lastAttemptAt = new Date().toISOString();

    try {
      switch (ch.channel) {
        case 'slack':
          await sendSlack(ch.config as SlackChannelConfig, delivery);
          break;
        case 'teams':
          await sendTeams(ch.config as TeamsChannelConfig, delivery);
          break;
        case 'email':
          await sendEmail(ch.config as EmailChannelConfig, delivery);
          break;
        case 'webhook':
          await sendWebhook(ch.config as WebhookChannelConfig, delivery);
          break;
      }

      delivery.status = 'delivered';
      delivery.deliveredAt = new Date().toISOString();
      return;
    } catch (err) {
      delivery.error = (err as Error).message;
      if (attempt < maxAttempts) {
        delivery.status = 'retrying';
        // Exponential backoff: 1s, 2s, 4s
        await sleep(1000 * Math.pow(2, attempt - 1));
      } else {
        delivery.status = 'failed';
      }
    }
  }
}

async function sendSlack(config: SlackChannelConfig, delivery: DeliveryRecord): Promise<void> {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.botToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      channel: delivery.recipient !== 'default' ? delivery.recipient : config.defaultChannel,
      text: `*${delivery.subject}*\n${delivery.body}`,
    }),
  });
  const data = await res.json() as { ok: boolean; error?: string };
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
}

async function sendTeams(config: TeamsChannelConfig, delivery: DeliveryRecord): Promise<void> {
  const res = await fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      title: delivery.subject,
      text: delivery.body,
      themeColor: delivery.trigger === 'execution.failed' ? 'FF0000' : '0076D7',
    }),
  });
  if (!res.ok) throw new Error(`Teams webhook error: ${res.status}`);
}

async function sendEmail(config: EmailChannelConfig, delivery: DeliveryRecord): Promise<void> {
  // The email channel is NOT implemented: there is no SMTP client wired up here,
  // so no message is ever actually sent. Rather than falsely report 'delivered',
  // fail honestly so getDeliveryStats() and the UI reflect reality. To implement,
  // wire a real SMTP transport (e.g. nodemailer or SES) using `config`.
  console.warn(`[notification-dispatch] ✉️ Email channel not implemented — would send to=${delivery.recipient}, subject="${delivery.subject}", from=${config.fromAddress}, host=${config.smtpHost}`);
  throw new Error('email channel not implemented (configure SMTP / wire a mail transport)');
}

async function sendWebhook(config: WebhookChannelConfig, delivery: DeliveryRecord): Promise<void> {
  const payload = JSON.stringify({
    id: delivery.id,
    trigger: delivery.trigger,
    subject: delivery.subject,
    body: delivery.body,
    recipient: delivery.recipient,
    metadata: delivery.metadata,
    timestamp: new Date().toISOString(),
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'AgentOS-Notifications/1.0',
    ...config.headers,
  };

  // HMAC-SHA256 signature if secret is configured
  if (config.secret) {
    const { createHmac } = await import('node:crypto');
    const signature = createHmac('sha256', config.secret).update(payload).digest('hex');
    headers['X-AgentOS-Signature'] = `sha256=${signature}`;
  }

  const res = await fetch(config.url, {
    method: 'POST',
    headers,
    body: payload,
  });
  if (!res.ok) throw new Error(`Webhook error: ${res.status} ${await res.text().catch(() => '')}`);
}

// ---------------------------------------------------------------------------
// Delivery Log
// ---------------------------------------------------------------------------

export function getDeliveryLog(limit = 50, channelFilter?: string): DeliveryRecord[] {
  let filtered = deliveryLog;
  if (channelFilter) filtered = filtered.filter(d => d.channelId === channelFilter);
  return filtered.slice(-limit).reverse();
}

export function getDelivery(id: string): DeliveryRecord | undefined {
  return deliveryLog.find(d => d.id === id);
}

export function getDeliveryStats(): {
  total: number;
  delivered: number;
  failed: number;
  pending: number;
  byChannel: Record<string, number>;
} {
  const stats = { total: deliveryLog.length, delivered: 0, failed: 0, pending: 0, byChannel: {} as Record<string, number> };
  for (const d of deliveryLog) {
    if (d.status === 'delivered') stats.delivered++;
    else if (d.status === 'failed') stats.failed++;
    else stats.pending++;
    stats.byChannel[d.channel] = (stats.byChannel[d.channel] ?? 0) + 1;
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Template Interpolation
// ---------------------------------------------------------------------------

function interpolateTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, key: string) => {
    const parts = key.split('.');
    let value: unknown = data;
    for (const p of parts) {
      if (value && typeof value === 'object') value = (value as Record<string, unknown>)[p];
      else return `{{${key}}}`;
    }
    return String(value ?? `{{${key}}}`);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
