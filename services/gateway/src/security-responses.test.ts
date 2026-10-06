import { describe, expect, it } from 'vitest';
import { redactChannel, type ChannelConfig } from './notification-dispatch.js';
import { getNotificationConfig, setNotificationConfig } from './marketing-notifications.js';
import { redactEndpoint, redactSubscription, type WebhookEndpoint, type WebhookSubscription } from './webhook-connector.js';

const secret = 'fixture-credential-never-return';
const base = { id: 'channel-1', name: 'Fixture', enabled: true, createdAt: '2026-01-01T00:00:00Z' };

const channels: ChannelConfig[] = [
  { ...base, channel: 'slack', config: { type: 'slack', botToken: secret, defaultChannel: 'team' } },
  { ...base, channel: 'teams', config: { type: 'teams', webhookUrl: `https://example.invalid/${secret}` } },
  { ...base, channel: 'email', config: { type: 'email', smtpHost: 'smtp.example.invalid', smtpPort: 587, smtpUser: 'sender', smtpPass: secret, fromAddress: 'sender@example.invalid', useTLS: true } },
  { ...base, channel: 'webhook', config: { type: 'webhook', url: `https://example.invalid/${secret}`, secret, headers: { Authorization: secret } } },
];

describe('secret-free administrative responses', () => {
  it('redacts the legacy marketing notification configuration too', () => {
    setNotificationConfig({ enabled: false, teams: { webhookUrl: `https://example.invalid/${secret}` }, whatsapp: { apiKey: secret } });
    expect(JSON.stringify(getNotificationConfig())).not.toContain(secret);
  });
  it.each(channels)('redacts $channel configuration without changing stored credentials', channel => {
    const original = JSON.stringify(channel);
    const response = redactChannel(channel);
    expect(response.id).toBe(channel.id);
    expect(JSON.stringify(response)).not.toContain(secret);
    expect(JSON.stringify(channel)).toBe(original);
  });

  it('does not spread future secret-bearing fields into a response', () => {
    const channel = { ...channels[0]!, futureSecret: secret, config: { ...channels[0]!.config, refreshToken: secret } };
    expect(JSON.stringify(redactChannel(channel))).not.toContain(secret);
  });

  it('redacts persisted endpoint signing secrets', () => {
    const endpoint: WebhookEndpoint = { ...base, source: 'fixture', secret, eventPrefix: 'fixture', receivedCount: 0 };
    expect(redactEndpoint(endpoint)).toMatchObject({ id: endpoint.id, source: endpoint.source });
    expect(JSON.stringify(redactEndpoint(endpoint))).not.toContain(secret);
    expect(endpoint.secret).toBe(secret);
  });

  it('omits outbound header values and secret-bearing target paths', () => {
    const subscription: WebhookSubscription = {
      ...base, eventPattern: 'fixture.*', targetUrl: `https://user:${secret}@example.invalid/${secret}?key=${secret}`,
      signingSecret: secret, headers: { Authorization: secret }, deliveredCount: 0, failedCount: 0,
    };
    const response = redactSubscription(subscription);
    expect(JSON.stringify(response)).not.toContain(secret);
    expect(response.targetOrigin).toBe('https://example.invalid');
    expect(subscription.headers?.Authorization).toBe(secret);
  });
});
