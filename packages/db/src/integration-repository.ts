import { createHash, randomUUID } from 'node:crypto';
import { tenantTransaction } from './tenant-transaction.js';
import { LeaseLostError, RuntimeConflictError, type RuntimeLease, type RuntimePool, type RuntimeClient } from './run-repository.js';
import type { WorkspaceOwner } from './workspace-repository.js';

export function integrationDigest(value: unknown): string {
  const stable = (item: unknown): string => Array.isArray(item) ? `[${item.map(stable).join(',')}]` : item && typeof item === 'object' ? `{${Object.entries(item).filter(([, v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}` : JSON.stringify(item) ?? 'null';
  return createHash('sha256').update(stable(value)).digest('hex');
}
export interface InputArtifact extends WorkspaceOwner { id: string; filename: string; mimeType: string; digest: string; bytes: Buffer; text: string; createdAt?: string }
export interface ArtifactQuota { files: number; bytes: number }
/**
 * What an upload counts against, and how long it lives.
 *
 * `owner` bounds each owner's LIVE artifacts. Archiving drops an artifact's content
 * (see RETIRE), so an archived upload stops occupying storage and must stop occupying
 * quota — counting it forever made the quota a lifetime cap that locked owners out.
 *
 * `ephemeral` uploads also share one tenant-wide `pool` and expire after `ttlSeconds`.
 * That is for owners who are free to mint: every public demo session is a new owner,
 * so a per-owner quota alone bounds nothing in aggregate. The pool is the bound.
 */
export interface ArtifactRetention { owner: ArtifactQuota; ephemeral?: { ttlSeconds: number; pool: ArtifactQuota } }
export const OWNER_ARTIFACT_RETENTION: ArtifactRetention = { owner: { files: 1000, bytes: 64_000_000 } };
const LIVE_ARTIFACT = 'archived_at IS NULL AND (expires_at IS NULL OR expires_at>NOW())';
/**
 * Retiring (archive or expiry) keeps the row — id, owner, filename and digest, which
 * runtime_input_artifacts pins as a run's lineage — and drops the bytes and text, which
 * nothing reads once an artifact is archived. It is an UPDATE, not a DELETE, because
 * the application role is granted no DELETE on this table (README grants).
 */
const RETIRE = "archived_at=NOW(),bytes=''::bytea,extracted_text=''";
export interface ActionProof { connectorId: string; connectionVersion: number; secretVersion: string; bindingHash: string; requestHash: string; inputHash: string; adapterHash?: string }
export interface ConnectorManifest { schemaVersion: 2; id: string; actions: string[]; adapterVersion: string; adapterHash: string }
export interface ConnectorObservation { actionId: string; adapterHash: string; requestHash: string; resultHash: string; transport: 'native_transport' | 'custom_transport' }
export class PostgresIntegrationRepository {
  constructor(private readonly pool: RuntimePool) {}
  async audit(owner: WorkspaceOwner, action: string, resource: string, success: boolean): Promise<void> {
    await tenantTransaction(this.pool, owner.tenantId, async client => { await client.query('INSERT INTO integration_audit (tenant_id,user_id,id,action,resource,success) VALUES ($1,$2,$3,$4,$5,$6)', [owner.tenantId, owner.userId, randomUUID(), action, resource, success]); });
  }
  async putArtifact(owner: WorkspaceOwner, value: Omit<InputArtifact, 'tenantId' | 'userId' | 'id'>, retention: ArtifactRetention = OWNER_ARTIFACT_RETENTION): Promise<InputArtifact> {
    const id = `artifact-${randomUUID()}`;
    const { ephemeral } = retention;
    const exceeds = (row: Record<string, any>, quota: ArtifactQuota) => Number(row.count) >= quota.files || Number(row.bytes) + value.bytes.length > quota.bytes;
    // A refusal is returned rather than thrown, so the expiry below still commits.
    const refused = await tenantTransaction(this.pool, owner.tenantId, async client => {
      if (ephemeral) {
        // Pool lock before owner lock on every path that takes both, so uploads cannot deadlock.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`artifact-pool:${owner.tenantId}`]);
        // Expired uploads are retired here, under the pool lock, so the pool frees itself without a sweeper.
        await client.query(`UPDATE input_artifacts SET ${RETIRE} WHERE tenant_id=$1 AND expires_at<=NOW() AND archived_at IS NULL`, [owner.tenantId]);
        const pool = (await client.query('SELECT count(*) AS count,COALESCE(sum(octet_length(bytes)),0) AS bytes FROM input_artifacts WHERE tenant_id=$1 AND expires_at IS NOT NULL AND archived_at IS NULL', [owner.tenantId])).rows[0]!;
        if (exceeds(pool, ephemeral.pool)) return 'Shared demo artifact storage is full; try again later';
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`artifact-quota:${owner.tenantId}:${owner.userId}`]);
      const quota = (await client.query('SELECT count(*) AS count,COALESCE(sum(octet_length(bytes)),0) AS bytes FROM input_artifacts WHERE tenant_id=$1 AND user_id=$2 AND archived_at IS NULL', [owner.tenantId, owner.userId])).rows[0]!;
      if (exceeds(quota, retention.owner)) return 'Artifact owner quota exceeded';
      await client.query("INSERT INTO input_artifacts (tenant_id,user_id,id,filename,mime_type,digest,bytes,extracted_text,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()+$9::integer*INTERVAL '1 second')", [owner.tenantId, owner.userId, id, value.filename, value.mimeType, value.digest, value.bytes, value.text, ephemeral?.ttlSeconds ?? null]);
      return undefined;
    });
    if (refused) throw new RuntimeConflictError(refused);
    return { ...owner, ...value, id };
  }
  async getArtifact(owner: WorkspaceOwner, id: string): Promise<InputArtifact | undefined> {
    return tenantTransaction(this.pool, owner.tenantId, async client => (await client.query(`SELECT tenant_id AS "tenantId",user_id AS "userId",id,filename,mime_type AS "mimeType",digest,bytes,extracted_text AS text,created_at AS "createdAt" FROM input_artifacts WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND ${LIVE_ARTIFACT}`, [owner.tenantId, owner.userId, id])).rows[0] as InputArtifact | undefined);
  }
  async archiveArtifact(owner: WorkspaceOwner, id: string): Promise<boolean> {
    return tenantTransaction(this.pool, owner.tenantId, async client => (await client.query(`UPDATE input_artifacts SET ${RETIRE} WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND archived_at IS NULL RETURNING id`, [owner.tenantId, owner.userId, id])).rows.length === 1);
  }
  private async lock(client: RuntimeClient, owner: WorkspaceOwner, lease: RuntimeLease): Promise<void> {
    if (owner.tenantId !== lease.tenantId) throw new LeaseLostError();
    const row = await client.query("SELECT j.run_id FROM runtime_jobs j JOIN runtime_runs r ON r.tenant_id=j.tenant_id AND r.id=j.run_id WHERE j.tenant_id=$1 AND j.run_id=$2 AND r.user_id=$3 AND j.lease_owner=$4 AND j.fencing_token=$5 AND j.status='running' AND j.lease_until>NOW() AND (j.deadline_at IS NULL OR j.deadline_at>NOW()) AND runtime_ancestors_active(j.tenant_id,j.run_id) FOR UPDATE OF j", [owner.tenantId, lease.runId, owner.userId, lease.workerId, lease.fencingToken]);
    if (!row.rows.length) throw new LeaseLostError();
  }
  async assertLease(owner: WorkspaceOwner, lease: RuntimeLease): Promise<void> { await tenantTransaction(this.pool, owner.tenantId, client => this.lock(client, owner, lease)); }
  async receipt(owner: WorkspaceOwner, runId: string, stepId: string): Promise<{ status: string; requestHash: string; result?: Record<string, unknown> } | undefined> {
    return tenantTransaction(this.pool, owner.tenantId, async client => (await client.query('SELECT t.status,t.request_hash AS "requestHash",t.result FROM runtime_tool_receipts t JOIN runtime_runs r ON r.tenant_id=t.tenant_id AND r.id=t.run_id WHERE t.tenant_id=$1 AND t.run_id=$2 AND t.step_id=$3 AND r.user_id=$4', [owner.tenantId, runId, stepId, owner.userId])).rows[0] as { status: string; requestHash: string; result?: Record<string, unknown> } | undefined);
  }
  async beginEffect(owner: WorkspaceOwner, lease: RuntimeLease, stepId: string, proof: ActionProof): Promise<Record<string, unknown> | undefined> {
    return tenantTransaction(this.pool, owner.tenantId, async client => {
      await this.lock(client, owner, lease);
      const step = (await client.query('SELECT data FROM runtime_steps WHERE tenant_id=$1 AND run_id=$2 AND step_id=$3', [owner.tenantId, lease.runId, stepId])).rows[0]?.data;
      const approval = (await client.query("SELECT status FROM runtime_approvals WHERE tenant_id=$1 AND run_id=$2 AND step_id=$3 ORDER BY attempt DESC LIMIT 1", [owner.tenantId, lease.runId, stepId])).rows[0];
      if (!step || integrationDigest(step.actionProof) !== integrationDigest(proof) || step.approvalDecision?.approved !== true || approval?.status !== 'approved') throw new RuntimeConflictError('Effect is not bound to an approved action');
      const connection = (await client.query("SELECT version,status,secret_version,binding_hash FROM workspace_connections WHERE tenant_id=$1 AND user_id=$2 AND connector_id=$3 FOR SHARE", [owner.tenantId, owner.userId, proof.connectorId])).rows[0];
      if (!connection || connection.status !== 'verified' || connection.version !== proof.connectionVersion || connection.secret_version !== proof.secretVersion || connection.binding_hash !== proof.bindingHash) throw new RuntimeConflictError('Approved connection changed');
      const existing = (await client.query('SELECT status,request_hash,result FROM runtime_tool_receipts WHERE tenant_id=$1 AND run_id=$2 AND step_id=$3 FOR UPDATE', [owner.tenantId, lease.runId, stepId])).rows[0];
      if (existing) {
        if (existing.request_hash !== proof.requestHash) throw new RuntimeConflictError('Effect input changed after dispatch');
        if (existing.status === 'completed') return existing.result;
        throw new RuntimeConflictError('Effect requires reconciliation before replay');
      }
      await client.query("INSERT INTO runtime_tool_receipts (tenant_id,run_id,step_id,request_hash,fencing_token,status) VALUES ($1,$2,$3,$4,$5,'dispatching')", [owner.tenantId, lease.runId, stepId, proof.requestHash, lease.fencingToken]);
      return undefined;
    });
  }
  private async observation(client: RuntimeClient, owner: WorkspaceOwner, lease: RuntimeLease, stepId: string, value: ConnectorObservation): Promise<void> {
    const row = (await client.query("SELECT r.mode,s.data,d.data AS definition FROM runtime_runs r JOIN runtime_steps s ON s.tenant_id=r.tenant_id AND s.run_id=r.id JOIN runtime_definitions d ON d.tenant_id=r.tenant_id AND d.hash=r.definition_hash WHERE r.tenant_id=$1 AND r.id=$2 AND r.user_id=$3 AND s.step_id=$4 AND s.status='running'", [owner.tenantId, lease.runId, owner.userId, stepId])).rows[0];
    const proof = row?.data.actionProof as ActionProof | undefined;
    const step = row?.definition.steps?.find((item: { id: string }) => item.id === stepId);
    if (row?.mode !== 'live' || !proof || !step || !['tool_read','tool_effect'].includes(step.kind) || proof.adapterHash !== value.adapterHash || proof.requestHash !== value.requestHash || value.actionId !== `${step.toolId}:${step.toolAction?.action}:${step.toolAction?.resourceType}` || step.toolId !== proof.connectorId) throw new RuntimeConflictError('Conformance observation is not bound to live canonical action evidence');
    if (step.kind === 'tool_effect') {
      const receipt = (await client.query("SELECT result FROM runtime_tool_receipts WHERE tenant_id=$1 AND run_id=$2 AND step_id=$3 AND request_hash=$4 AND status='completed'", [owner.tenantId, lease.runId, stepId, value.requestHash])).rows[0];
      if (!receipt || integrationDigest(receipt.result) !== value.resultHash) throw new RuntimeConflictError('Verified effect receipt required for conformance evidence');
    }
    await client.query('INSERT INTO runtime_connector_observations (tenant_id,user_id,run_id,step_id,action_id,adapter_hash,request_hash,result_hash,connection_version,transport) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING', [owner.tenantId, owner.userId, lease.runId, stepId, value.actionId, value.adapterHash, value.requestHash, value.resultHash, proof.connectionVersion, value.transport]);
  }
  async recordObservation(owner: WorkspaceOwner, lease: RuntimeLease, stepId: string, value: ConnectorObservation): Promise<void> {
    await tenantTransaction(this.pool, owner.tenantId, async client => { await this.lock(client, owner, lease); await this.observation(client, owner, lease, stepId, value); });
  }
  async finishEffect(owner: WorkspaceOwner, lease: RuntimeLease, stepId: string, status: 'completed' | 'failed' | 'inconclusive', result: Record<string, unknown>, observation?: ConnectorObservation): Promise<void> {
    await tenantTransaction(this.pool, owner.tenantId, async client => {
      await this.lock(client, owner, lease);
      const updated = await client.query("UPDATE runtime_tool_receipts SET status=$5,result=$6,updated_at=NOW() WHERE tenant_id=$1 AND run_id=$2 AND step_id=$3 AND fencing_token=$4 AND status='dispatching' RETURNING step_id", [owner.tenantId, lease.runId, stepId, lease.fencingToken, status, JSON.stringify(result)]);
      if (!updated.rows.length) throw new LeaseLostError();
      if (status === 'completed' && observation) await this.observation(client, owner, lease, stepId, observation);
      await client.query('INSERT INTO integration_audit (tenant_id,user_id,id,action,resource,success) VALUES ($1,$2,$3,$4,$5,$6)', [owner.tenantId, owner.userId, randomUUID(), 'connector.effect', `${lease.runId}:${stepId}`, status === 'completed']);
    });
  }
}
