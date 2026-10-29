import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthUser } from './auth.js';
import type { PostgresWorkspaceRepository, RecordFamily, WorkspaceRecord } from '@agentos/db/workspace-repository';
import { validate } from './validation.js';
import { getAgentIdentity } from './agent-registry.js';

const text = z.string().trim().min(1).max(100_000);
const id = z.string().min(1).max(200);
const specs: Record<string, { family: RecordFamily; item: string; list: string; schema: z.ZodType; operator?: boolean; kind?: string }> = {
  '/api/knowledge/documents': { family: 'knowledge', item: 'document', list: 'documents', schema: z.object({ title: text, content: text, sourceIds: z.array(id).max(100).optional() }).strict() },
  '/api/configuration': { family: 'configuration', item: 'configuration', list: 'configurations', operator: true, schema: z.object({ name: id, value: z.record(z.string(), z.unknown()) }).strict() },
  '/api/memory/decisions': { family: 'memory', kind: 'decision', item: 'decision', list: 'decisions', schema: z.object({ taskRef: id, agentId: id, agentName: text, decision: text, alternatives: z.array(text).max(30), rationale: text, confidence: z.number().min(0).max(1), evidence: z.array(text).max(100), outcome: z.enum(['correct','incorrect','partial','pending']).optional() }).strict() },
  '/api/memory/corrections': { family: 'memory', kind: 'correction', item: 'correction', list: 'corrections', schema: z.object({ taskRef: id, agentId: id, stepIndex: z.number().int().nonnegative(), originalOutput: text, correctedOutput: text, correctionType: z.enum(['factual','tone','scope','format','policy','other']), severity: z.enum(['minor','moderate','critical']) }).strict() },
  '/api/notifications/channels': { family: 'notification_channel', item: 'channel', list: 'channels', operator: true, schema: z.object({ name: text, channel: z.enum(['slack','teams','email','webhook']), enabled: z.boolean().default(true), config: z.object({ connectionId: id, destination: text }).strict() }).strict() },
  '/api/notifications/rules': { family: 'notification_rule', item: 'rule', list: 'rules', operator: true, schema: z.object({ name: text, trigger: id, channelId: id, enabled: z.boolean().default(true), eventPattern: id.optional(), template: text.optional(), recipientOverride: text.optional() }).strict() },
  '/api/webhooks/endpoints': { family: 'webhook_endpoint', item: 'endpoint', list: 'endpoints', operator: true, schema: z.object({ name: text, connectionId: id, eventTypes: z.array(id).min(1).max(100), enabled: z.boolean().default(true) }).strict() },
  '/api/webhooks/subscriptions': { family: 'webhook_subscription', item: 'subscription', list: 'subscriptions', operator: true, schema: z.object({ name: text, endpointId: id, eventType: id, enabled: z.boolean().default(true) }).strict() },
};
const connectionRoute = /^\/api\/connections(?:\/([a-z][a-z0-9_-]{0,99})\/(connect|disconnect|status|test))?$/;
function resource(path: string) {
  for (const [prefix, spec] of Object.entries(specs)) {
    if (path === prefix) return { spec, id: undefined };
    if (path.startsWith(prefix + '/') && !path.slice(prefix.length + 1).includes('/')) return { spec, id: decodeURIComponent(path.slice(prefix.length + 1)) };
  }
  return undefined;
}
export function isWorkspaceRoute(path: string, method: string): boolean {
  const found = resource(path);
  if (found) return found.id ? ['GET','PUT','PATCH','DELETE'].includes(method) : ['GET','POST'].includes(method);
  return connectionRoute.test(path) && ['GET','POST'].includes(method) || path === '/api/runtime/usage' && ['GET','PUT'].includes(method) || path === '/api/notifications/deliveries' && method === 'GET' || path === '/api/notifications/dispatch' && method === 'POST';
}
const view = (record: WorkspaceRecord) => ({ ...record.data, id: record.id, tenantId: record.tenantId, userId: record.userId, version: record.version });
function hasCredentialFields(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && Object.entries(value).some(([key, item]) => /password|token|secret|credential|api.?key/i.test(key) || hasCredentialFields(item)));
}
export async function workspaceRequest(repository: PostgresWorkspaceRepository, principal: AuthUser, url: URL, method: string, readBody: () => Promise<Record<string, unknown>>): Promise<{ status: number; data: unknown }> {
  const owner = { tenantId: principal.tenantId, userId: principal.id };
  const operator = principal.role === 'admin' || principal.role === 'operator';
  if (url.pathname === '/api/notifications/deliveries' || url.pathname === '/api/notifications/dispatch') {
    if (!operator) return { status: 403, data: { error: 'Operator role required' } };
    if (method === 'GET') return { status: 200, data: { deliveries: await repository.listDeliveries(owner) } };
    const input = validate(z.object({ runId: id, connectorId: id, deliveryKey: id, subject: text, body: text, recipient: text }).strict(), await readBody());
    const delivery = await repository.createDelivery(owner, input.runId, input.connectorId, input.deliveryKey, { subject: input.subject, body: input.body, recipient: input.recipient });
    return { status: 422, data: { delivery, error: 'Delivery is recorded as unsupported until its transport is certified' } };
  }
  if (url.pathname === '/api/runtime/usage') {
    if (!operator) return { status: 403, data: { error: 'Operator role required' } };
    if (method === 'PUT') {
      const input = validate(z.object({ limitMicros: z.number().int().nonnegative().max(1_000_000_000_000) }).strict(), await readBody());
      await repository.setUsageBudget(owner, input.limitMicros);
    }
    return { status: 200, data: await repository.usage(owner) };
  }
  const connection = url.pathname.match(connectionRoute);
  if (connection) {
    if (!operator) return { status: 403, data: { error: 'Operator role required' } };
    const connectorId = connection[1];
    if (!connectorId && method === 'GET') return { status: 200, data: { connections: Object.fromEntries((await repository.listConnections(owner)).map(item => [item.connectorId, item])) } };
    if (connectorId && connection[2] === 'connect' && method === 'POST') {
      const input = validate(z.object({ secretRef: z.object({ provider: z.enum(['vault','aws','gcp','azure']), path: id, key: id.optional(), version: id.optional() }).strict() }).strict(), await readBody());
      if (!input.secretRef.path.startsWith(`${owner.tenantId}/${owner.userId}/`) || input.secretRef.path.includes('..')) return { status: 400, data: { error: 'Secret reference is outside the owner namespace' } };
      return { status: 200, data: await repository.saveConnection(owner, connectorId, input.secretRef) };
    }
    if (connectorId && connection[2] === 'disconnect' && method === 'POST') return { status: 200, data: { disconnected: await repository.revokeConnection(owner, connectorId) } };
    if (connectorId && connection[2] === 'status' && method === 'GET') return { status: 200, data: await repository.getConnection(owner, connectorId) ?? { connectorId, status: 'unavailable' } };
    return { status: 422, data: { status: 'unsupported', error: 'Saving a secret reference does not verify vendor connectivity; a conforming adapter is required' } };
  }
  const match = resource(url.pathname);
  if (!match) return { status: 404, data: { error: 'Unknown workspace resource' } };
  const { spec } = match;
  if (spec.operator && !operator) return { status: 403, data: { error: 'Operator role required' } };
  const query = validate(z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().nonnegative().max(100_000).default(0) }), Object.fromEntries(url.searchParams));
  if (method === 'GET' && !match.id) {
    const records = await repository.listRecords(owner, spec.family, query.limit, query.offset, spec.kind ? { kind: spec.kind } : {});
    return { status: 200, data: { [spec.list]: records.map(view), limit: query.limit, offset: query.offset } };
  }
  const current = match.id ? await repository.getRecord(owner, spec.family, match.id) : undefined;
  if (match.id && (!current || spec.kind && current.data.kind !== spec.kind)) return { status: 404, data: { error: 'Record not found' } };
  if (method === 'GET') return { status: 200, data: { [spec.item]: view(current!) } };
  if (method === 'DELETE') {
    const version = validate(z.coerce.number().int().positive(), url.searchParams.get('version'));
    const archived = await repository.archiveRecord(owner, spec.family, match.id!, version);
    return { status: archived ? 200 : 409, data: { archived } };
  }
  const { version, ...body } = await readBody();
  const expectedVersion = current ? validate(z.number().int().positive(), version) : 0;
  const { kind: ignoredKind, ...previousFields } = current?.data ?? {};
  const fields = validate(spec.schema, method === 'PATCH' && current ? { ...previousFields, ...body } : body) as Record<string, unknown>;
  if (spec.family === 'configuration' && hasCredentialFields(fields)) return { status: 400, data: { error: 'Credentials belong in the secret backend, not configuration records' } };
  if (fields.agentId && !getAgentIdentity(String(fields.agentId))) return { status: 400, data: { error: 'Unknown canonical agent identity' } };
  if (spec.family === 'notification_rule' && !await repository.getRecord(owner, 'notification_channel', String(fields.channelId))) return { status: 400, data: { error: 'Channel is not owned by this principal' } };
  if (spec.family === 'webhook_subscription' && !await repository.getRecord(owner, 'webhook_endpoint', String(fields.endpointId))) return { status: 400, data: { error: 'Endpoint is not owned by this principal' } };
  const connectionId = spec.family === 'notification_channel' ? (fields.config as { connectionId: string }).connectionId : fields.connectionId;
  if (connectionId && !await repository.getConnection(owner, String(connectionId))) return { status: 400, data: { error: 'Connection is not owned by this principal' } };
  const record = await repository.putRecord(owner, spec.family, match.id ?? randomUUID(), { ...fields, ...(spec.kind ? { kind: spec.kind } : {}) }, expectedVersion);
  return { status: current ? 200 : 201, data: { [spec.item]: view(record) } };
}
