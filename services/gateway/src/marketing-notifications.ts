/**
 * Marketing Notifications — Teams, Email, WhatsApp
 * Triggers: task assignment, task delay, approval required, completion
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

export type NotificationChannel = 'teams' | 'email' | 'whatsapp';

export type NotificationTrigger = 'task_assignment' | 'task_delay' | 'approval_required' | 'completion';

export interface NotificationPayload {
  trigger: NotificationTrigger;
  channel: NotificationChannel;
  recipient: string;
  subject?: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationConfig {
  enabled: boolean;
  teams?: { webhookUrl?: string };
  email?: { smtpConfigured?: boolean };
  whatsapp?: { apiKey?: string };
}

const config: NotificationConfig = {
  enabled: true,
  teams: {},
  email: {},
  whatsapp: {},
};

const notificationLog: Array<NotificationPayload & { id: string; sentAt: string; status: string }> = [];

export function queueNotification(payload: NotificationPayload): string {
  const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const entry = { ...payload, id, sentAt: new Date().toISOString(), status: 'queued' };
  notificationLog.push(entry);

  if (config.enabled) {
    dispatchNotification(entry).catch(() => {
      entry.status = 'failed';
    });
  }

  return id;
}

async function dispatchNotification(entry: typeof notificationLog[0]): Promise<void> {
  switch (entry.channel) {
    case 'teams':
      if (config.teams?.webhookUrl) {
        await fetch(config.teams.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            '@type': 'MessageCard',
            title: entry.subject ?? `AgentOS: ${entry.trigger}`,
            text: entry.body,
          }),
        });
      }
      break;
    case 'email':
      if (config.email?.smtpConfigured) {
        // TODO: SMTP send
      }
      break;
    case 'whatsapp':
      if (config.whatsapp?.apiKey) {
        // TODO: WhatsApp Business API
      }
      break;
  }
  entry.status = 'sent';
}

function notifyAllChannels(payload: Omit<NotificationPayload, 'channel'>): void {
  const channels: NotificationChannel[] = ['teams'];
  if (config.email?.smtpConfigured) channels.push('email');
  if (config.whatsapp?.apiKey) channels.push('whatsapp');
  for (const ch of channels) {
    queueNotification({ ...payload, channel: ch });
  }
}

export function notifyTaskAssignment(taskId: string, owner: string, taskName: string): void {
  const payload = {
    trigger: 'task_assignment' as const,
    recipient: owner,
    subject: `Task assigned: ${taskName}`,
    body: `You have been assigned to task "${taskName}" (${taskId}).`,
    metadata: { taskId, owner },
  };
  notifyAllChannels(payload);
}

export function notifyTaskDelay(taskId: string, owner: string, taskName: string, delayHours: number): void {
  const payload = {
    trigger: 'task_delay' as const,
    recipient: owner,
    subject: `Task delayed: ${taskName}`,
    body: `Task "${taskName}" is ${delayHours}h overdue. Please update status.`,
    metadata: { taskId, owner, delayHours },
  };
  notifyAllChannels(payload);
}

export function notifyApprovalRequired(taskId: string, approver: string, taskName: string): void {
  const payload = {
    trigger: 'approval_required' as const,
    recipient: approver,
    subject: `Approval required: ${taskName}`,
    body: `Task "${taskName}" requires your approval.`,
    metadata: { taskId, approver },
  };
  notifyAllChannels(payload);
}

export function notifyCompletion(taskId: string, owner: string, taskName: string): void {
  const payload = {
    trigger: 'completion' as const,
    recipient: owner,
    subject: `Task completed: ${taskName}`,
    body: `Task "${taskName}" has been completed.`,
    metadata: { taskId, owner },
  };
  notifyAllChannels(payload);
}

export function getNotificationLog(limit = 50): typeof notificationLog {
  return notificationLog.slice(-limit).reverse();
}

export function setNotificationConfig(cfg: Partial<NotificationConfig>): void {
  Object.assign(config, cfg);
}

export function getNotificationConfig() {
  return {
    enabled: config.enabled,
    teams: { configured: Boolean(config.teams?.webhookUrl) },
    email: { smtpConfigured: Boolean(config.email?.smtpConfigured) },
    whatsapp: { configured: Boolean(config.whatsapp?.apiKey) },
  };
}
