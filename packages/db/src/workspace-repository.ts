import { randomUUID } from 'node:crypto';
import { WORKFLOW_PERSONAS } from '@agentos/skills/schema';
import { RuntimeConflictError, type RuntimeClient, type RuntimePool } from './run-repository.js';
import { tenantTransaction } from './tenant-transaction.js';

export interface WorkspaceOwner { tenantId: string; userId: string }
export const RECORD_FAMILIES = ['knowledge', 'memory', 'configuration', 'notification_channel', 'notification_rule', 'webhook_endpoint', 'webhook_subscription'] as const;
export type RecordFamily = typeof RECORD_FAMILIES[number];
export interface WorkspaceRecord { id: string; tenantId: string; userId: string; version: number; data: Record<string, unknown> }
export interface ChatRecord extends WorkspaceOwner { sessionId: string; title: string; persona?: string; agentId?: string; summary?: string; pinnedContextIds: string[]; createdAt: string; updatedAt: string }
export interface MessageInput { role: 'user' | 'agent' | 'system' | 'tool'; content: string; agentId?: string; tokenCost?: number; attachments?: Array<{ type: string; ref: string; title?: string }> }
export interface MessageRecord extends MessageInput { id: string; sessionId: string; sequence: number; createdAt: string }
export interface StoredSecretReference { provider: string; path: string; key?: string; version?: string }
export interface ConnectionRecord { connectorId: string; secretRef: StoredSecretReference; status: string; version: number; config?: Record<string, unknown>; account?: Record<string, unknown>; secretVersion?: string; bindingHash?: string }

export class PostgresWorkspaceRepository {
  constructor(private readonly pool: RuntimePool) {}
  private transaction<T>(owner: WorkspaceOwner, operation: (client: RuntimeClient) => Promise<T>): Promise<T> {
    if (!owner.userId || owner.userId.length > 200) throw new Error('Verified owner is required');
    return tenantTransaction(this.pool, owner.tenantId, operation);
  }
  private family(family: RecordFamily): void {
    if (!RECORD_FAMILIES.includes(family)) throw new Error('Unsupported record family');
  }
  async getRecord(owner: WorkspaceOwner, family: RecordFamily, id: string): Promise<WorkspaceRecord | undefined> {
    this.family(family);
    return this.transaction(owner, async client => (await client.query('SELECT id,tenant_id AS "tenantId",user_id AS "userId",version,data FROM workspace_records WHERE tenant_id=$1 AND user_id=$2 AND family=$3 AND id=$4 AND archived_at IS NULL', [owner.tenantId, owner.userId, family, id])).rows[0] as WorkspaceRecord | undefined);
  }
  async listRecords(owner: WorkspaceOwner, family: RecordFamily, limit = 100, offset = 0, filter: Record<string, string> = {}): Promise<WorkspaceRecord[]> {
    this.family(family);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw new Error('Invalid pagination');
    return this.transaction(owner, async client => (await client.query('SELECT id,tenant_id AS "tenantId",user_id AS "userId",version,data FROM workspace_records WHERE tenant_id=$1 AND user_id=$2 AND family=$3 AND archived_at IS NULL AND data @> $6::jsonb ORDER BY updated_at DESC,id LIMIT $4 OFFSET $5', [owner.tenantId, owner.userId, family, limit, offset, JSON.stringify(filter)])).rows as WorkspaceRecord[]);
  }
  async putRecord(owner: WorkspaceOwner, family: RecordFamily, id: string, data: Record<string, unknown>, expectedVersion: number): Promise<WorkspaceRecord> {
    this.family(family);
    if (!id || id.length > 200 || !Number.isInteger(expectedVersion) || expectedVersion < 0 || !data || Array.isArray(data) || JSON.stringify(data).length > 1_048_576) throw new Error('Invalid workspace record');
    return this.transaction(owner, async client => {
      const result = expectedVersion === 0
        ? await client.query('INSERT INTO workspace_records (tenant_id,family,id,user_id,data) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING version', [owner.tenantId, family, id, owner.userId, JSON.stringify(data)])
        : await client.query('UPDATE workspace_records SET data=$5,version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND family=$2 AND id=$3 AND user_id=$4 AND version=$6 AND archived_at IS NULL RETURNING version', [owner.tenantId, family, id, owner.userId, JSON.stringify(data), expectedVersion]);
      if (!result.rows[0]) throw new RuntimeConflictError('Record changed or is not writable by this owner');
      return { ...owner, id, version: result.rows[0].version, data };
    });
  }
  async archiveRecord(owner: WorkspaceOwner, family: RecordFamily, id: string, version: number): Promise<boolean> {
    this.family(family);
    return this.transaction(owner, async client => (await client.query('UPDATE workspace_records SET archived_at=NOW(),version=version+1 WHERE tenant_id=$1 AND user_id=$2 AND family=$3 AND id=$4 AND version=$5 AND archived_at IS NULL RETURNING id', [owner.tenantId, owner.userId, family, id, version])).rows.length === 1);
  }
  async createChat(owner: WorkspaceOwner, input: { title?: string; persona?: string; agentId?: string }): Promise<ChatRecord> {
    if (input.persona && !(WORKFLOW_PERSONAS as readonly string[]).includes(input.persona)) throw new Error('Unknown chat persona');
    if (input.title !== undefined && (typeof input.title !== 'string' || input.title.length > 240)) throw new Error('Invalid chat title');
    const now = new Date().toISOString();
    const session: ChatRecord = { ...owner, sessionId: `chat-${randomUUID()}`, title: input.title || 'New conversation', persona: input.persona, agentId: input.agentId, pinnedContextIds: [], createdAt: now, updatedAt: now };
    return this.transaction(owner, async client => {
      await client.query('INSERT INTO workspace_chat_sessions (tenant_id,id,user_id,data) VALUES ($1,$2,$3,$4)', [owner.tenantId, session.sessionId, owner.userId, JSON.stringify(session)]);
      return session;
    });
  }
  async getChat(owner: WorkspaceOwner, id: string): Promise<ChatRecord | undefined> {
    return this.transaction(owner, async client => (await client.query('SELECT data FROM workspace_chat_sessions WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND archived_at IS NULL', [owner.tenantId, owner.userId, id])).rows[0]?.data);
  }
  async listChats(owner: WorkspaceOwner): Promise<ChatRecord[]> {
    return this.transaction(owner, async client => (await client.query('SELECT data FROM workspace_chat_sessions WHERE tenant_id=$1 AND user_id=$2 AND archived_at IS NULL ORDER BY updated_at DESC,id LIMIT 100', [owner.tenantId, owner.userId])).rows.map(row => row.data));
  }
  async archiveChat(owner: WorkspaceOwner, id: string): Promise<boolean> {
    return this.transaction(owner, async client => (await client.query('UPDATE workspace_chat_sessions SET archived_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND archived_at IS NULL RETURNING id', [owner.tenantId, owner.userId, id])).rows.length === 1);
  }
  async updateChat(owner: WorkspaceOwner, id: string, updates: { title?: string; summary?: string; pinnedContextIds?: string[]; agentId?: string }): Promise<ChatRecord | undefined> {
    return this.transaction(owner, async client => {
      const current = (await client.query('SELECT data FROM workspace_chat_sessions WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND archived_at IS NULL FOR UPDATE', [owner.tenantId, owner.userId, id])).rows[0]?.data as ChatRecord | undefined;
      if (!current) return undefined;
      const data = { ...current, title: updates.title ?? current.title, summary: updates.summary ?? current.summary, pinnedContextIds: updates.pinnedContextIds ?? current.pinnedContextIds, agentId: updates.agentId ?? current.agentId, updatedAt: new Date().toISOString() };
      await client.query('UPDATE workspace_chat_sessions SET data=$4,updated_at=NOW() WHERE tenant_id=$1 AND user_id=$2 AND id=$3', [owner.tenantId, owner.userId, id, JSON.stringify(data)]);
      return data;
    });
  }
  async appendChat(owner: WorkspaceOwner, id: string, input: MessageInput): Promise<MessageRecord> {
    if (!['user','agent','system','tool'].includes(input.role) || typeof input.content !== 'string' || !input.content.trim() || input.content.length > 100_000) throw new Error('Invalid chat message');
    return this.transaction(owner, async client => {
      const row = (await client.query('SELECT data,sequence FROM workspace_chat_sessions WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND archived_at IS NULL FOR UPDATE', [owner.tenantId, owner.userId, id])).rows[0];
      if (!row) throw new RuntimeConflictError('Chat is unavailable');
      const sequence = row.sequence + 1;
      const message: MessageRecord = { role: input.role, content: input.content, agentId: input.agentId, tokenCost: input.tokenCost, attachments: input.attachments, id: `msg-${randomUUID()}`, sessionId: id, sequence, createdAt: new Date().toISOString() };
      const session = row.data as ChatRecord;
      session.updatedAt = message.createdAt;
      if (session.title === 'New conversation' && input.role === 'user' && sequence === 1) session.title = input.content.slice(0, 60);
      await client.query('INSERT INTO workspace_chat_messages (tenant_id,session_id,id,sequence,data) VALUES ($1,$2,$3,$4,$5)', [owner.tenantId, id, message.id, sequence, JSON.stringify(message)]);
      await client.query('UPDATE workspace_chat_sessions SET data=$4,sequence=$5,updated_at=NOW() WHERE tenant_id=$1 AND user_id=$2 AND id=$3', [owner.tenantId, owner.userId, id, JSON.stringify(session), sequence]);
      return message;
    });
  }
  async listChatMessages(owner: WorkspaceOwner, id: string, limit = 100): Promise<MessageRecord[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid message limit');
    return this.transaction(owner, async client => (await client.query('SELECT m.data FROM workspace_chat_messages m JOIN workspace_chat_sessions s ON s.tenant_id=m.tenant_id AND s.id=m.session_id WHERE s.tenant_id=$1 AND s.user_id=$2 AND s.id=$3 AND s.archived_at IS NULL ORDER BY m.sequence DESC LIMIT $4', [owner.tenantId, owner.userId, id, limit])).rows.reverse().map(row => row.data));
  }
  async createDelivery(owner: WorkspaceOwner, runId: string, connectorId: string, deliveryKey: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!deliveryKey || deliveryKey.length > 200 || JSON.stringify(payload).length > 1_048_576) throw new Error('Invalid delivery request');
    return this.transaction(owner, async client => {
      const run = (await client.query('SELECT id FROM runtime_runs WHERE tenant_id=$1 AND id=$2 AND user_id=$3', [owner.tenantId, runId, owner.userId])).rows[0];
      const connection = (await client.query("SELECT connector_id FROM workspace_connections WHERE tenant_id=$1 AND user_id=$2 AND connector_id=$3 AND status<>'revoked'", [owner.tenantId, owner.userId, connectorId])).rows[0];
      if (!run || !connection) throw new RuntimeConflictError('Delivery requires an owned run and connection');
      await client.query("INSERT INTO runtime_deliveries (tenant_id,id,run_id,user_id,connector_id,delivery_key,payload,status,error) VALUES ($1,$2,$3,$4,$5,$6,$7,'unsupported','No conforming delivery transport is registered') ON CONFLICT DO NOTHING", [owner.tenantId, randomUUID(), runId, owner.userId, connectorId, deliveryKey, JSON.stringify(payload)]);
      const row = (await client.query('SELECT id,run_id,user_id,status,error,(payload=$4::jsonb) AS same_payload FROM runtime_deliveries WHERE tenant_id=$1 AND connector_id=$2 AND delivery_key=$3', [owner.tenantId, connectorId, deliveryKey, JSON.stringify(payload)])).rows[0];
      if (!row || row.run_id !== runId || row.user_id !== owner.userId || !row.same_payload) throw new RuntimeConflictError('Delivery ID was already used for another request');
      return { id: row.id, runId, connectorId, status: row.status, error: row.error };
    });
  }
  async listDeliveries(owner: WorkspaceOwner): Promise<Record<string, unknown>[]> {
    return this.transaction(owner, async client => (await client.query('SELECT id,run_id AS "runId",connector_id AS "connectorId",status,error,attempts,created_at AS "createdAt" FROM runtime_deliveries WHERE tenant_id=$1 AND user_id=$2 ORDER BY created_at DESC,id LIMIT 100', [owner.tenantId, owner.userId])).rows);
  }
  async setUsageBudget(owner: WorkspaceOwner, limitMicros: number): Promise<void> {
    if (!Number.isSafeInteger(limitMicros) || limitMicros < 0 || limitMicros > 1_000_000_000_000) throw new Error('Invalid usage budget');
    await this.transaction(owner, async client => {
      await client.query('INSERT INTO runtime_usage_budgets (tenant_id,limit_micros) VALUES ($1,$2) ON CONFLICT (tenant_id) DO UPDATE SET limit_micros=EXCLUDED.limit_micros,updated_at=NOW()', [owner.tenantId, limitMicros]);
    });
  }
  async reserveUsage(owner: WorkspaceOwner, runId: string, stepId: string, attempt: number, estimateMicros: number): Promise<string> {
    if (!Number.isSafeInteger(estimateMicros) || estimateMicros < 0 || estimateMicros > 1_000_000_000_000 || !Number.isInteger(attempt) || attempt < 1) throw new Error('Invalid usage reservation');
    return this.transaction(owner, async client => {
      const budget = (await client.query('SELECT limit_micros FROM runtime_usage_budgets WHERE tenant_id=$1 FOR UPDATE', [owner.tenantId])).rows[0];
      if (!budget) throw new RuntimeConflictError('A tenant usage budget must be configured');
      const run = (await client.query("SELECT id FROM runtime_runs WHERE tenant_id=$1 AND id=$2 AND user_id=$3 AND mode='live' AND status IN ('queued','running')", [owner.tenantId, runId, owner.userId])).rows[0];
      if (!run) throw new RuntimeConflictError('Live run is not available to this owner');
      const existing = (await client.query('SELECT id,estimate_micros,status FROM runtime_usage_reservations WHERE tenant_id=$1 AND run_id=$2 AND step_id=$3 AND attempt=$4', [owner.tenantId, runId, stepId, attempt])).rows[0];
      if (existing) {
        if (Number(existing.estimate_micros) !== estimateMicros || existing.status !== 'reserved') throw new RuntimeConflictError('Usage reservation already has a different outcome');
        return existing.id as string;
      }
      const spent = Number((await client.query("SELECT COALESCE(sum(CASE WHEN status='reserved' THEN estimate_micros WHEN status='settled' THEN actual_micros ELSE 0 END),0) AS total FROM runtime_usage_reservations WHERE tenant_id=$1", [owner.tenantId])).rows[0]!.total);
      if (spent + estimateMicros > Number(budget.limit_micros)) throw new RuntimeConflictError('Tenant usage budget exceeded');
      const id = randomUUID();
      await client.query("INSERT INTO runtime_usage_reservations (tenant_id,id,run_id,step_id,attempt,estimate_micros,status) VALUES ($1,$2,$3,$4,$5,$6,'reserved')", [owner.tenantId, id, runId, stepId, attempt, estimateMicros]);
      return id;
    });
  }
  async settleUsage(owner: WorkspaceOwner, id: string, actualMicros: number): Promise<void> {
    if (!Number.isSafeInteger(actualMicros) || actualMicros < 0 || actualMicros > 1_000_000_000_000) throw new Error('Invalid actual usage');
    await this.transaction(owner, async client => {
      await client.query('SELECT tenant_id FROM runtime_usage_budgets WHERE tenant_id=$1 FOR UPDATE', [owner.tenantId]);
      const entry = (await client.query('SELECT u.* FROM runtime_usage_reservations u JOIN runtime_runs r ON r.tenant_id=u.tenant_id AND r.id=u.run_id WHERE u.tenant_id=$1 AND u.id=$2 AND r.user_id=$3 FOR UPDATE OF u', [owner.tenantId, id, owner.userId])).rows[0];
      if (!entry) throw new RuntimeConflictError('Usage reservation is unavailable');
      if (entry.status !== 'reserved') {
        if (entry.status === 'settled' && Number(entry.actual_micros) === actualMicros) return;
        throw new RuntimeConflictError('Usage was already finalized');
      }
      await client.query("UPDATE runtime_usage_reservations SET actual_micros=$3,status='settled',settled_at=NOW() WHERE tenant_id=$1 AND id=$2", [owner.tenantId, id, actualMicros]);
    });
  }
  /**
   * Return a reservation whose provider attempt provably produced no billable
   * completion (the caller decides which failures qualify). Without this, every
   * refused attempt — a bad key, a 429, an unknown model — held its estimate
   * forever, and a tenant could exhaust its budget having spent nothing.
   * Idempotent; a settled reservation is final and is never released.
   */
  async releaseUsage(owner: WorkspaceOwner, id: string): Promise<void> {
    await this.transaction(owner, async client => {
      await client.query('SELECT tenant_id FROM runtime_usage_budgets WHERE tenant_id=$1 FOR UPDATE', [owner.tenantId]);
      const entry = (await client.query('SELECT u.status FROM runtime_usage_reservations u JOIN runtime_runs r ON r.tenant_id=u.tenant_id AND r.id=u.run_id WHERE u.tenant_id=$1 AND u.id=$2 AND r.user_id=$3 FOR UPDATE OF u', [owner.tenantId, id, owner.userId])).rows[0];
      if (!entry) throw new RuntimeConflictError('Usage reservation is unavailable');
      if (entry.status === 'released') return;
      if (entry.status !== 'reserved') throw new RuntimeConflictError('Usage was already finalized');
      await client.query("UPDATE runtime_usage_reservations SET status='released',settled_at=NOW() WHERE tenant_id=$1 AND id=$2", [owner.tenantId, id]);
    });
  }
  async usage(owner: WorkspaceOwner): Promise<{ reservedMicros: number; spentMicros: number; limitMicros: number | null }> {
    return this.transaction(owner, async client => {
      const totals = (await client.query("SELECT COALESCE(sum(estimate_micros) FILTER (WHERE status='reserved'),0) AS reserved,COALESCE(sum(actual_micros) FILTER (WHERE status='settled'),0) AS spent FROM runtime_usage_reservations WHERE tenant_id=$1", [owner.tenantId])).rows[0]!;
      const budget = (await client.query('SELECT limit_micros FROM runtime_usage_budgets WHERE tenant_id=$1', [owner.tenantId])).rows[0];
      return { reservedMicros: Number(totals.reserved), spentMicros: Number(totals.spent), limitMicros: budget ? Number(budget.limit_micros) : null };
    });
  }
  async countChatMessages(owner: WorkspaceOwner, id: string): Promise<number> {
    return this.transaction(owner, async client => Number((await client.query('SELECT count(*) AS total FROM workspace_chat_messages m JOIN workspace_chat_sessions s ON s.tenant_id=m.tenant_id AND s.id=m.session_id WHERE s.tenant_id=$1 AND s.user_id=$2 AND s.id=$3 AND s.archived_at IS NULL', [owner.tenantId, owner.userId, id])).rows[0]!.total));
  }
  async saveConnection(owner: WorkspaceOwner, connectorId: string, ref: StoredSecretReference, config: Record<string, unknown> = {}): Promise<ConnectionRecord> {
    if (!/^[a-z][a-z0-9_-]{0,99}$/.test(connectorId) || !['vault','aws','gcp','azure'].includes(ref.provider) || !ref.path.startsWith(`${owner.tenantId}/${owner.userId}/`) || ref.path.includes('..') || ref.path.length > 500) throw new Error('A tenant-owned external secret reference is required');
    const secretRef = { provider: ref.provider, path: ref.path, ...(ref.key ? { key: ref.key } : {}), ...(ref.version ? { version: ref.version } : {}) };
    return this.transaction(owner, async client => {
      const row = (await client.query("INSERT INTO workspace_connections (tenant_id,user_id,connector_id,secret_ref,status,config) VALUES ($1,$2,$3,$4,'configured',$5) ON CONFLICT (tenant_id,user_id,connector_id) DO UPDATE SET secret_ref=EXCLUDED.secret_ref,config=EXCLUDED.config,status='configured',account=NULL,secret_version=NULL,binding_hash=NULL,verified_at=NULL,version=workspace_connections.version+1,updated_at=NOW() RETURNING version", [owner.tenantId, owner.userId, connectorId, JSON.stringify(secretRef), JSON.stringify(config)])).rows[0]!;
      return { connectorId, secretRef, status: 'configured', version: row.version, config };
    });
  }
  async getConnection(owner: WorkspaceOwner, connectorId: string): Promise<ConnectionRecord | undefined> {
    return this.transaction(owner, async client => (await client.query('SELECT connector_id AS "connectorId",secret_ref AS "secretRef",status,version,config,account,secret_version AS "secretVersion",binding_hash AS "bindingHash" FROM workspace_connections WHERE tenant_id=$1 AND user_id=$2 AND connector_id=$3', [owner.tenantId, owner.userId, connectorId])).rows[0] as ConnectionRecord | undefined);
  }
  async listConnections(owner: WorkspaceOwner): Promise<ConnectionRecord[]> {
    return this.transaction(owner, async client => (await client.query('SELECT connector_id AS "connectorId",secret_ref AS "secretRef",status,version,config,account,secret_version AS "secretVersion",binding_hash AS "bindingHash" FROM workspace_connections WHERE tenant_id=$1 AND user_id=$2 ORDER BY connector_id', [owner.tenantId, owner.userId])).rows as ConnectionRecord[]);
  }
  async verifyConnection(owner: WorkspaceOwner, connectorId: string, version: number, proof: { status: 'verified' | 'expired' | 'unsupported' | 'unavailable'; account?: Record<string, unknown>; secretVersion?: string; bindingHash?: string }): Promise<boolean> {
    return this.transaction(owner, async client => (await client.query("UPDATE workspace_connections SET status=$5,account=$6,secret_version=$7,binding_hash=$8,verified_at=NOW(),version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND user_id=$2 AND connector_id=$3 AND version=$4 AND status<>'revoked' RETURNING version", [owner.tenantId, owner.userId, connectorId, version, proof.status, JSON.stringify(proof.account ?? null), proof.secretVersion ?? null, proof.bindingHash ?? null])).rows.length === 1);
  }
  async revokeConnection(owner: WorkspaceOwner, connectorId: string): Promise<boolean> {
    return this.transaction(owner, async client => (await client.query("UPDATE workspace_connections SET status='revoked',version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND user_id=$2 AND connector_id=$3 RETURNING connector_id", [owner.tenantId, owner.userId, connectorId])).rows.length === 1);
  }
}
