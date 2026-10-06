import { randomUUID } from 'node:crypto';
import { tenantTransaction } from './tenant-transaction.js';
import { RuntimeConflictError, type RuntimeClient, type RuntimePool, type RuntimeSnapshot, type PostgresRunRepository } from './run-repository.js';
import { integrationDigest, type ConnectorManifest } from './integration-repository.js';
import type { WorkspaceOwner } from './workspace-repository.js';

export interface PlatformPrincipal extends WorkspaceOwner { role: 'user' | 'operator' | 'admin'; personaScopes: string[] }
export interface DatasetInput { name: string; cases: Array<{ id: string; inputs: Record<string, unknown>; expected: string }> }
export interface Dataset extends WorkspaceOwner { id: string; version: number; data: DatasetInput; readers: string[] }
export class PlatformAccessError extends Error { readonly statusCode = 403; }
export class PlatformRepository {
  constructor(private readonly pool: RuntimePool, private readonly compileConnector?: (input: unknown) => ConnectorManifest) {}
  private async guard(client: RuntimeClient, principal: PlatformPrincipal): Promise<void> {
    if (!principal.userId || !principal.tenantId) throw new PlatformAccessError('Verified principal required');
    const member = (await client.query('SELECT role,state,persona_scopes FROM platform_memberships WHERE tenant_id=$1 AND user_id=$2 FOR SHARE', [principal.tenantId, principal.userId])).rows[0];
    const rank: Record<string, number> = { user: 0, operator: 1, admin: 2 };
    if (member && (member.state !== 'active' || rank[principal.role]! > rank[member.role]! || !member.persona_scopes.includes('*') && principal.personaScopes.some(scope => !member.persona_scopes.includes(scope)))) throw new PlatformAccessError('Membership changed; refresh authorization');
  }
  private transaction<T>(principal: PlatformPrincipal, operation: (client: RuntimeClient) => Promise<T>): Promise<T> {
    return tenantTransaction(this.pool, principal.tenantId, async client => { await this.guard(client, principal); return operation(client); });
  }
  private require(principal: PlatformPrincipal, role: 'operator' | 'admin' = 'operator'): void {
    if (!principal.tenantId || !principal.userId || role === 'admin' && principal.role !== 'admin' || role === 'operator' && !['admin','operator'].includes(principal.role)) throw new PlatformAccessError('Platform permission denied');
  }
  private audit(client: RuntimeClient, principal: PlatformPrincipal, action: string, resource: string, data: Record<string, unknown> = {}) {
    return client.query('INSERT INTO platform_audit (tenant_id,id,actor_id,action,resource,data) VALUES ($1,$2,$3,$4,$5,$6)', [principal.tenantId, randomUUID(), principal.userId, action, resource, JSON.stringify(data)]);
  }
  async membership(owner: WorkspaceOwner): Promise<{ role: PlatformPrincipal['role']; personaScopes: string[]; state: string; version: number } | undefined> {
    return tenantTransaction(this.pool, owner.tenantId, async client => (await client.query('SELECT role,persona_scopes AS "personaScopes",state,version FROM platform_memberships WHERE tenant_id=$1 AND user_id=$2', [owner.tenantId, owner.userId])).rows[0] as { role: PlatformPrincipal['role']; personaScopes: string[]; state: string; version: number } | undefined);
  }
  async recordRequest(tenantId: string, method: string, route: string, status: number, latencyMs: number): Promise<void> {
    if (!['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(method) || route.length > 120 || !Number.isInteger(status) || status < 100 || status > 599 || !Number.isFinite(latencyMs) || latencyMs < 0) throw new Error('Invalid request measurement');
    await tenantTransaction(this.pool, tenantId, async client => { await client.query("INSERT INTO platform_http_metrics (tenant_id,bucket,method,route,status,requests,latency_ms) VALUES ($1,date_trunc('minute',NOW()),$2,$3,$4,1,$5) ON CONFLICT (tenant_id,bucket,method,route,status) DO UPDATE SET requests=platform_http_metrics.requests+1,latency_ms=platform_http_metrics.latency_ms+EXCLUDED.latency_ms", [tenantId, method, route, status, latencyMs]); });
  }
  async summary(principal: PlatformPrincipal) {
    this.require(principal);
    return this.transaction(principal, async client => {
      const scopes = principal.personaScopes.includes('*') ? null : principal.personaScopes;
      const http = (await client.query("SELECT COALESCE(sum(requests),0) AS requests,COALESCE(sum(requests) FILTER (WHERE status>=400),0) AS errors,sum(latency_ms)/NULLIF(sum(requests),0) AS latency FROM platform_http_metrics WHERE tenant_id=$1 AND bucket>NOW()-INTERVAL '24 hours'", [principal.tenantId])).rows[0]!;
      const runs = (await client.query("SELECT mode,status,count(*) AS count FROM runtime_runs WHERE tenant_id=$1 AND created_at>NOW()-INTERVAL '24 hours' AND ($2::text[] IS NULL OR persona=ANY($2) AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(snapshot->'requiredPersonas','[]'::jsonb)) p WHERE NOT p=ANY($2))) GROUP BY mode,status ORDER BY mode,status", [principal.tenantId, scopes])).rows;
      const usage = (await client.query("SELECT COALESCE(sum(estimate_micros) FILTER (WHERE status='reserved'),0) AS reserved,COALESCE(sum(actual_micros) FILTER (WHERE status='settled'),0) AS spent FROM runtime_usage_reservations WHERE tenant_id=$1", [principal.tenantId])).rows[0]!;
      const evals = (await client.query("SELECT COALESCE(sum(e.sample_count),0) AS samples,sum(e.pass_rate*e.sample_count)/NULLIF(sum(e.sample_count),0) AS rate FROM platform_evaluations e JOIN platform_datasets d ON d.tenant_id=e.tenant_id AND d.id=e.dataset_id WHERE e.tenant_id=$1 AND e.stage='live' AND d.archived_at IS NULL AND d.version=e.dataset_version AND (d.user_id=$2 OR $2=ANY(d.readers))", [principal.tenantId, principal.userId])).rows[0]!;
      const jobs = (await client.query("SELECT j.status,count(*) AS count,count(*) FILTER (WHERE j.status='running' AND j.lease_until<NOW()) AS expired FROM runtime_jobs j JOIN runtime_runs r ON r.tenant_id=j.tenant_id AND r.id=j.run_id WHERE j.tenant_id=$1 AND ($2::text[] IS NULL OR r.persona=ANY($2)) GROUP BY j.status", [principal.tenantId, scopes])).rows;
      return { windowHours: 24, measuredAt: new Date().toISOString(), http: { requests: Number(http.requests), errors: Number(http.errors), meanLatencyMs: http.latency === null ? null : Number(http.latency) }, runs: runs.map(row => ({ mode: row.mode, status: row.status, count: Number(row.count) })), jobs: jobs.map(row => ({ status: row.status, count: Number(row.count), expired: Number(row.expired) })), usage: { spentMicros: Number(usage.spent), reservedMicros: Number(usage.reserved) }, evaluations: { sampleCount: Number(evals.samples), passRate: evals.rate === null ? null : Number(evals.rate), basis: 'reviewed labeled live runs' } };
    });
  }
  async agentMetrics(principal: PlatformPrincipal) {
    this.require(principal);
    return this.transaction(principal, async client => (await client.query("SELECT s.data->>'agent' AS \"agentId\",count(DISTINCT s.run_id)::integer AS \"observedRuns\",count(*) FILTER (WHERE s.status='completed')::integer AS \"completedSteps\",count(*) FILTER (WHERE s.status IN ('failed','rejected','inconclusive','unsupported'))::integer AS \"failedSteps\",avg((s.data->>'latencyMs')::double precision) AS \"meanLatencyMs\" FROM runtime_steps s JOIN runtime_runs r ON r.tenant_id=s.tenant_id AND r.id=s.run_id WHERE s.tenant_id=$1 AND r.mode='live' AND s.data->>'startedAt' IS NOT NULL AND ($2::text[] IS NULL OR r.persona=ANY($2)) GROUP BY s.data->>'agent' ORDER BY s.data->>'agent' LIMIT 100", [principal.tenantId, principal.personaScopes.includes('*') ? null : principal.personaScopes])).rows.map(row => ({ ...row, accuracy: null, satisfaction: null, basis: 'observed live step records' })));
  }
  async replayEvents(principal: PlatformPrincipal, cursor?: string, limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || cursor && !/^[0-9]{1,18}$/.test(cursor)) throw new Error('Invalid replay cursor or limit');
    return this.transaction(principal, async client => {
      const rows = (await client.query("SELECT e.id,e.type,e.data,e.created_at,e.stream_sequence FROM runtime_events e JOIN runtime_runs r ON r.tenant_id=e.tenant_id AND r.id=e.run_id WHERE e.tenant_id=$1 AND e.stream_sequence>$2::bigint AND ($3::text IS NULL OR r.user_id=$3) AND ($4::text[] IS NULL OR r.persona=ANY($4) AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(r.snapshot->'requiredPersonas','[]'::jsonb)) p WHERE NOT p=ANY($4))) ORDER BY e.stream_sequence LIMIT $5", [principal.tenantId, cursor ?? '0', principal.role === 'user' ? principal.userId : null, principal.personaScopes.includes('*') ? null : principal.personaScopes, limit])).rows;
      const last = rows.at(-1);
      return { events: rows.map(row => ({ id: row.id, type: row.type, data: row.data, createdAt: row.created_at })), cursor: last ? String(last.stream_sequence) : cursor ?? '0' };
    });
  }
  async recovery(principal: PlatformPrincipal, limit = 50) {
    this.require(principal);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid recovery limit');
    return this.transaction(principal, async client => (await client.query("SELECT r.id,r.status,r.mode,r.persona,r.user_id AS \"userId\",r.updated_at AS \"updatedAt\",j.attempts,j.lease_owner AS \"workerId\",j.lease_until AS \"leaseUntil\",j.last_error AS error,r.snapshot->'steps' AS steps FROM runtime_runs r JOIN runtime_jobs j ON j.tenant_id=r.tenant_id AND j.run_id=r.id WHERE r.tenant_id=$1 AND r.status NOT IN ('completed','simulated','cancelled') AND ($3::text[] IS NULL OR r.persona=ANY($3) AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(r.snapshot->'requiredPersonas','[]'::jsonb)) p WHERE NOT p=ANY($3))) ORDER BY r.updated_at DESC,r.id LIMIT $2", [principal.tenantId, limit, principal.personaScopes.includes('*') ? null : principal.personaScopes])).rows);
  }
  async createDataset(principal: PlatformPrincipal, data: DatasetInput): Promise<Dataset> {
    this.require(principal);
    if (!data.name || data.name.length > 200 || !data.cases.length || data.cases.length > 100 || new Set(data.cases.map(item => item.id)).size !== data.cases.length || JSON.stringify(data).length > 256_000 || data.cases.some(item => !item.id || !item.expected)) throw new Error('Invalid labeled dataset');
    const id = randomUUID();
    return this.transaction(principal, async client => {
      await client.query('INSERT INTO platform_datasets (tenant_id,id,user_id,data) VALUES ($1,$2,$3,$4)', [principal.tenantId, id, principal.userId, JSON.stringify(data)]);
      await this.audit(client, principal, 'dataset.created', id, { cases: data.cases.length });
      return { tenantId: principal.tenantId, userId: principal.userId, id, version: 1, data, readers: [] };
    });
  }
  async getDataset(principal: PlatformPrincipal, id: string): Promise<Dataset> {
    return this.transaction(principal, async client => {
      const row = (await client.query('SELECT tenant_id AS "tenantId",user_id AS "userId",id,version,data,readers FROM platform_datasets WHERE tenant_id=$1 AND id=$2 AND archived_at IS NULL AND (user_id=$3 OR $3=ANY(readers))', [principal.tenantId, id, principal.userId])).rows[0];
      if (!row) throw new PlatformAccessError('Dataset is unavailable');
      return row as Dataset;
    });
  }
  async shareDataset(principal: PlatformPrincipal, id: string, version: number, readers: string[]): Promise<void> {
    if (readers.length > 100 || new Set(readers).size !== readers.length) throw new Error('Invalid dataset readers');
    await this.transaction(principal, async client => {
      const known = (await client.query('SELECT id FROM users WHERE tenant_id=$1 AND id=ANY($2::text[])', [principal.tenantId, readers])).rows;
      if (known.length !== readers.length) throw new PlatformAccessError('Reader is outside the tenant');
      const changed = await client.query('UPDATE platform_datasets SET readers=$5,version=version+1 WHERE tenant_id=$1 AND id=$2 AND user_id=$3 AND version=$4 AND archived_at IS NULL RETURNING id', [principal.tenantId, id, principal.userId, version, readers]);
      if (!changed.rows.length) throw new RuntimeConflictError('Dataset changed or is not owned by this principal');
      await this.audit(client, principal, 'dataset.shared', id, { readers });
    });
  }
  async notificationSource(principal: PlatformPrincipal, channelId: string, runId: string) {
    this.require(principal);
    return this.transaction(principal, async client => {
      const channel = (await client.query("SELECT data FROM workspace_records WHERE tenant_id=$1 AND family='notification_channel' AND id=$2 AND user_id=$3 AND archived_at IS NULL", [principal.tenantId, channelId, principal.userId])).rows[0]?.data;
      const source = (await client.query("SELECT snapshot FROM runtime_runs WHERE tenant_id=$1 AND id=$2 AND user_id=$3 AND status IN ('completed','simulated','failed','rejected','cancelled','inconclusive','unsupported')", [principal.tenantId, runId, principal.userId])).rows[0]?.snapshot;
      if (!channel || !source || channel.channel !== 'slack' || !channel.enabled || !principal.personaScopes.includes('*') && (source.requiredPersonas ?? [source.persona]).some((persona: string) => !principal.personaScopes.includes(persona))) throw new PlatformAccessError('Owned source run and enabled Slack channel required');
      return { channel, source: source as RuntimeSnapshot };
    });
  }
  async notification(principal: PlatformPrincipal, runs: PostgresRunRepository, channelId: string, sourceRunId: string, key: string, snapshot: RuntimeSnapshot, definition: Record<string, unknown>, payload: unknown): Promise<RuntimeSnapshot> {
    this.require(principal);
    if (snapshot.tenantId !== principal.tenantId || snapshot.userId !== principal.userId || !key || key.length > 200) throw new Error('Invalid notification owner/key');
    return this.transaction(principal, async client => {
      const channel = (await client.query("SELECT data FROM workspace_records WHERE tenant_id=$1 AND family='notification_channel' AND id=$2 AND user_id=$3 AND archived_at IS NULL FOR SHARE", [principal.tenantId, channelId, principal.userId])).rows[0]?.data;
      const source = (await client.query('SELECT mode,status FROM runtime_runs WHERE tenant_id=$1 AND id=$2 AND user_id=$3', [principal.tenantId, sourceRunId, principal.userId])).rows[0];
      if (!channel || !source || channel.channel !== 'slack' || !channel.enabled || channel.config?.connectionId !== 'slack' || snapshot.inputs.channel !== channel.config.destination) throw new PlatformAccessError('Authorized Slack channel and source run required');
      if (source.mode === 'simulation' && snapshot.mode !== 'simulation') throw new RuntimeConflictError('Simulation cannot produce a live notification');
      const deliveryKey = integrationDigest([principal.userId, channelId, sourceRunId, key]);
      const run = await runs.submit(snapshot, definition, payload, `notification:${deliveryKey}`, { tenantId: principal.tenantId, client });
      await client.query("INSERT INTO runtime_deliveries (tenant_id,id,run_id,user_id,connector_id,delivery_key,payload,status,execution_run_id) VALUES ($1,$2,$3,$4,'slack',$5,$6,'queued',$7) ON CONFLICT (tenant_id,connector_id,delivery_key) DO NOTHING", [principal.tenantId, randomUUID(), sourceRunId, principal.userId, deliveryKey, JSON.stringify({ channelId }), run.id]);
      await this.audit(client, principal, 'notification.queued', run.id, { sourceRunId, channelId });
      return run;
    });
  }
  async notifications(principal: PlatformPrincipal) {
    this.require(principal);
    return this.transaction(principal, async client => (await client.query("SELECT d.id,d.run_id AS \"sourceRunId\",d.execution_run_id AS \"executionId\",CASE WHEN r.mode='simulation' THEN 'simulated' WHEN r.status='completed' AND t.status='completed' THEN 'delivered' ELSE COALESCE(r.status,d.status) END AS status,d.created_at AS \"createdAt\",t.result AS receipt FROM runtime_deliveries d LEFT JOIN runtime_runs r ON r.tenant_id=d.tenant_id AND r.id=d.execution_run_id LEFT JOIN runtime_tool_receipts t ON t.tenant_id=r.tenant_id AND t.run_id=r.id AND t.step_id='deliver' WHERE d.tenant_id=$1 AND d.user_id=$2 ORDER BY d.created_at DESC LIMIT 100", [principal.tenantId, principal.userId])).rows);
  }
  async listDatasets(principal: PlatformPrincipal) {
    return this.transaction(principal, async client => (await client.query('SELECT id,user_id AS "userId",version,data->>\'name\' AS name,readers FROM platform_datasets WHERE tenant_id=$1 AND (user_id=$2 OR $2=ANY(readers)) AND archived_at IS NULL ORDER BY created_at DESC LIMIT 100', [principal.tenantId, principal.userId])).rows);
  }
  async recordEvaluation(principal: PlatformPrincipal, input: { datasetId: string; datasetVersion: number; definitionHash: string; observations: Array<{ caseId: string; runId: string; passed: boolean; reason: string }> }) {
    this.require(principal);
    return this.transaction(principal, async client => {
      const dataset = (await client.query('SELECT * FROM platform_datasets WHERE tenant_id=$1 AND id=$2 AND version=$3 AND archived_at IS NULL AND (user_id=$4 OR $4=ANY(readers)) FOR SHARE', [principal.tenantId, input.datasetId, input.datasetVersion, principal.userId])).rows[0];
      if (!dataset) throw new PlatformAccessError('Dataset version is unavailable');
      const cases = (dataset.data as DatasetInput).cases;
      if (input.observations.length !== cases.length || new Set(input.observations.map(item => item.caseId)).size !== cases.length || new Set(input.observations.map(item => item.runId)).size !== cases.length) throw new Error('Every labeled case requires a distinct observed run');
      const stages = new Set<string>();
      for (const observation of input.observations) {
        const expected = cases.find(item => item.id === observation.caseId);
        const run = (await client.query('SELECT snapshot FROM runtime_runs WHERE tenant_id=$1 AND id=$2 AND user_id=$3 AND definition_hash=$4', [principal.tenantId, observation.runId, dataset.user_id, input.definitionHash])).rows[0]?.snapshot;
        if (!expected || !run || integrationDigest(expected.inputs) !== integrationDigest(run.inputs) || !['completed','simulated','failed','rejected','inconclusive','unsupported','cancelled'].includes(run.status) || typeof observation.passed !== 'boolean' || observation.reason.length < 10 || observation.reason.length > 4000 || observation.passed && !['completed','simulated'].includes(run.status)) throw new Error('Observation does not match the frozen labeled case');
        if (!principal.personaScopes.includes('*') && (run.requiredPersonas ?? [run.persona]).some((persona: string) => !principal.personaScopes.includes(persona))) throw new PlatformAccessError('Evaluation persona scope denied');
        stages.add(run.mode);
      }
      if (stages.size !== 1) throw new Error('Simulation and live evaluation evidence cannot be mixed');
      const stage = stages.has('simulation') ? 'simulation' : 'live', id = randomUUID();
      const sampleCount = cases.length, passRate = input.observations.filter(item => item.passed).length / sampleCount;
      await client.query('INSERT INTO platform_evaluations (tenant_id,id,dataset_id,dataset_version,definition_hash,reviewer_id,stage,sample_count,pass_rate,data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [principal.tenantId, id, input.datasetId, input.datasetVersion, input.definitionHash, principal.userId, stage, sampleCount, passRate, JSON.stringify(input.observations)]);
      await this.audit(client, principal, 'evaluation.recorded', id, { stage, sampleCount, passRate });
      return { id, stage, sampleCount, passRate };
    });
  }
  async stageVersion(principal: PlatformPrincipal, input: { name: string; kind: 'workflow' | 'connector'; definition: Record<string, any>; origin: string; license: string; visibility: 'private' | 'tenant'; reviewers?: string[] }) {
    this.require(principal);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(input.name) || !input.origin || input.origin.length > 1000 || !input.license || input.license.length > 100 || JSON.stringify(input.definition).length > 1_048_576) throw new Error('Invalid package metadata');
    if (input.kind === 'connector') {
      if (!this.compileConnector) throw new RuntimeConflictError('Connector staging requires a trusted native contract registry');
      input = { ...input, definition: this.compileConnector(input.definition) };
    }
    const hash = input.kind === 'workflow' ? input.definition.definitionHash as string : integrationDigest(input.definition);
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Compiled immutable definition required');
    return this.transaction(principal, async client => {
      const reviewers = input.reviewers ?? [];
      if (reviewers.length > 30 || new Set(reviewers).size !== reviewers.length || (await client.query('SELECT id FROM users WHERE tenant_id=$1 AND id=ANY($2::text[])', [principal.tenantId, reviewers])).rows.length !== reviewers.length) throw new PlatformAccessError('Invalid reviewer scope');
      const inserted = (await client.query('INSERT INTO platform_registry_packages (tenant_id,id,user_id,kind,name,visibility,reviewers) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id,kind,name) DO NOTHING RETURNING id', [principal.tenantId, randomUUID(), principal.userId, input.kind, input.name, input.visibility, reviewers])).rows[0];
      const pkg = (await client.query('SELECT * FROM platform_registry_packages WHERE tenant_id=$1 AND kind=$2 AND name=$3 FOR UPDATE', [principal.tenantId, input.kind, input.name])).rows[0]!;
      if (pkg.user_id !== principal.userId) throw new PlatformAccessError('Package namespace belongs to another publisher');
      if (pkg.visibility !== input.visibility || integrationDigest(pkg.reviewers) !== integrationDigest(reviewers)) throw new RuntimeConflictError('Package sharing cannot change through version staging');
      const previous = (await client.query('SELECT data,origin,license FROM platform_registry_versions WHERE tenant_id=$1 AND package_id=$2 AND hash=$3', [principal.tenantId, pkg.id, hash])).rows[0];
      if (previous && (integrationDigest(previous.data) !== integrationDigest(input.definition) || previous.origin !== input.origin || previous.license !== input.license)) throw new RuntimeConflictError('Immutable version cannot change');
      if (!previous) {
        await client.query('INSERT INTO platform_registry_versions (tenant_id,package_id,hash,publisher_id,data,origin,license) VALUES ($1,$2,$3,$4,$5,$6,$7)', [principal.tenantId, pkg.id, hash, principal.userId, JSON.stringify(input.definition), input.origin, input.license]);
        if (!inserted) await client.query('UPDATE platform_registry_packages SET revision=revision+1 WHERE tenant_id=$1 AND id=$2', [principal.tenantId, pkg.id]);
        await this.audit(client, principal, 'registry.staged', pkg.id, { hash, kind: input.kind });
      }
      return { packageId: pkg.id as string, hash, revision: Number(pkg.revision) + (!previous && !inserted ? 1 : 0) };
    });
  }
  async connectorConformance(principal: PlatformPrincipal, packageId: string, hash: string) {
    this.require(principal);
    return this.transaction(principal, async client => {
      const row = (await client.query("SELECT v.data,v.publisher_id FROM platform_registry_versions v JOIN platform_registry_packages p ON p.tenant_id=v.tenant_id AND p.id=v.package_id WHERE v.tenant_id=$1 AND v.package_id=$2 AND v.hash=$3 AND p.kind='connector' AND (p.user_id=$4 OR p.visibility='tenant' OR $4=ANY(p.reviewers))", [principal.tenantId, packageId, hash, principal.userId])).rows[0];
      if (!row) throw new PlatformAccessError('Connector version is unavailable');
      let manifest: ConnectorManifest | undefined;
      try { if (row.data.schemaVersion === 2 && integrationDigest(row.data) === hash) manifest = this.compileConnector?.(row.data); } catch {}
      const blockers = ['vendor_sandbox_certification_pending','independent_connector_review_pending','marketplace_connector_activation_disabled'];
      if (!manifest) blockers.unshift('adapter_changed_or_manifest_requires_restage');
      const observations = manifest ? (await client.query("SELECT o.action_id,o.transport,count(DISTINCT (o.run_id,o.step_id))::integer AS count FROM runtime_connector_observations o JOIN runtime_runs r ON r.tenant_id=o.tenant_id AND r.id=o.run_id AND r.user_id=o.user_id JOIN runtime_steps s ON s.tenant_id=o.tenant_id AND s.run_id=o.run_id AND s.step_id=o.step_id JOIN workspace_connections c ON c.tenant_id=o.tenant_id AND c.user_id=o.user_id AND c.connector_id=$4 WHERE o.tenant_id=$1 AND o.user_id=$2 AND o.adapter_hash=$3 AND o.action_id=ANY($5::text[]) AND o.created_at>NOW()-INTERVAL '90 days' AND r.mode='live' AND r.status='completed' AND s.status='completed' AND s.data->>'provenance'='live' AND s.data->'actionProof'->>'requestHash'=o.request_hash AND s.data->'actionProof'->>'adapterHash'=o.adapter_hash AND c.status='verified' AND c.version=o.connection_version AND c.binding_hash=s.data->'actionProof'->>'bindingHash' AND ($6::text[] IS NULL OR r.persona=ANY($6) AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(r.snapshot->'requiredPersonas','[]'::jsonb)) p WHERE NOT p=ANY($6))) GROUP BY o.action_id,o.transport", [principal.tenantId, row.publisher_id, manifest.adapterHash, manifest.id, manifest.actions, principal.personaScopes.includes('*') ? null : principal.personaScopes])).rows : [];
      const actions = (manifest?.actions ?? []).map(actionId => ({ actionId, customTransport: Number(observations.find(row => row.action_id === actionId && row.transport === 'custom_transport')?.count ?? 0), nativeTransport: Number(observations.find(row => row.action_id === actionId && row.transport === 'native_transport')?.count ?? 0) }));
      if (actions.some(action => action.nativeTransport === 0)) blockers.unshift('missing_native_action_observations');
      return { schemaVersion: 1 as const, packageId, manifestHash: hash, adapterHash: manifest?.adapterHash ?? null, adapterCurrent: Boolean(manifest), activationEligible: false as const, evidenceWindowDays: 90, evidenceBasis: 'observed postconditions; not vendor-sandbox certification', actions, blockers };
    });
  }
  private async promotionEvidence(client: RuntimeClient, principal: PlatformPrincipal, hash: string, evaluationId: string, publisherId: string) {
    const evaluation = (await client.query("SELECT e.* FROM platform_evaluations e JOIN platform_datasets d ON d.tenant_id=e.tenant_id AND d.id=e.dataset_id WHERE e.tenant_id=$1 AND e.id=$2 AND e.definition_hash=$3 AND d.user_id=$4 AND e.stage='live' AND d.version=e.dataset_version AND d.archived_at IS NULL AND e.sample_count>=3 AND e.pass_rate=1 AND e.reviewer_id<>$4 FOR SHARE OF e,d", [principal.tenantId, evaluationId, hash, publisherId])).rows[0];
    if (!evaluation) throw new RuntimeConflictError('Promotion requires current independently reviewed live evidence for at least three labeled cases');
    return evaluation;
  }
  async reviewVersion(principal: PlatformPrincipal, packageId: string, hash: string, evaluationId: string, approved: boolean, reason: string): Promise<void> {
    this.require(principal);
    if (reason.length < 10 || reason.length > 4000) throw new Error('Review rationale required');
    await this.transaction(principal, async client => {
      const version = (await client.query("SELECT v.*,p.kind,p.visibility,p.user_id FROM platform_registry_versions v JOIN platform_registry_packages p ON p.tenant_id=v.tenant_id AND p.id=v.package_id WHERE v.tenant_id=$1 AND v.package_id=$2 AND v.hash=$3 AND (p.visibility='tenant' OR p.user_id=$4 OR $4=ANY(p.reviewers)) FOR UPDATE OF v", [principal.tenantId, packageId, hash, principal.userId])).rows[0];
      if (!version || version.publisher_id === principal.userId) throw new PlatformAccessError('Independent authorized reviewer required');
      if (version.status !== 'draft') throw new RuntimeConflictError('Version already reviewed');
      if (approved) {
        if (version.kind !== 'workflow') throw new RuntimeConflictError('Connector execution promotion requires separate transport conformance');
        await this.promotionEvidence(client, principal, hash, evaluationId, version.publisher_id);
      }
      await client.query('UPDATE platform_registry_versions SET status=$4,reviewer_id=$5,evaluation_id=$6,review_reason=$7 WHERE tenant_id=$1 AND package_id=$2 AND hash=$3', [principal.tenantId, packageId, hash, approved ? 'approved' : 'rejected', principal.userId, approved ? evaluationId : null, reason]);
      await this.audit(client, principal, approved ? 'registry.approved' : 'registry.rejected', packageId, { hash });
    });
  }
  async activateVersion(principal: PlatformPrincipal, packageId: string, hash: string, expectedRevision: number) {
    this.require(principal, 'admin');
    return this.transaction(principal, async client => {
      const pkg = (await client.query('SELECT * FROM platform_registry_packages WHERE tenant_id=$1 AND id=$2 AND revision=$3 FOR UPDATE', [principal.tenantId, packageId, expectedRevision])).rows[0];
      const version = (await client.query("SELECT * FROM platform_registry_versions WHERE tenant_id=$1 AND package_id=$2 AND hash=$3 AND status='approved'", [principal.tenantId, packageId, hash])).rows[0];
      if (!pkg || !version || pkg.kind !== 'workflow') throw new RuntimeConflictError('Package revision or reviewed version is unavailable');
      await this.promotionEvidence(client, principal, hash, version.evaluation_id, version.publisher_id);
      await client.query('UPDATE platform_registry_packages SET active_hash=$3,revision=revision+1 WHERE tenant_id=$1 AND id=$2', [principal.tenantId, packageId, hash]);
      await this.audit(client, principal, 'registry.activated', packageId, { previous: pkg.active_hash, hash });
      return { packageId, activeHash: hash, revision: expectedRevision + 1 };
    });
  }
  async getActiveVersion(principal: PlatformPrincipal, packageId: string) {
    return this.transaction(principal, async client => {
      const row = (await client.query("SELECT v.*,p.name,p.revision FROM platform_registry_packages p JOIN platform_registry_versions v ON v.tenant_id=p.tenant_id AND v.package_id=p.id AND v.hash=p.active_hash WHERE p.tenant_id=$1 AND p.id=$2 AND v.status='approved' AND (p.visibility='tenant' OR p.user_id=$3 OR $3=ANY(p.reviewers))", [principal.tenantId, packageId, principal.userId])).rows[0];
      if (!row) throw new PlatformAccessError('Active package is unavailable');
      await this.promotionEvidence(client, principal, row.hash, row.evaluation_id, row.publisher_id);
      return { packageId, hash: row.hash as string, definition: row.data as Record<string, unknown>, revision: Number(row.revision) };
    });
  }
  async candidateVersion(principal: PlatformPrincipal, packageId: string, hash: string) {
    this.require(principal);
    return this.transaction(principal, async client => {
      const row = (await client.query("SELECT v.*,p.revision FROM platform_registry_versions v JOIN platform_registry_packages p ON p.tenant_id=v.tenant_id AND p.id=v.package_id WHERE v.tenant_id=$1 AND v.package_id=$2 AND v.hash=$3 AND p.kind='workflow' AND v.status<>'rejected' AND (p.user_id=$4 OR $4=ANY(p.reviewers))", [principal.tenantId, packageId, hash, principal.userId])).rows[0];
      if (!row) throw new PlatformAccessError('Candidate is not available to this evaluator');
      return { packageId, hash: row.hash as string, definition: row.data as Record<string, unknown>, revision: Number(row.revision) };
    });
  }
  async submitCandidate(principal: PlatformPrincipal, runs: PostgresRunRepository, packageId: string, snapshot: RuntimeSnapshot, definition: Record<string, unknown>, payload: unknown, key: string): Promise<RuntimeSnapshot> {
    this.require(principal);
    if (snapshot.tenantId !== principal.tenantId || snapshot.userId !== principal.userId) throw new PlatformAccessError('Candidate owner differs from principal');
    return this.transaction(principal, async client => {
      const row = (await client.query("SELECT v.hash FROM platform_registry_versions v JOIN platform_registry_packages p ON p.tenant_id=v.tenant_id AND p.id=v.package_id WHERE v.tenant_id=$1 AND v.package_id=$2 AND v.hash=$3 AND p.kind='workflow' AND v.status<>'rejected' AND (p.user_id=$4 OR $4=ANY(p.reviewers)) FOR SHARE OF p,v", [principal.tenantId, packageId, snapshot.definitionHash, principal.userId])).rows[0];
      if (!row) throw new PlatformAccessError('Candidate is unavailable');
      return runs.submit(snapshot, definition, payload, key, { tenantId: principal.tenantId, client });
    });
  }
  async submitPublished(principal: PlatformPrincipal, runs: PostgresRunRepository, packageId: string, revision: number, snapshot: RuntimeSnapshot, definition: Record<string, unknown>, payload: unknown, requestKey: string): Promise<RuntimeSnapshot> {
    if (snapshot.tenantId !== principal.tenantId || snapshot.userId !== principal.userId) throw new PlatformAccessError('Published run owner mismatch');
    return this.transaction(principal, async client => {
      const current = (await client.query("SELECT v.* FROM platform_registry_packages p JOIN platform_registry_versions v ON v.tenant_id=p.tenant_id AND v.package_id=p.id AND v.hash=p.active_hash WHERE p.tenant_id=$1 AND p.id=$2 AND p.revision=$3 AND p.active_hash=$4 AND v.status='approved' AND (p.visibility='tenant' OR p.user_id=$5 OR $5=ANY(p.reviewers)) FOR SHARE OF p,v", [principal.tenantId, packageId, revision, snapshot.definitionHash, principal.userId])).rows[0];
      if (!current) throw new RuntimeConflictError('Published version changed before admission');
      await this.promotionEvidence(client, principal, current.hash, current.evaluation_id, current.publisher_id);
      return runs.submit(snapshot, definition, payload, requestKey, { tenantId: principal.tenantId, client });
    });
  }
  async activePrompts(principal: PlatformPrincipal) {
    return this.transaction(principal, async client => (await client.query("SELECT p.id,p.name,p.revision,v.hash AS \"definitionHash\",v.data->>'persona' AS persona,v.data->'steps'->0->>'taskPrompt' AS content FROM platform_registry_packages p JOIN platform_registry_versions v ON v.tenant_id=p.tenant_id AND v.package_id=p.id AND v.hash=p.active_hash JOIN platform_evaluations e ON e.tenant_id=v.tenant_id AND e.id=v.evaluation_id JOIN platform_datasets d ON d.tenant_id=e.tenant_id AND d.id=e.dataset_id AND d.version=e.dataset_version WHERE p.tenant_id=$1 AND v.status='approved' AND v.data->'tags' @> '[\"prompt\"]'::jsonb AND d.archived_at IS NULL AND (p.user_id=$2 OR p.visibility='tenant' OR $2=ANY(p.reviewers)) AND ($3::text[] IS NULL OR v.data->>'persona'=ANY($3)) ORDER BY p.name LIMIT 100", [principal.tenantId, principal.userId, principal.personaScopes.includes('*') ? null : principal.personaScopes])).rows);
  }
  async listPackages(principal: PlatformPrincipal) {
    return this.transaction(principal, async client => (await client.query("SELECT p.id,p.name,p.kind,p.visibility,p.user_id AS \"publisherId\",p.revision,p.active_hash AS \"activeHash\",v.hash,v.status,v.origin,v.license,v.reviewer_id AS \"reviewerId\" FROM platform_registry_packages p JOIN platform_registry_versions v ON v.tenant_id=p.tenant_id AND v.package_id=p.id WHERE p.tenant_id=$1 AND (p.user_id=$2 OR p.visibility='tenant' OR $2=ANY(p.reviewers)) ORDER BY v.created_at DESC LIMIT 100", [principal.tenantId, principal.userId])).rows);
  }
  async requestRecordReview(principal: PlatformPrincipal, input: { family: 'knowledge' | 'memory'; id: string; version: number; reviewerId: string; sourceRunId?: string; readers: string[]; expiresAt: string }): Promise<void> {
    if (input.family === 'memory' && !input.sourceRunId || !Number.isFinite(Date.parse(input.expiresAt)) || input.reviewerId === principal.userId || input.readers.length > 100 || Date.parse(input.expiresAt) <= Date.now() || Date.parse(input.expiresAt) > Date.now() + 366 * 86400_000) throw new Error('Independent review and bounded retention are required');
    await this.transaction(principal, async client => {
      const record = (await client.query('SELECT id FROM workspace_records WHERE tenant_id=$1 AND user_id=$2 AND family=$3 AND id=$4 AND version=$5 AND archived_at IS NULL FOR SHARE', [principal.tenantId, principal.userId, input.family, input.id, input.version])).rows[0];
      const ids = [...new Set([...input.readers, input.reviewerId])];
      const users = (await client.query('SELECT id FROM users WHERE tenant_id=$1 AND id=ANY($2::text[])', [principal.tenantId, ids])).rows;
      if (!record || users.length !== ids.length) throw new PlatformAccessError('Review source or recipients are unavailable');
      await client.query("INSERT INTO platform_record_reviews (tenant_id,family,record_id,user_id,record_version,reviewer_id,readers,expires_at,source_run_id,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending') ON CONFLICT (tenant_id,family,record_id) DO UPDATE SET record_version=EXCLUDED.record_version,reviewer_id=EXCLUDED.reviewer_id,readers=EXCLUDED.readers,expires_at=EXCLUDED.expires_at,source_run_id=EXCLUDED.source_run_id,status='pending'", [principal.tenantId, input.family, input.id, principal.userId, input.version, input.reviewerId, input.readers, input.expiresAt, input.sourceRunId ?? null]);
      await this.audit(client, principal, 'memory.review.requested', input.id, { version: input.version, reviewerId: input.reviewerId });
    });
  }
  async reviewRecord(principal: PlatformPrincipal, input: { family: 'knowledge' | 'memory'; id: string; version: number; ownerId: string; sourceRunId?: string; readers: string[]; expiresAt: string }): Promise<void> {
    this.require(principal);
    if (principal.userId === input.ownerId || input.readers.length > 100 || !Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= Date.now() || Date.parse(input.expiresAt) > Date.now() + 366 * 86400_000) throw new Error('Independent review and bounded retention are required');
    await this.transaction(principal, async client => {
      const request = (await client.query("SELECT * FROM platform_record_reviews WHERE tenant_id=$1 AND family=$2 AND record_id=$3 AND reviewer_id=$4 AND status='pending' FOR UPDATE", [principal.tenantId, input.family, input.id, principal.userId])).rows[0];
      if (!request || request.user_id !== input.ownerId || request.record_version !== input.version || integrationDigest(request.readers) !== integrationDigest(input.readers) || new Date(request.expires_at).toISOString() !== new Date(input.expiresAt).toISOString() || request.source_run_id !== (input.sourceRunId ?? null)) throw new PlatformAccessError('Owner-authorized review request required');
      const source = (await client.query('SELECT data FROM workspace_records WHERE tenant_id=$1 AND family=$2 AND id=$3 AND user_id=$4 AND version=$5 AND archived_at IS NULL FOR SHARE', [principal.tenantId, input.family, input.id, input.ownerId, input.version])).rows[0];
      if (!source) throw new RuntimeConflictError('Source record changed or is unavailable');
      const users = (await client.query('SELECT id FROM users WHERE tenant_id=$1 AND id=ANY($2::text[])', [principal.tenantId, input.readers])).rows;
      if (users.length !== new Set(input.readers).size) throw new PlatformAccessError('Reader is outside the tenant');
      if (input.family === 'memory') {
        if (!input.sourceRunId || source.data.taskRef !== input.sourceRunId) throw new RuntimeConflictError('Memory lineage differs from the reviewed source run');
        const run = (await client.query("SELECT id FROM runtime_runs WHERE tenant_id=$1 AND id=$2 AND user_id=$3 AND mode='live' AND status='completed'", [principal.tenantId, input.sourceRunId ?? source.data.taskRef, input.ownerId])).rows[0];
        if (!run) throw new RuntimeConflictError('Memory promotion requires completed live source evidence');
      }
      await client.query("UPDATE platform_record_reviews SET status='approved' WHERE tenant_id=$1 AND family=$2 AND record_id=$3", [principal.tenantId, input.family, input.id]);
      await this.audit(client, principal, 'memory.reviewed', input.id, { family: input.family, version: input.version, expiresAt: input.expiresAt });
    });
  }
  async reviewRequests(principal: PlatformPrincipal) {
    return this.transaction(principal, async client => (await client.query("SELECT g.family,g.record_id AS id,g.user_id AS \"ownerId\",g.record_version AS version,g.reviewer_id AS \"reviewerId\",g.readers,g.expires_at AS \"expiresAt\",g.source_run_id AS \"sourceRunId\",r.data FROM platform_record_reviews g JOIN workspace_records r ON r.tenant_id=g.tenant_id AND r.family=g.family AND r.id=g.record_id AND r.version=g.record_version WHERE g.tenant_id=$1 AND (g.user_id=$2 OR g.reviewer_id=$2) AND g.status='pending' AND r.archived_at IS NULL AND g.expires_at>NOW() ORDER BY g.created_at DESC LIMIT 100", [principal.tenantId, principal.userId])).rows);
  }
  async searchKnowledge(principal: PlatformPrincipal, query: string) {
    if (!query.trim() || query.length > 500) throw new Error('Bounded search query required');
    return this.transaction(principal, async client => (await client.query("SELECT r.id,r.family,r.version,r.data,g.source_run_id AS \"sourceRunId\",g.reviewer_id AS \"reviewerId\",g.expires_at AS \"expiresAt\" FROM workspace_records r JOIN platform_record_reviews g ON g.tenant_id=r.tenant_id AND g.family=r.family AND g.record_id=r.id AND g.record_version=r.version WHERE r.tenant_id=$1 AND r.archived_at IS NULL AND g.status='approved' AND g.expires_at>NOW() AND (g.user_id=$2 OR $2=ANY(g.readers)) AND to_tsvector('simple',r.data::text) @@ plainto_tsquery('simple',$3) ORDER BY r.updated_at DESC LIMIT 20", [principal.tenantId, principal.userId, query])).rows);
  }
  async members(principal: PlatformPrincipal) {
    this.require(principal, 'admin');
    return this.transaction(principal, async client => (await client.query("SELECT u.id,u.name,u.email,COALESCE(m.role,u.role) AS role,COALESCE(m.state,'active') AS state,COALESCE(m.version,0) AS version,m.persona_scopes AS \"personaScopes\" FROM users u LEFT JOIN platform_memberships m ON m.tenant_id=u.tenant_id AND m.user_id=u.id WHERE u.tenant_id=$1 ORDER BY u.id LIMIT 200", [principal.tenantId])).rows);
  }
  async updateMember(principal: PlatformPrincipal, userId: string, expectedVersion: number, input: { role: PlatformPrincipal['role']; state: 'active' | 'suspended'; personaScopes: string[] }) {
    this.require(principal, 'admin');
    if (input.state === 'active' && !input.personaScopes.length || input.personaScopes.some(scope => !['*','engineering','product','marketing','hr','ta','program','executive','design','learning'].includes(scope))) throw new Error('Invalid member scopes');
    return tenantTransaction(this.pool, principal.tenantId, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`tenant-admin:${principal.tenantId}`]);
      await this.guard(client, principal);
      const user = (await client.query('SELECT id,role FROM users WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [principal.tenantId, userId])).rows[0];
      const current = (await client.query('SELECT * FROM platform_memberships WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE', [principal.tenantId, userId])).rows[0];
      if (!user || Number(current?.version ?? 0) !== expectedVersion) throw new RuntimeConflictError('Member changed or is outside the tenant');
      if ((current?.role ?? user.role) === 'admin' && (input.role !== 'admin' || input.state !== 'active')) {
        const count = Number((await client.query("SELECT count(*) AS count FROM users u LEFT JOIN platform_memberships m ON m.tenant_id=u.tenant_id AND m.user_id=u.id WHERE u.tenant_id=$1 AND COALESCE(m.role,u.role)='admin' AND COALESCE(m.state,'active')='active'", [principal.tenantId])).rows[0]!.count);
        if (count <= 1) throw new RuntimeConflictError('Cannot remove the last active tenant administrator');
      }
      await client.query('INSERT INTO platform_memberships (tenant_id,user_id,role,state,persona_scopes) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id,user_id) DO UPDATE SET role=EXCLUDED.role,state=EXCLUDED.state,persona_scopes=EXCLUDED.persona_scopes,version=platform_memberships.version+1,updated_at=NOW()', [principal.tenantId, userId, input.role, input.state, input.personaScopes]);
      await client.query('UPDATE users SET role=$3 WHERE tenant_id=$1 AND id=$2', [principal.tenantId, userId, input.role]);
      await client.query("UPDATE browser_auth_sessions SET data=jsonb_set(data,'{revoked}','true'::jsonb) WHERE data->'user'->>'tenantId'=$1 AND data->'user'->>'id'=$2", [principal.tenantId, userId]);
      await this.audit(client, principal, 'member.updated', userId, { ...input, previousVersion: expectedVersion });
      return { userId, version: expectedVersion + 1, ...input };
    });
  }
  async auditLog(principal: PlatformPrincipal) { this.require(principal); return this.transaction(principal, async client => (await client.query('SELECT id,actor_id AS "actorId",action,resource,data,created_at AS "createdAt" FROM platform_audit WHERE tenant_id=$1 ORDER BY created_at DESC,id LIMIT 100', [principal.tenantId])).rows); }
}
