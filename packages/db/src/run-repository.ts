import { createHash, randomUUID } from 'node:crypto';
import { tenantTransaction } from './tenant-transaction.js';
import { EXECUTION_STATUSES, WORKFLOW_PERSONAS, isTerminalExecutionStatus, type ExecutionStatus } from '@agentos/skills/schema';

export interface RuntimeSnapshot {
  id: string;
  tenantId: string;
  userId: string;
  persona: string;
  status: ExecutionStatus;
  mode: 'live' | 'simulation';
  definitionHash: string;
  parentRunId?: string;
  parentStepId?: string;
  rootRunId?: string;
  depth?: number;
  absoluteDeadline?: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, string>;
  steps: Array<{ stepId: string; status: string; outputKey?: string; provenance?: string; draftOutput?: string; approvalDecision?: { approved: boolean; approverId: string }; [key: string]: unknown }>;
  [key: string]: unknown;
}
export interface RuntimeLease { tenantId: string; runId: string; workerId: string; fencingToken: number; attempt: number; deadlineAt?: string }
export interface RuntimeEvent { id: string; tenantId: string; runId: string; type: string; data: Record<string, unknown>; fencingToken: number }
export interface RuntimeClient { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, any>[]; rowCount?: number | null }>; release(): void }
export interface RuntimePool { connect(): Promise<RuntimeClient> }
export class LeaseLostError extends Error { constructor() { super('Execution lease is no longer valid'); } }
export class RuntimeConflictError extends Error { readonly statusCode = 409; }

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
const digest = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex');

export function collectArtifactIds(value: unknown, depth = 0): string[] {
  if (depth > 64) throw new Error('Artifact bindings exceed nesting bounds');
  if (!value || typeof value !== 'object') return [];
  const own = !Array.isArray(value) && typeof (value as { artifactId?: unknown }).artifactId === 'string' ? [(value as { artifactId: string }).artifactId] : [];
  return [...new Set([...own, ...Object.values(value).flatMap(item => collectArtifactIds(item, depth + 1))])];
}

export class PostgresRunRepository {
  constructor(private readonly pool: RuntimePool, private readonly leaseMs = 30_000) {
    if (!Number.isInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300_000) throw new Error('Invalid lease duration');
  }

  private async transaction<T>(tenantId: string, fn: (client: RuntimeClient) => Promise<T>): Promise<T> {
    return tenantTransaction(this.pool, tenantId, fn);
  }

  private async event(client: RuntimeClient, snapshot: RuntimeSnapshot, type: string): Promise<void> {
    const id = randomUUID();
    const job = (await client.query('SELECT attempts,fencing_token FROM runtime_jobs WHERE tenant_id=$1 AND run_id=$2', [snapshot.tenantId, snapshot.id])).rows[0];
    const artifacts = (await client.query('SELECT id,step_id,content_hash,provenance FROM runtime_artifacts WHERE tenant_id=$1 AND run_id=$2', [snapshot.tenantId, snapshot.id])).rows;
    const data = { schemaVersion: 1, eventId: id, tenantId: snapshot.tenantId, actorId: snapshot.userId, runId: snapshot.id, traceId: snapshot.rootRunId ?? snapshot.id, parentRunId: snapshot.parentRunId, definitionHash: snapshot.definitionHash, status: snapshot.status, mode: snapshot.mode, attempt: Number(job?.attempts ?? 0), fencingToken: Number(job?.fencing_token ?? 0), steps: snapshot.steps.map(step => ({ id: step.stepId, agent: step.agent, status: step.status, childRunId: step.childRunId })), artifacts, observedCostUsd: snapshot.totalTokenCost ?? null };
    await client.query('INSERT INTO runtime_events (tenant_id,id,run_id,type,data,created_at) VALUES ($1,$2,$3,$4,$5,clock_timestamp())', [snapshot.tenantId, id, snapshot.id, type, JSON.stringify(data)]);
  }

  private validate(snapshot: RuntimeSnapshot): void {
    if (!snapshot.id || !snapshot.tenantId || !snapshot.userId || !/^[a-f0-9]{64}$/.test(snapshot.definitionHash) || !(WORKFLOW_PERSONAS as readonly string[]).includes(snapshot.persona) || !EXECUTION_STATUSES.includes(snapshot.status) || !['live', 'simulation'].includes(snapshot.mode) || !Array.isArray(snapshot.steps)) throw new Error('Invalid runtime snapshot');
    if (new Set(snapshot.steps.map(step => step.stepId)).size !== snapshot.steps.length) throw new Error('Duplicate runtime step identity');
  }

  private async writeSteps(client: RuntimeClient, snapshot: RuntimeSnapshot, lease?: RuntimeLease): Promise<void> {
    for (const step of snapshot.steps) {
      await client.query('INSERT INTO runtime_steps (tenant_id,run_id,step_id,status,data) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id,run_id,step_id) DO UPDATE SET status=EXCLUDED.status,data=EXCLUDED.data,updated_at=NOW()', [snapshot.tenantId, snapshot.id, step.stepId, step.status, JSON.stringify(step)]);
      if (lease) {
        let current: Record<string, any> | undefined = (await client.query('SELECT * FROM runtime_step_attempts WHERE tenant_id=$1 AND run_id=$2 AND step_id=$3 AND finished_at IS NULL ORDER BY attempt DESC LIMIT 1', [snapshot.tenantId, snapshot.id, step.stepId])).rows[0];
        if (current && current.fencing_token !== lease.fencingToken) {
          await client.query("UPDATE runtime_step_attempts SET status='expired',finished_at=NOW() WHERE tenant_id=$1 AND run_id=$2 AND step_id=$3 AND attempt=$4", [snapshot.tenantId, snapshot.id, step.stepId, current.attempt]);
          current = undefined;
        }
        if (!current && step.status === 'running') {
          const number = Number((await client.query('SELECT COALESCE(max(attempt),0)+1 AS next FROM runtime_step_attempts WHERE tenant_id=$1 AND run_id=$2 AND step_id=$3', [snapshot.tenantId, snapshot.id, step.stepId])).rows[0]!.next);
          await client.query("INSERT INTO runtime_step_attempts (tenant_id,run_id,step_id,attempt,worker_attempt,fencing_token,status,inputs) VALUES ($1,$2,$3,$4,$5,$6,'running',$7)", [snapshot.tenantId, snapshot.id, step.stepId, number, lease.attempt, lease.fencingToken, JSON.stringify({ inputs: snapshot.inputs, bindings: step.inputBindings ?? {} })]);
        } else if (current && step.status === 'running') {
          await client.query('UPDATE runtime_step_attempts SET inputs=$5 WHERE tenant_id=$1 AND run_id=$2 AND step_id=$3 AND attempt=$4', [snapshot.tenantId, snapshot.id, step.stepId, current.attempt, JSON.stringify({ inputs: snapshot.inputs, bindings: step.inputBindings ?? {} })]);
        } else if (current && step.status !== 'pending') {
          await client.query('UPDATE runtime_step_attempts SET status=$5,output=$6,error=$7,finished_at=NOW() WHERE tenant_id=$1 AND run_id=$2 AND step_id=$3 AND attempt=$4', [snapshot.tenantId, snapshot.id, step.stepId, current.attempt, step.status, JSON.stringify(step.outputKey ? snapshot.outputs[step.outputKey] ?? step.draftOutput ?? null : null), step.error ?? null]);
        }
      }
      if (step.outputKey && Object.hasOwn(snapshot.outputs, step.outputKey) && ['completed', 'simulated'].includes(step.status)) {
        const provenance = snapshot.mode === 'simulation' ? 'simulated' : 'live';
        const id = digest([snapshot.id, step.stepId, step.outputKey]);
        const content = JSON.stringify(snapshot.outputs[step.outputKey]);
        const hash = digest(snapshot.outputs[step.outputKey]);
        await client.query('INSERT INTO runtime_artifacts (tenant_id,id,run_id,step_id,output_key,provenance,content,content_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING', [snapshot.tenantId, id, snapshot.id, step.stepId, step.outputKey, provenance, content, hash]);
        const artifact = (await client.query('SELECT content,provenance FROM runtime_artifacts WHERE tenant_id=$1 AND id=$2', [snapshot.tenantId, id])).rows[0];
        if (!artifact || digest(artifact.content) !== hash || artifact.provenance !== provenance) throw new RuntimeConflictError('Committed artifact cannot be overwritten');
        const dependencies = Array.isArray(step.dependsOn) ? step.dependsOn as string[] : snapshot.steps.slice(0, snapshot.steps.indexOf(step)).map(previous => previous.stepId);
        if (typeof step.childRunId === 'string') {
          await client.query('INSERT INTO runtime_artifact_parents (tenant_id,artifact_id,parent_id) SELECT a.tenant_id,$3,a.id FROM runtime_children c JOIN runtime_artifacts a ON a.tenant_id=c.tenant_id AND a.run_id=c.child_run_id WHERE c.tenant_id=$1 AND c.parent_run_id=$2 AND c.parent_step_id=$4 AND c.child_run_id=$5 ON CONFLICT DO NOTHING', [snapshot.tenantId, snapshot.id, id, step.stepId, step.childRunId]);
        }
        for (const dependency of dependencies) {
          await client.query('INSERT INTO runtime_artifact_parents (tenant_id,artifact_id,parent_id) SELECT tenant_id,$3,id FROM runtime_artifacts WHERE tenant_id=$1 AND run_id=$2 AND step_id=$4 ON CONFLICT DO NOTHING', [snapshot.tenantId, snapshot.id, id, dependency]);
        }
      }
    }
  }

  async submit(snapshot: RuntimeSnapshot, definition: Record<string, unknown>, payload: unknown, requestKey?: string, session?: { tenantId: string; client: RuntimeClient }): Promise<RuntimeSnapshot> {
    this.validate(snapshot);
    if (snapshot.parentRunId && !session) throw new Error('Child admission requires a parent transaction');
    if (!snapshot.parentRunId) { snapshot.rootRunId = snapshot.id; snapshot.depth = 0; }
    if (snapshot.status !== 'queued' || definition.definitionHash !== snapshot.definitionHash || (requestKey && requestKey.length > 200)) throw new Error('Invalid runtime admission');
    const options = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const maxAttempts = options.maxAttempts ?? 3;
    const timeoutMs = options.timeoutMs ?? 900_000;
    const priority = options.priority ?? 50;
    const runTimeoutMs = options.runTimeoutMs;
    if (!Number.isInteger(priority) || Number(priority) < 0 || Number(priority) > 100 || runTimeoutMs !== undefined && (!Number.isInteger(runTimeoutMs) || Number(runTimeoutMs) < 1000 || Number(runTimeoutMs) > 604_800_000)) throw new Error('Invalid execution priority/deadline');
    if (!snapshot.parentRunId && runTimeoutMs !== undefined) snapshot.absoluteDeadline = new Date(Date.now() + Number(runTimeoutMs)).toISOString();
    if (!Number.isInteger(maxAttempts) || Number(maxAttempts) < 1 || Number(maxAttempts) > 10 || !Number.isInteger(timeoutMs) || Number(timeoutMs) < 1000 || Number(timeoutMs) > 86_400_000) throw new Error('Invalid worker retry/deadline policy');
    const request = { userId: snapshot.userId, definitionHash: snapshot.definitionHash, inputs: snapshot.inputs, mode: snapshot.mode, provider: options.provider, modelId: options.modelId, customPrompt: options.customPrompt };
    const requestHash = digest({ ...request, maxAttempts, timeoutMs, ...(priority !== 50 ? { priority } : {}), ...(runTimeoutMs !== undefined ? { runTimeoutMs } : {}) });
    const legacyHash = maxAttempts === 3 && timeoutMs === 900_000 && priority === 50 && runTimeoutMs === undefined ? digest(request) : undefined;
    const operation = async (client: RuntimeClient): Promise<RuntimeSnapshot> => {
      const authority = (await client.query('SELECT runtime_actor_active($1,$2,$3::jsonb) AS active', [snapshot.tenantId, snapshot.userId, JSON.stringify(snapshot.requiredPersonas ?? [snapshot.persona])])).rows[0];
      if (!authority?.active) throw new RuntimeConflictError('Run owner membership no longer permits this workflow');
      await client.query('INSERT INTO runtime_definitions (tenant_id,hash,definition_id,version,data) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [snapshot.tenantId, snapshot.definitionHash, definition.id, definition.version, JSON.stringify(definition)]);
      const inserted = await client.query('INSERT INTO runtime_runs (tenant_id,id,user_id,persona,definition_hash,status,mode,snapshot,request_key,request_hash,parent_run_id,root_run_id,depth,deadline_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (tenant_id,user_id,request_key) DO NOTHING RETURNING snapshot', [snapshot.tenantId, snapshot.id, snapshot.userId, snapshot.persona, snapshot.definitionHash, snapshot.status, snapshot.mode, JSON.stringify(snapshot), requestKey ?? null, requestHash, snapshot.parentRunId ?? null, snapshot.rootRunId ?? snapshot.id, snapshot.depth ?? 0, snapshot.absoluteDeadline ?? null]);
      if (!inserted.rows.length) {
        const previous = await client.query('SELECT snapshot,request_hash FROM runtime_runs WHERE tenant_id=$1 AND user_id=$2 AND request_key=$3', [snapshot.tenantId, snapshot.userId, requestKey]);
        if (!previous.rows[0] || previous.rows[0].request_hash !== requestHash && previous.rows[0].request_hash !== legacyHash) throw new RuntimeConflictError('Idempotency key was already used for different work');
        return previous.rows[0]!.snapshot as RuntimeSnapshot;
      }
      const artifacts = [...new Set([...collectArtifactIds(snapshot.inputs), ...collectArtifactIds(definition)])];
      if (artifacts.length > 20) throw new RuntimeConflictError('Too many input artifacts');
      for (const id of artifacts) {
        const artifact = (await client.query('SELECT digest FROM input_artifacts WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND archived_at IS NULL FOR SHARE', [snapshot.tenantId, snapshot.userId, id])).rows[0];
        if (!artifact) throw new RuntimeConflictError('Input artifact is unavailable to this owner');
        await client.query('INSERT INTO runtime_input_artifacts (tenant_id,run_id,artifact_id,digest) VALUES ($1,$2,$3,$4)', [snapshot.tenantId, snapshot.id, id, artifact.digest]);
      }
      await client.query("INSERT INTO runtime_jobs (tenant_id,run_id,status,payload,max_attempts,priority) VALUES ($1,$2,'queued',$3,$4,$5)", [snapshot.tenantId, snapshot.id, JSON.stringify({ ...options, timeoutMs, priority }), maxAttempts, priority]);
      await this.writeSteps(client, snapshot);
      await this.event(client, snapshot, 'execution.queued');
      return snapshot;
    };
    if (session) {
      if (session.tenantId !== snapshot.tenantId) throw new Error('Transaction tenant does not match run');
      return operation(session.client);
    }
    return this.transaction(snapshot.tenantId, operation);
  }

  async get(tenantId: string, id: string): Promise<RuntimeSnapshot | undefined> {
    return this.transaction(tenantId, async client => (await client.query('SELECT snapshot FROM runtime_runs WHERE tenant_id=$1 AND id=$2', [tenantId, id])).rows[0]?.snapshot);
  }

  async decisions(tenantId: string, runId: string): Promise<Array<{ stepId: string; approved: boolean; approverId: string; reason?: string }>> {
    return this.transaction(tenantId, async client => (await client.query("SELECT * FROM (SELECT DISTINCT ON (step_id) step_id,status,decided_by,reason FROM runtime_approvals WHERE tenant_id=$1 AND run_id=$2 ORDER BY step_id,attempt DESC) decisions WHERE status<>'pending'", [tenantId, runId])).rows.map(row => ({ stepId: row.step_id, approved: row.status === 'approved', approverId: row.decided_by ?? 'system', reason: row.reason ?? undefined })));
  }

  async children(tenantId: string, parentRunId: string): Promise<RuntimeSnapshot[]> {
    return this.transaction(tenantId, async client => (await client.query('SELECT r.snapshot FROM runtime_children c JOIN runtime_runs r ON r.tenant_id=c.tenant_id AND r.id=c.child_run_id WHERE c.tenant_id=$1 AND c.parent_run_id=$2 ORDER BY c.parent_step_id', [tenantId, parentRunId])).rows.map(row => row.snapshot));
  }

  async spawnChild(lease: RuntimeLease, parent: RuntimeSnapshot, stepId: string, candidate: RuntimeSnapshot, definition: Record<string, unknown>, payload: unknown): Promise<RuntimeSnapshot> {
    if (parent.id !== lease.runId || parent.tenantId !== lease.tenantId || candidate.tenantId !== lease.tenantId || candidate.userId !== parent.userId || candidate.mode !== parent.mode) throw new RuntimeConflictError('Child identity must match its parent');
    return this.transaction(lease.tenantId, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`run-tree:${lease.tenantId}`]);
      const current = await this.lock(client, lease);
      const storedDefinition = (await client.query('SELECT data FROM runtime_definitions WHERE tenant_id=$1 AND hash=$2', [lease.tenantId, current.definitionHash])).rows[0]!.data;
      const declared = storedDefinition.steps.find((step: { id: string }) => step.id === stepId);
      const childMatches = declared?.kind === 'subworkflow' && declared.subworkflow?.definition?.definitionHash === definition.definitionHash;
      const allowed = new Set((declared?.planCandidates ?? []).map((item: { definitionHash: string }) => item.definitionHash));
      const plannedSteps = definition.steps as Array<{ kind: string; subworkflow?: { definition: { definitionHash: string } } }> | undefined;
      const planMatches = declared?.kind === 'planner' && plannedSteps?.length && plannedSteps.length <= 12 && plannedSteps.every(step => step.kind === 'subworkflow' && allowed.has(step.subworkflow?.definition.definitionHash));
      if ((!childMatches && !planMatches) || candidate.definitionHash !== definition.definitionHash) throw new RuntimeConflictError('Child does not match the frozen subworkflow definition');
      const existing = (await client.query('SELECT r.snapshot FROM runtime_children c JOIN runtime_runs r ON r.tenant_id=c.tenant_id AND r.id=c.child_run_id WHERE c.tenant_id=$1 AND c.parent_run_id=$2 AND c.parent_step_id=$3', [lease.tenantId, lease.runId, stepId])).rows[0]?.snapshot as RuntimeSnapshot | undefined;
      if (existing) {
        if (existing.definitionHash !== candidate.definitionHash || digest(existing.inputs) !== digest(candidate.inputs)) throw new RuntimeConflictError('Child request changed after admission');
        return existing;
      }
      const row = (await client.query('SELECT COALESCE(r.root_run_id,r.id) AS root,r.depth,j.priority,j.payload FROM runtime_runs r JOIN runtime_jobs j ON j.tenant_id=r.tenant_id AND j.run_id=r.id WHERE r.tenant_id=$1 AND r.id=$2', [lease.tenantId, lease.runId])).rows[0]!;
      if (row.depth >= 5) throw new RuntimeConflictError('Subworkflow depth limit exceeded');
      const count = Number((await client.query('SELECT count(*) AS total FROM runtime_runs WHERE tenant_id=$1 AND (root_run_id=$2 OR id=$2)', [lease.tenantId, row.root])).rows[0]!.total);
      if (count >= 128) throw new RuntimeConflictError('Subworkflow tree size limit exceeded');
      const child = { ...structuredClone(candidate), parentRunId: lease.runId, parentStepId: stepId, rootRunId: row.root as string, depth: Number(row.depth) + 1, absoluteDeadline: current.absoluteDeadline };
      const inherited = { ...(payload && typeof payload === 'object' ? payload : {}), priority: row.priority, timeoutMs: row.payload.timeoutMs ?? 900_000 };
      const admitted = await this.submit(child, definition, inherited, `child:${digest([lease.runId, stepId])}`, { tenantId: lease.tenantId, client });
      await client.query('INSERT INTO runtime_children (tenant_id,parent_run_id,parent_step_id,child_run_id) VALUES ($1,$2,$3,$4)', [lease.tenantId, lease.runId, stepId, admitted.id]);
      const updated = structuredClone(parent);
      const step = updated.steps.find(item => item.stepId === stepId);
      if (!step) throw new Error('Parent step is unavailable');
      step.childRunId = admitted.id; step.status = 'pending';
      await this.save(client, lease, updated);
      return admitted;
    });
  }

  async trace(tenantId: string, runId: string): Promise<{ attempts: Record<string, unknown>[]; artifacts: Record<string, unknown>[]; lineage: Record<string, unknown>[] }> {
    return this.transaction(tenantId, async client => ({
      attempts: (await client.query('SELECT step_id,attempt,worker_attempt,status,inputs,output,error,started_at,finished_at FROM runtime_step_attempts WHERE tenant_id=$1 AND run_id=$2 ORDER BY started_at,step_id,attempt', [tenantId, runId])).rows,
      artifacts: (await client.query('SELECT id,step_id,output_key,provenance,schema_version,content_hash,created_at FROM runtime_artifacts WHERE tenant_id=$1 AND run_id=$2 ORDER BY created_at,id', [tenantId, runId])).rows,
      lineage: (await client.query('SELECT p.artifact_id,p.parent_id FROM runtime_artifact_parents p JOIN runtime_artifacts a ON a.tenant_id=p.tenant_id AND a.id=p.artifact_id WHERE p.tenant_id=$1 AND a.run_id=$2 ORDER BY p.artifact_id,p.parent_id', [tenantId, runId])).rows,
    }));
  }

  async list(tenantId: string, userId?: string, limit = 20, offset = 0, filters: { persona?: string; status?: string; personas?: string[]; source?: string } = {}): Promise<{ executions: RuntimeSnapshot[]; total: number }> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw new Error('Invalid pagination');
    return this.transaction(tenantId, async client => {
      const predicate = 'tenant_id=$1 AND ($2::text IS NULL OR user_id=$2) AND ($3::text IS NULL OR persona=$3) AND ($4::text IS NULL OR status=$4) AND ($5::text[] IS NULL OR persona=ANY($5) AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(snapshot->\'requiredPersonas\',\'[]\'::jsonb)) required(persona) WHERE NOT required.persona=ANY($5))) AND ($6::text IS NULL OR snapshot->\'source\'->>\'type\'=$6)';
      const values = [tenantId, userId ?? null, filters.persona ?? null, filters.status ?? null, filters.personas ?? null, filters.source ?? null];
      const rows = await client.query(`SELECT snapshot FROM runtime_runs WHERE ${predicate} ORDER BY created_at DESC,id LIMIT $7 OFFSET $8`, [...values, limit, offset]);
      const count = await client.query(`SELECT count(*) AS total FROM runtime_runs WHERE ${predicate}`, values);
      return { executions: rows.rows.map(row => row.snapshot), total: Number(count.rows[0]!.total) };
    });
  }

  private async expireApprovals(client: RuntimeClient, tenantId: string): Promise<void> {
    const expired = await client.query("SELECT a.run_id,a.step_id,a.attempt FROM runtime_approvals a JOIN runtime_jobs j ON j.tenant_id=a.tenant_id AND j.run_id=a.run_id WHERE a.tenant_id=$1 AND a.status='pending' AND a.expires_at<NOW() AND j.status='waiting' FOR UPDATE OF j SKIP LOCKED", [tenantId]);
    for (const approval of expired.rows) {
      const snapshot = (await client.query('SELECT snapshot FROM runtime_runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenantId, approval.run_id])).rows[0]?.snapshot as RuntimeSnapshot | undefined;
      if (!snapshot || snapshot.status !== 'paused') continue;
      snapshot.status = 'rejected';
      snapshot.completedAt = new Date().toISOString();
      const step = snapshot.steps.find(value => value.stepId === approval.step_id);
      if (step) { step.status = 'rejected'; step.error = 'Approval expired'; }
      await client.query("UPDATE runtime_approvals SET status='expired',decided_at=NOW(),reason='Approval expired' WHERE tenant_id=$1 AND run_id=$2 AND step_id=$3 AND attempt=$4", [tenantId, approval.run_id, approval.step_id, approval.attempt]);
      await client.query("UPDATE runtime_runs SET status='rejected',snapshot=$3,updated_at=NOW() WHERE tenant_id=$1 AND id=$2", [tenantId, approval.run_id, JSON.stringify(snapshot)]);
      await client.query("UPDATE runtime_jobs SET status='failed',fencing_token=fencing_token+1 WHERE tenant_id=$1 AND run_id=$2", [tenantId, approval.run_id]);
      await this.writeSteps(client, snapshot);
      await this.event(client, snapshot, 'approval.expired');
    }
  }

  private async wakeBlocked(client: RuntimeClient, tenantId: string): Promise<void> {
    const ready = await client.query("SELECT j.run_id FROM runtime_jobs j WHERE j.tenant_id=$1 AND j.status='waiting' AND (j.wake_at<=NOW() OR EXISTS (SELECT 1 FROM runtime_children c JOIN runtime_runs child ON child.tenant_id=c.tenant_id AND child.id=c.child_run_id JOIN runtime_steps s ON s.tenant_id=c.tenant_id AND s.run_id=c.parent_run_id AND s.step_id=c.parent_step_id WHERE c.tenant_id=j.tenant_id AND c.parent_run_id=j.run_id AND s.status='pending' AND child.status IN ('completed','simulated','failed','rejected','cancelled','unsupported','inconclusive'))) FOR UPDATE OF j SKIP LOCKED", [tenantId]);
    for (const row of ready.rows) {
      await client.query("UPDATE runtime_runs SET status='queued',snapshot=jsonb_set(snapshot,'{status}','\"queued\"'),updated_at=NOW() WHERE tenant_id=$1 AND id=$2 AND status='paused'", [tenantId, row.run_id]);
      await client.query("UPDATE runtime_jobs SET status='queued',available_at=NOW(),wake_at=NULL,retry_count=0 WHERE tenant_id=$1 AND run_id=$2", [tenantId, row.run_id]);
    }
  }

  async park(lease: RuntimeLease, snapshot: RuntimeSnapshot): Promise<void> {
    if (snapshot.steps.some(step => step.status === 'running')) throw new RuntimeConflictError('Active parallel nodes must settle before suspension');
    const waiting = structuredClone(snapshot);
    waiting.status = 'paused';
    const times = waiting.steps.filter(step => step.status === 'pending').flatMap(step => {
      const value = step.resumeAfter ?? step.waitUntil;
      if (typeof value !== 'string') return [];
      const time = new Date(value).getTime();
      if (!Number.isFinite(time) || time > Date.now() + 604_800_000) throw new Error('Invalid continuation time');
      return [time];
    });
    await this.transaction(lease.tenantId, async client => {
      await this.save(client, lease, waiting);
      let continueNow = false;
      for (const step of waiting.steps.filter(value => value.status === 'approval_required')) {
        const pending = (await client.query('SELECT artifact_digest,status,decided_by FROM runtime_approvals WHERE tenant_id=$1 AND run_id=$2 AND step_id=$3 ORDER BY attempt DESC LIMIT 1', [lease.tenantId, lease.runId, step.stepId])).rows[0];
        if (pending && pending.artifact_digest !== digest(step)) throw new RuntimeConflictError('Pending approval draft changed');
        if (pending?.status === 'approved') {
          step.approvalDecision = { approved: true, approverId: pending.decided_by }; step.status = 'pending'; continueNow = true;
        } else if (pending && pending.status !== 'pending') throw new RuntimeConflictError('Approval is no longer pending');
        if (!pending) await client.query("INSERT INTO runtime_approvals (tenant_id,run_id,step_id,attempt,status,artifact_digest,expires_at) VALUES ($1,$2,$3,$4,'pending',$5,NOW()+($6 * INTERVAL '1 millisecond'))", [lease.tenantId, lease.runId, step.stepId, lease.attempt, digest(step), Number(step.approvalTimeoutMs ?? 86_400_000)]);
      }
      const hasChild = waiting.steps.some(step => step.status === 'pending' && typeof step.childRunId === 'string');
      if (!continueNow && !times.length && !hasChild && !waiting.steps.some(step => step.status === 'approval_required')) throw new RuntimeConflictError('No durable continuation was declared');
      if (continueNow) { waiting.status = 'queued'; await this.save(client, lease, waiting); }
      await client.query('UPDATE runtime_jobs SET status=$3,available_at=NOW(),retry_count=0,lease_owner=NULL,lease_until=NULL,deadline_at=NULL,wake_at=$4 WHERE tenant_id=$1 AND run_id=$2', [lease.tenantId, lease.runId, continueNow ? 'queued' : 'waiting', times.length ? new Date(Math.min(...times)) : null]);
      await client.query("UPDATE runtime_attempts SET status='waiting',finished_at=NOW() WHERE tenant_id=$1 AND run_id=$2 AND attempt=$3", [lease.tenantId, lease.runId, lease.attempt]);
      await client.query("UPDATE runtime_step_attempts SET status='waiting',finished_at=NOW() WHERE tenant_id=$1 AND run_id=$2 AND fencing_token=$3 AND finished_at IS NULL", [lease.tenantId, lease.runId, lease.fencingToken]);
    });
  }

  async claim(tenantId: string, workerId: string): Promise<{ snapshot: RuntimeSnapshot; definition: Record<string, unknown>; payload: unknown; lease: RuntimeLease } | undefined> {
    if (!workerId) throw new Error('Worker identity is required');
    const unauthorized = await this.transaction(tenantId, async client => (await client.query("SELECT id FROM runtime_runs WHERE tenant_id=$1 AND parent_run_id IS NULL AND status IN ('queued','running','paused') AND NOT runtime_actor_active(tenant_id,user_id,COALESCE(snapshot->'requiredPersonas','[]')) LIMIT 128", [tenantId])).rows.map(row => row.id as string));
    for (const root of unauthorized) await this.cancelTree(tenantId, root, undefined, false);
    const expiredTrees = await this.transaction(tenantId, async client => (await client.query("SELECT id FROM runtime_runs WHERE tenant_id=$1 AND parent_run_id IS NULL AND deadline_at<=NOW() AND status IN ('queued','running','paused') LIMIT 128", [tenantId])).rows.map(row => row.id as string));
    for (const root of expiredTrees) await this.cancelTree(tenantId, root, undefined, false, 'Workflow tree deadline exceeded');
    const invalidParents = await this.transaction(tenantId, async client => (await client.query("SELECT DISTINCT p.id FROM runtime_runs p JOIN runtime_runs c ON c.tenant_id=p.tenant_id AND c.parent_run_id=p.id WHERE p.tenant_id=$1 AND p.status IN ('failed','rejected','cancelled','unsupported','inconclusive') AND c.status IN ('queued','running','paused') LIMIT 128", [tenantId])).rows.map(row => row.id as string));
    for (const parent of invalidParents) await this.cancelTree(tenantId, parent, undefined, true);
    return this.transaction(tenantId, async client => {
      await this.expireApprovals(client, tenantId);
      await this.wakeBlocked(client, tenantId);
      const timedOut = await client.query("UPDATE runtime_jobs SET status='failed',last_error='Execution deadline exceeded',fencing_token=fencing_token+1,lease_owner=NULL,lease_until=NULL WHERE tenant_id=$1 AND status='running' AND deadline_at<=NOW() RETURNING run_id", [tenantId]);
      for (const row of timedOut.rows) {
        const snapshot = (await client.query('SELECT snapshot FROM runtime_runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenantId, row.run_id])).rows[0]?.snapshot as RuntimeSnapshot | undefined;
        if (!snapshot || isTerminalExecutionStatus(snapshot.status)) continue;
        snapshot.status = snapshot.steps.some(step => step.status === 'running' && step.kind === 'tool_effect') ? 'inconclusive' : 'failed';
        snapshot.completedAt = new Date().toISOString();
        for (const step of snapshot.steps) if (step.status === 'running') { step.status = snapshot.status; step.error = 'Execution deadline exceeded'; }
        await client.query('UPDATE runtime_runs SET status=$3,snapshot=$4,updated_at=NOW() WHERE tenant_id=$1 AND id=$2', [tenantId, row.run_id, snapshot.status, JSON.stringify(snapshot)]);
        await client.query("UPDATE runtime_attempts SET status='failed',error='Execution deadline exceeded',finished_at=NOW() WHERE tenant_id=$1 AND run_id=$2 AND status='running'", [tenantId, row.run_id]);
        await client.query("UPDATE runtime_step_attempts SET status='failed',error='Execution deadline exceeded',finished_at=NOW() WHERE tenant_id=$1 AND run_id=$2 AND finished_at IS NULL", [tenantId, row.run_id]);
        await this.writeSteps(client, snapshot);
        await this.event(client, snapshot, 'execution.deadline');
      }
      const expired = await client.query("UPDATE runtime_jobs SET status='failed',last_error='Lease retries exhausted',lease_owner=NULL,lease_until=NULL WHERE tenant_id=$1 AND status='running' AND lease_until<NOW() AND retry_count>=max_attempts RETURNING run_id", [tenantId]);
      for (const row of expired.rows) await client.query("UPDATE runtime_runs SET status='failed',snapshot=jsonb_set(snapshot,'{status}','\"failed\"'),updated_at=NOW() WHERE tenant_id=$1 AND id=$2 AND status IN ('queued','running')", [tenantId, row.run_id]);
      const selected = await client.query("SELECT j.* FROM runtime_jobs j JOIN runtime_runs r ON r.tenant_id=j.tenant_id AND r.id=j.run_id WHERE j.tenant_id=$1 AND runtime_ancestors_active(j.tenant_id,j.run_id) AND r.status IN ('queued','running') AND j.retry_count<j.max_attempts AND ((j.status='queued' AND j.available_at<=NOW()) OR (j.status='running' AND j.lease_until<NOW())) ORDER BY j.priority DESC,j.created_at FOR UPDATE OF j SKIP LOCKED LIMIT 1", [tenantId]);
      const job = selected.rows[0];
      if (!job) return undefined;
      await client.query("UPDATE runtime_attempts SET status='expired',finished_at=NOW() WHERE tenant_id=$1 AND run_id=$2 AND status='running'", [tenantId, job.run_id]);
      const updated = await client.query("UPDATE runtime_jobs SET status='running',lease_owner=$3,lease_until=NOW()+($4 * INTERVAL '1 millisecond'),deadline_at=LEAST(NOW()+($5 * INTERVAL '1 millisecond'),(SELECT r.deadline_at FROM runtime_runs r WHERE r.tenant_id=$1 AND r.id=$2)),fencing_token=fencing_token+1,attempts=attempts+1,retry_count=retry_count+1 WHERE tenant_id=$1 AND run_id=$2 RETURNING *", [tenantId, job.run_id, workerId, this.leaseMs, Number(job.payload.timeoutMs ?? 900_000)]);
      const current = updated.rows[0]!;
      const lease = { tenantId, runId: job.run_id as string, workerId, fencingToken: current.fencing_token as number, attempt: current.attempts as number, deadlineAt: new Date(current.deadline_at).toISOString() };
      await client.query("INSERT INTO runtime_attempts (tenant_id,run_id,attempt,fencing_token,worker_id,status) VALUES ($1,$2,$3,$4,$5,'running')", [tenantId, job.run_id, lease.attempt, lease.fencingToken, workerId]);
      await client.query("UPDATE runtime_runs SET status='running',snapshot=jsonb_set(snapshot,'{status}','\"running\"'),updated_at=NOW() WHERE tenant_id=$1 AND id=$2", [tenantId, job.run_id]);
      const run = (await client.query('SELECT r.snapshot,d.data AS definition FROM runtime_runs r JOIN runtime_definitions d ON d.tenant_id=r.tenant_id AND d.hash=r.definition_hash WHERE r.tenant_id=$1 AND r.id=$2', [tenantId, job.run_id])).rows[0]!;
      return { snapshot: run.snapshot, definition: run.definition, payload: job.payload, lease };
    });
  }

  async heartbeat(lease: RuntimeLease): Promise<boolean> {
    return this.transaction(lease.tenantId, async client => (await client.query("UPDATE runtime_jobs SET lease_until=NOW()+($5 * INTERVAL '1 millisecond') WHERE tenant_id=$1 AND run_id=$2 AND lease_owner=$3 AND fencing_token=$4 AND status='running' AND lease_until>NOW() AND (deadline_at IS NULL OR deadline_at>NOW()) AND runtime_ancestors_active($1,$2) RETURNING run_id", [lease.tenantId, lease.runId, lease.workerId, lease.fencingToken, this.leaseMs])).rows.length === 1);
  }

  private async lock(client: RuntimeClient, lease: RuntimeLease): Promise<RuntimeSnapshot> {
    const job = await client.query("SELECT run_id FROM runtime_jobs WHERE tenant_id=$1 AND run_id=$2 AND lease_owner=$3 AND fencing_token=$4 AND status='running' AND lease_until>NOW() AND (deadline_at IS NULL OR deadline_at>NOW()) AND runtime_ancestors_active($1,$2) FOR UPDATE", [lease.tenantId, lease.runId, lease.workerId, lease.fencingToken]);
    if (!job.rows.length) throw new LeaseLostError();
    const row = (await client.query('SELECT snapshot FROM runtime_runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [lease.tenantId, lease.runId])).rows[0];
    if (!row || isTerminalExecutionStatus(row.snapshot.status)) throw new LeaseLostError();
    return row.snapshot;
  }

  private async save(client: RuntimeClient, lease: RuntimeLease, snapshot: RuntimeSnapshot): Promise<void> {
    this.validate(snapshot);
    if (snapshot.id !== lease.runId || snapshot.tenantId !== lease.tenantId) throw new Error('Lease and snapshot identities differ');
    const previous = await this.lock(client, lease);
    if (previous.userId !== snapshot.userId || previous.definitionHash !== snapshot.definitionHash || previous.mode !== snapshot.mode || previous.parentRunId !== snapshot.parentRunId || previous.rootRunId !== snapshot.rootRunId || previous.depth !== snapshot.depth || previous.absoluteDeadline !== snapshot.absoluteDeadline || digest(previous.source ?? null) !== digest(snapshot.source ?? null) || digest(previous.requiredPersonas ?? []) !== digest(snapshot.requiredPersonas ?? [])) throw new Error('Execution ownership/definition cannot change');
    for (const committed of previous.steps.filter(step => ['completed','simulated'].includes(step.status))) {
      const next = snapshot.steps.find(step => step.stepId === committed.stepId);
      if (!next || next.status !== committed.status || next.provenance !== committed.provenance || !committed.outputKey || snapshot.outputs[committed.outputKey] !== previous.outputs[committed.outputKey]) throw new RuntimeConflictError('Committed node progress cannot move backwards');
    }
    if (['completed', 'simulated'].includes(snapshot.status)) {
      const definition = (await client.query('SELECT data FROM runtime_definitions WHERE tenant_id=$1 AND hash=$2', [lease.tenantId, snapshot.definitionHash])).rows[0]?.data;
      const definedSteps = definition?.steps as Array<{ id: string; outputKey: string; kind?: string }> | undefined;
      if (!definedSteps || definedSteps.length !== snapshot.steps.length || definedSteps.some(step => !snapshot.steps.some(actual => actual.stepId === step.id && actual.outputKey === step.outputKey))) throw new Error('Execution steps do not match the immutable definition');
      const children = (await client.query('SELECT c.parent_step_id,c.child_run_id,r.status FROM runtime_children c JOIN runtime_runs r ON r.tenant_id=c.tenant_id AND r.id=c.child_run_id WHERE c.tenant_id=$1 AND c.parent_run_id=$2', [lease.tenantId, lease.runId])).rows;
      if (definedSteps.some(step => ['subworkflow','planner'].includes(step.kind ?? '') && snapshot.steps.find(state => state.stepId === step.id)?.status !== 'skipped' && !children.some(child => child.parent_step_id === step.id))) throw new Error('Subworkflow output has no child execution');
      if (children.some(child => !['completed','simulated'].includes(child.status) || !snapshot.steps.some(step => step.stepId === child.parent_step_id && step.childRunId === child.child_run_id))) throw new Error('Required child run has not completed');
      const expected = snapshot.mode === 'simulation' ? 'simulated' : 'completed';
      if (snapshot.status !== expected || !snapshot.steps.length || snapshot.steps.some(step => step.status !== expected && step.status !== 'skipped') || !snapshot.steps.some(step => step.status === expected) || snapshot.steps.some(step => step.status === expected && (step.provenance !== (snapshot.mode === 'simulation' ? 'simulated' : 'live') || !step.outputKey || typeof snapshot.outputs[step.outputKey] !== 'string' || !snapshot.outputs[step.outputKey]?.trim()))) throw new Error('Execution has unconfirmed required work');
    }
    await client.query('UPDATE runtime_runs SET status=$3,snapshot=$4,updated_at=NOW() WHERE tenant_id=$1 AND id=$2', [lease.tenantId, lease.runId, snapshot.status, JSON.stringify(snapshot)]);
    await this.writeSteps(client, snapshot, lease);
    await this.event(client, snapshot, `execution.${snapshot.status}`);
  }

  async checkpoint(lease: RuntimeLease, snapshot: RuntimeSnapshot): Promise<void> {
    await this.transaction(lease.tenantId, async client => {
      await this.save(client, lease, snapshot);
      if (isTerminalExecutionStatus(snapshot.status)) {
        const status = snapshot.status === 'completed' || snapshot.status === 'simulated' ? 'completed' : snapshot.status === 'cancelled' ? 'cancelled' : 'failed';
        await client.query('UPDATE runtime_jobs SET status=$3,lease_owner=NULL,lease_until=NULL WHERE tenant_id=$1 AND run_id=$2', [lease.tenantId, lease.runId, status]);
        await client.query('UPDATE runtime_attempts SET status=$4,finished_at=NOW() WHERE tenant_id=$1 AND run_id=$2 AND attempt=$3', [lease.tenantId, lease.runId, lease.attempt, status]);
      }
    });
    if (isTerminalExecutionStatus(snapshot.status) && !['completed','simulated'].includes(snapshot.status)) await this.cancelTree(lease.tenantId, lease.runId, undefined, true);
  }

  async fail(lease: RuntimeLease, snapshot: RuntimeSnapshot, message: string, retryable: boolean): Promise<RuntimeSnapshot> {
    const result = await this.transaction(lease.tenantId, async client => {
      await this.lock(client, lease);
      const job = (await client.query('SELECT retry_count,max_attempts FROM runtime_jobs WHERE tenant_id=$1 AND run_id=$2', [lease.tenantId, lease.runId])).rows[0]!;
      const retry = retryable && job.retry_count < job.max_attempts;
      const next = structuredClone(snapshot);
      next.status = retry ? 'queued' : 'failed';
      if (retry) {
        delete next.completedAt;
        for (const step of next.steps) if (step.status === 'failed' || step.status === 'running') { step.status = 'pending'; delete step.error; }
      }
      await this.save(client, lease, next);
      await client.query("UPDATE runtime_jobs SET status=$3,last_error=$4,available_at=NOW()+($5 * INTERVAL '1 millisecond'),lease_owner=NULL,lease_until=NULL WHERE tenant_id=$1 AND run_id=$2", [lease.tenantId, lease.runId, retry ? 'queued' : 'failed', message, Math.min(30_000, 1000 * 2 ** (job.retry_count - 1))]);
      await client.query("UPDATE runtime_attempts SET status='failed',error=$4,finished_at=NOW() WHERE tenant_id=$1 AND run_id=$2 AND attempt=$3", [lease.tenantId, lease.runId, lease.attempt, message]);
      await client.query("UPDATE runtime_step_attempts SET status='failed',error=$4,finished_at=NOW() WHERE tenant_id=$1 AND run_id=$2 AND fencing_token=$3 AND finished_at IS NULL", [lease.tenantId, lease.runId, lease.fencingToken, message]);
      return next;
    });
    if (result.status === 'failed') await this.cancelTree(lease.tenantId, lease.runId, undefined, true);
    return result;
  }

  async acquireAgent(lease: RuntimeLease, stepId: string, agentId: string, perAgent = 2, perTenant = 8): Promise<boolean> {
    if (!agentId || !Number.isInteger(perAgent) || perAgent < 1 || !Number.isInteger(perTenant) || perTenant < 1) throw new Error('Invalid agent capacity');
    return this.transaction(lease.tenantId, async client => {
      await this.lock(client, lease);
      const node = (await client.query('SELECT data FROM runtime_steps WHERE tenant_id=$1 AND run_id=$2 AND step_id=$3', [lease.tenantId, lease.runId, stepId])).rows[0]?.data;
      if (!node || node.agent !== agentId) throw new Error('Agent capacity does not match the step identity');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`agent-capacity:${lease.tenantId}`]);
      const existing = (await client.query('SELECT fencing_token,released_at FROM runtime_agent_leases WHERE tenant_id=$1 AND run_id=$2 AND step_id=$3', [lease.tenantId, lease.runId, stepId])).rows[0];
      if (existing?.fencing_token === lease.fencingToken && !existing.released_at) return true;
      const counts = (await client.query("SELECT count(*) AS tenant_count,count(*) FILTER (WHERE a.agent_id=$2) AS agent_count FROM runtime_agent_leases a JOIN runtime_jobs j ON j.tenant_id=a.tenant_id AND j.run_id=a.run_id WHERE a.tenant_id=$1 AND a.released_at IS NULL AND a.fencing_token=j.fencing_token AND j.status='running' AND j.lease_until>NOW() AND (j.deadline_at IS NULL OR j.deadline_at>NOW())", [lease.tenantId, agentId])).rows[0]!;
      if (Number(counts.tenant_count) >= perTenant || Number(counts.agent_count) >= perAgent) return false;
      await client.query('INSERT INTO runtime_agent_leases (tenant_id,run_id,step_id,agent_id,fencing_token) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id,run_id,step_id) DO UPDATE SET agent_id=EXCLUDED.agent_id,fencing_token=EXCLUDED.fencing_token,released_at=NULL,acquired_at=NOW()', [lease.tenantId, lease.runId, stepId, agentId, lease.fencingToken]);
      return true;
    });
  }

  async releaseAgent(lease: RuntimeLease, stepId: string): Promise<void> {
    await this.transaction(lease.tenantId, async client => { await client.query('UPDATE runtime_agent_leases SET released_at=NOW() WHERE tenant_id=$1 AND run_id=$2 AND step_id=$3 AND fencing_token=$4 AND released_at IS NULL', [lease.tenantId, lease.runId, stepId, lease.fencingToken]); });
  }

  async defer(lease: RuntimeLease, snapshot: RuntimeSnapshot, until: string): Promise<void> {
    const available = new Date(until);
    if (!Number.isFinite(available.getTime()) || available.getTime() > Date.now() + 604_800_000) throw new Error('Invalid durable wait');
    await this.transaction(lease.tenantId, async client => {
      await this.save(client, lease, snapshot);
      await client.query("UPDATE runtime_jobs SET status='queued',available_at=$3,retry_count=0,lease_owner=NULL,lease_until=NULL,deadline_at=NULL WHERE tenant_id=$1 AND run_id=$2", [lease.tenantId, lease.runId, available]);
      await client.query("UPDATE runtime_attempts SET status='waiting',finished_at=NOW() WHERE tenant_id=$1 AND run_id=$2 AND attempt=$3", [lease.tenantId, lease.runId, lease.attempt]);
      await client.query("UPDATE runtime_step_attempts SET status='waiting',finished_at=NOW() WHERE tenant_id=$1 AND run_id=$2 AND fencing_token=$3 AND finished_at IS NULL", [lease.tenantId, lease.runId, lease.fencingToken]);
    });
  }

  async pause(lease: RuntimeLease, snapshot: RuntimeSnapshot, stepId: string): Promise<void> {
    const step = snapshot.steps.find(value => value.stepId === stepId);
    if (snapshot.status !== 'paused' || step?.status !== 'approval_required') throw new Error('Invalid approval checkpoint');
    await this.transaction(lease.tenantId, async client => {
      await this.save(client, lease, snapshot);
      await client.query("INSERT INTO runtime_approvals (tenant_id,run_id,step_id,attempt,status,artifact_digest) VALUES ($1,$2,$3,$4,'pending',$5)", [lease.tenantId, lease.runId, stepId, lease.attempt, digest(step)]);
      await client.query("UPDATE runtime_jobs SET status='waiting',lease_owner=NULL,lease_until=NULL WHERE tenant_id=$1 AND run_id=$2", [lease.tenantId, lease.runId]);
      await client.query("UPDATE runtime_attempts SET status='waiting',finished_at=NOW() WHERE tenant_id=$1 AND run_id=$2 AND attempt=$3", [lease.tenantId, lease.runId, lease.attempt]);
    });
  }

  async decide(tenantId: string, runId: string, stepId: string, approverId: string, approved: boolean, reason?: string, confirmations: Record<string, boolean> = {}): Promise<void> {
    if (!approverId) throw new Error('Verified approver is required');
    await this.transaction(tenantId, async client => {
      const job = (await client.query('SELECT status FROM runtime_jobs WHERE tenant_id=$1 AND run_id=$2 FOR UPDATE', [tenantId, runId])).rows[0];
      const approval = (await client.query('SELECT * FROM runtime_approvals WHERE tenant_id=$1 AND run_id=$2 AND step_id=$3 ORDER BY attempt DESC LIMIT 1 FOR UPDATE', [tenantId, runId, stepId])).rows[0];
      if (!approval) throw new RuntimeConflictError('No approval request exists');
      const authority = (await client.query('SELECT data FROM runtime_steps WHERE tenant_id=$1 AND run_id=$2 AND step_id=$3', [tenantId, runId, stepId])).rows[0]?.data;
      if (Array.isArray(authority?.approvalApprovers) && authority.approvalApprovers.length && !authority.approvalApprovers.includes(approverId)) throw Object.assign(new Error('Actor is not a designated approver'), { statusCode: 403 });
      const decision = approved ? 'approved' : 'rejected';
      if (approval.status !== 'pending') {
        if (approval.status === decision) return;
        throw new RuntimeConflictError('Approval already has a different decision');
      }
      if (new Date(approval.expires_at).getTime() <= Date.now()) throw new RuntimeConflictError('Approval has expired');
      const snapshot = (await client.query('SELECT snapshot FROM runtime_runs WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenantId, runId])).rows[0]?.snapshot as RuntimeSnapshot | undefined;
      const step = snapshot?.steps.find(value => value.stepId === stepId);
      if (!snapshot || !['paused','queued','running'].includes(snapshot.status) || !job || !['waiting','queued','running'].includes(job.status) || !step || digest(step) !== approval.artifact_digest) throw new RuntimeConflictError('Approval no longer matches the paused work');
      const required = Array.isArray(step.approvalFields) ? step.approvalFields as string[] : [];
      if (approved && required.some(field => confirmations[field] !== true)) throw new RuntimeConflictError('Approval requires all declared confirmations');
      await client.query('UPDATE runtime_approvals SET status=$5,decided_by=$6,reason=$7,confirmations=$8,decided_at=NOW() WHERE tenant_id=$1 AND run_id=$2 AND step_id=$3 AND attempt=$4', [tenantId, runId, stepId, approval.attempt, decision, approverId, reason ?? null, JSON.stringify(Object.fromEntries(required.map(field => [field, confirmations[field] === true])))]);
      if (approved && job.status === 'running') { await this.event(client, snapshot, 'approval.approved'); return; }
      step.approvalDecision = { approved, approverId };
      step.status = approved ? 'pending' : 'rejected';
      snapshot.status = approved ? 'queued' : 'rejected';
      await client.query('UPDATE runtime_runs SET status=$3,snapshot=$4,updated_at=NOW() WHERE tenant_id=$1 AND id=$2', [tenantId, runId, snapshot.status, JSON.stringify(snapshot)]);
      await client.query('UPDATE runtime_jobs SET status=$3,available_at=NOW(),retry_count=0,fencing_token=fencing_token+1 WHERE tenant_id=$1 AND run_id=$2', [tenantId, runId, approved ? 'queued' : 'failed']);
      await this.writeSteps(client, snapshot);
      await this.event(client, snapshot, `approval.${decision}`);
    });
    if (!approved) await this.cancelTree(tenantId, runId, undefined, true);
  }

  async retryFailed(tenantId: string, runId: string, userId?: string): Promise<boolean> {
    return this.transaction(tenantId, async client => {
      await client.query('SELECT run_id FROM runtime_jobs WHERE tenant_id=$1 AND run_id=$2 FOR UPDATE', [tenantId, runId]);
      const row = (await client.query('SELECT snapshot FROM runtime_runs WHERE tenant_id=$1 AND id=$2 AND ($3::text IS NULL OR user_id=$3) FOR UPDATE', [tenantId, runId, userId ?? null])).rows[0];
      if (!row || row.snapshot.status !== 'failed') return false;
      const snapshot = row.snapshot as RuntimeSnapshot;
      if (snapshot.steps.some(step => step.status === 'inconclusive' || step.status === 'rejected')) throw new RuntimeConflictError('Uncertain effects and rejected approvals cannot be replayed');
      snapshot.status = 'queued'; delete snapshot.completedAt;
      for (const step of snapshot.steps) if (step.status === 'failed' || step.status === 'skipped' && step.skipReason !== 'condition') { step.status = 'pending'; delete step.error; delete step.completedAt; }
      await client.query("UPDATE runtime_jobs SET status='queued',available_at=NOW(),retry_count=0,fencing_token=fencing_token+1,lease_owner=NULL,lease_until=NULL,deadline_at=NULL WHERE tenant_id=$1 AND run_id=$2", [tenantId, runId]);
      await client.query("UPDATE runtime_runs SET status='queued',snapshot=$3,updated_at=NOW() WHERE tenant_id=$1 AND id=$2", [tenantId, runId, JSON.stringify(snapshot)]);
      await this.writeSteps(client, snapshot);
      await this.event(client, snapshot, 'execution.retry.requested');
      return true;
    });
  }

  async cancel(tenantId: string, runId: string, userId?: string): Promise<boolean> {
    return this.cancelTree(tenantId, runId, userId, false);
  }

  private async cancelTree(tenantId: string, runId: string, userId: string | undefined, descendantsOnly: boolean, rootFailure?: string): Promise<boolean> {
    return this.transaction(tenantId, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`run-tree:${tenantId}`]);
      const root = (await client.query('SELECT user_id,status FROM runtime_runs WHERE tenant_id=$1 AND id=$2 AND ($3::text IS NULL OR user_id=$3)', [tenantId, runId, userId ?? null])).rows[0];
      if (!root || !descendantsOnly && isTerminalExecutionStatus(root.status)) return false;
      const tree = (await client.query('WITH RECURSIVE tree AS (SELECT id,0 AS level FROM runtime_runs WHERE tenant_id=$1 AND id=$2 UNION ALL SELECT r.id,t.level+1 FROM runtime_runs r JOIN tree t ON r.parent_run_id=t.id WHERE r.tenant_id=$1 AND r.user_id=$3 AND t.level<5) SELECT DISTINCT id FROM tree', [tenantId, runId, root.user_id])).rows.map(row => row.id as string).filter(id => !descendantsOnly || id !== runId);
      if (!tree.length) return false;
      await client.query('SELECT run_id FROM runtime_jobs WHERE tenant_id=$1 AND run_id=ANY($2::text[]) ORDER BY run_id FOR UPDATE', [tenantId, tree]);
      const rows = (await client.query('SELECT snapshot FROM runtime_runs WHERE tenant_id=$1 AND id=ANY($2::text[]) ORDER BY id FOR UPDATE', [tenantId, tree])).rows;
      let changed = false;
      const uncertain = rows.some(row => (row.snapshot as RuntimeSnapshot).steps.some(step => step.kind === 'tool_effect' && step.status === 'running'));
      for (const row of rows) {
        const snapshot = row.snapshot as RuntimeSnapshot;
        if (isTerminalExecutionStatus(snapshot.status)) continue;
        snapshot.status = rootFailure && snapshot.id === runId ? uncertain ? 'inconclusive' : 'failed' : 'cancelled'; snapshot.completedAt = new Date().toISOString();
        for (const step of snapshot.steps) if (['pending','running','approval_required'].includes(step.status)) { step.status = snapshot.status; step.error = rootFailure ?? 'Execution tree cancelled'; }
        await client.query('UPDATE runtime_runs SET status=$4,snapshot=$3,updated_at=NOW() WHERE tenant_id=$1 AND id=$2', [tenantId, snapshot.id, JSON.stringify(snapshot), snapshot.status]);
        await client.query("UPDATE runtime_jobs SET status='cancelled',fencing_token=fencing_token+1,lease_owner=NULL,lease_until=NULL,wake_at=NULL WHERE tenant_id=$1 AND run_id=$2", [tenantId, snapshot.id]);
        await client.query("UPDATE runtime_attempts SET status='cancelled',finished_at=NOW() WHERE tenant_id=$1 AND run_id=$2 AND status='running'", [tenantId, snapshot.id]);
        await client.query("UPDATE runtime_approvals SET status='expired',reason='Execution cancelled',decided_at=NOW() WHERE tenant_id=$1 AND run_id=$2 AND status='pending'", [tenantId, snapshot.id]);
        await client.query("UPDATE runtime_step_attempts SET status='cancelled',finished_at=NOW() WHERE tenant_id=$1 AND run_id=$2 AND finished_at IS NULL", [tenantId, snapshot.id]);
        await this.writeSteps(client, snapshot);
        await this.event(client, snapshot, `execution.${snapshot.status}`);
        changed = true;
      }
      return changed;
    });
  }

  async claimEvents(tenantId: string, workerId: string, limit = 100): Promise<RuntimeEvent[]> {
    if (!workerId || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid event claim');
    return this.transaction(tenantId, async client => {
      const rows = await client.query("WITH selected AS (SELECT id FROM runtime_events WHERE tenant_id=$1 AND (status='pending' OR (status='delivering' AND lease_until<NOW())) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT $3) UPDATE runtime_events e SET status='delivering',lease_owner=$2,lease_until=NOW()+INTERVAL '30 seconds',fencing_token=e.fencing_token+1 FROM selected WHERE e.tenant_id=$1 AND e.id=selected.id RETURNING e.*", [tenantId, workerId, limit]);
      const unsequenced = rows.rows.filter(row => row.stream_sequence === null);
      if (unsequenced.length) {
        const end = BigInt((await client.query('INSERT INTO platform_event_offsets (tenant_id,next_sequence) VALUES ($1,$2) ON CONFLICT (tenant_id) DO UPDATE SET next_sequence=platform_event_offsets.next_sequence+$2 RETURNING next_sequence', [tenantId, unsequenced.length])).rows[0]!.next_sequence);
        for (let index = 0; index < unsequenced.length; index++) {
          const row = unsequenced[index]!;
          const sequence = String(end - BigInt(unsequenced.length - index - 1));
          row.data = { ...row.data, sequence };
          await client.query('UPDATE runtime_events SET stream_sequence=$3,data=$4 WHERE tenant_id=$1 AND id=$2', [tenantId, row.id, sequence, JSON.stringify(row.data)]);
        }
      }
      return rows.rows.map(row => ({ id: row.id, tenantId: row.tenant_id, runId: row.run_id, type: row.type, data: row.data, fencingToken: row.fencing_token }));
    });
  }

  async ackEvent(event: RuntimeEvent, workerId: string): Promise<boolean> {
    return this.transaction(event.tenantId, async client => (await client.query("UPDATE runtime_events SET status='delivered',delivered_at=NOW(),lease_owner=NULL,lease_until=NULL WHERE tenant_id=$1 AND id=$2 AND lease_owner=$3 AND fencing_token=$4 AND status='delivering' AND lease_until>NOW() RETURNING id", [event.tenantId, event.id, workerId, event.fencingToken])).rows.length === 1);
  }
}
