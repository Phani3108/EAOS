import type { GatewayWorkflowClient, CanonicalWorkflowSnapshot } from './gateway-workflow-client.js';

export interface OperationsSummary {
  windowHours: number; measuredAt: string;
  http: { requests: number; errors: number; meanLatencyMs: number | null };
  runs: Array<{ mode: 'live' | 'simulation'; status: string; count: number }>;
  jobs: Array<{ status: string; count: number; expired: number }>;
  usage: { spentMicros: number; reservedMicros: number };
  evaluations: { sampleCount: number; passRate: number | null; basis: string };
}
export interface LabeledDataset { name: string; cases: Array<{ id: string; inputs: Record<string, unknown>; expected: string }> }
export interface DatasetRecord { id: string; userId: string; tenantId: string; version: number; data: LabeledDataset; readers: string[] }
export interface EvaluationEvidence { datasetId: string; datasetVersion: number; definitionHash: string; observations: Array<{ caseId: string; runId: string; passed: boolean; reason: string }> }
export interface RegistryCandidate { name: string; kind: 'workflow' | 'connector'; definition: Record<string, unknown>; origin: string; license: string; visibility: 'private' | 'tenant'; reviewers?: string[] }
export interface ConnectorConformanceReport { schemaVersion: 1; packageId: string; manifestHash: string; adapterHash: string | null; adapterCurrent: boolean; activationEligible: false; evidenceWindowDays: number; evidenceBasis: string; actions: Array<{ actionId: string; customTransport: number; nativeTransport: number }>; blockers: string[] }
export interface TenantMember { id: string; name: string; email: string; role: 'user' | 'operator' | 'admin'; state: 'active' | 'suspended'; version: number; personaScopes: string[] | null }
export interface PlatformEvent { id: string; type: string; createdAt: string; data: { schemaVersion?: number; sequence?: string; tenantId?: string; runId: string; status: string; mode: 'live' | 'simulation'; [key: string]: unknown } }
export class PlatformClient {
  constructor(private readonly transport: GatewayWorkflowClient) {}
  summary(): Promise<OperationsSummary> { return this.transport.platform('/api/operations/summary'); }
  recovery(): Promise<{ jobs: Array<{ id: string; status: string; mode: string; attempts: number; workerId: string | null; error: string | null }> }> { return this.transport.platform('/api/operations/jobs'); }
  events(cursor = '0'): Promise<{ events: PlatformEvent[]; cursor: string }> { return this.transport.platform(`/api/operations/events?cursor=${encodeURIComponent(cursor)}`); }
  audit(): Promise<{ events: Array<{ id: string; actorId: string; action: string; resource: string; createdAt: string }> }> { return this.transport.platform('/api/operations/audit'); }
  createDataset(data: LabeledDataset): Promise<{ dataset: DatasetRecord }> { return this.transport.platform('/api/evaluations/datasets', 'POST', data); }
  dataset(id: string): Promise<{ dataset: DatasetRecord }> { return this.transport.platform(`/api/evaluations/datasets/${encodeURIComponent(id)}`); }
  shareDataset(id: string, version: number, readers: string[]): Promise<{ shared: boolean }> { return this.transport.platform(`/api/evaluations/datasets/${encodeURIComponent(id)}/share`, 'POST', { version, readers }); }
  evaluate(evidence: EvaluationEvidence): Promise<{ evaluation: { id: string; stage: 'live' | 'simulation'; sampleCount: number; passRate: number } }> { return this.transport.platform('/api/evaluations', 'POST', evidence); }
  stage(candidate: RegistryCandidate): Promise<{ packageId: string; hash: string; revision: number }> { return this.transport.platform('/api/registry/packages', 'POST', candidate); }
  packages(): Promise<{ packages: Array<{ id: string; name: string; kind: string; hash: string; status: string; revision: number; activeHash: string | null }> }> { return this.transport.platform('/api/registry/packages'); }
  connectorContracts(): Promise<{ activationEnabled: false; contracts: Array<{ id: string; adapterVersion: string; adapterHash: string; actions: Array<{ id: string; effect: boolean; inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown>; scope: string }> }> }> { return this.transport.platform('/api/registry/connectors'); }
  connectorConformance(packageId: string, hash: string): Promise<ConnectorConformanceReport> { return this.transport.platform(`/api/registry/packages/${encodeURIComponent(packageId)}/conformance?hash=${encodeURIComponent(hash)}`); }
  review(packageId: string, hash: string, evaluationId: string, approved: boolean, reason: string): Promise<{ reviewed: boolean }> { return this.transport.platform(`/api/registry/packages/${encodeURIComponent(packageId)}/review`, 'POST', { hash, evaluationId, approved, reason }); }
  activate(packageId: string, hash: string, expectedRevision: number): Promise<{ activeHash: string; revision: number }> { return this.transport.platform(`/api/registry/packages/${encodeURIComponent(packageId)}/activate`, 'POST', { hash, expectedRevision }); }
  preview(packageId: string, hash: string, inputs: Record<string, unknown>, simulate: boolean, requestKey: string): Promise<{ execution: CanonicalWorkflowSnapshot }> { return this.transport.platform(`/api/registry/packages/${encodeURIComponent(packageId)}/preview`, 'POST', { hash, inputs, simulate, requestKey }); }
  prompts(): Promise<{ prompts: Array<{ id: string; name: string; definitionHash: string; content: string }>; authority: 'canonical-registry' }> { return this.transport.platform('/api/prompts'); }
  execute(packageId: string, inputs: Record<string, unknown>, simulate: boolean, requestKey: string): Promise<{ execution: CanonicalWorkflowSnapshot }> { return this.transport.platform(`/api/registry/packages/${encodeURIComponent(packageId)}/execute`, 'POST', { inputs, simulate, requestKey }); }
  members(): Promise<{ members: TenantMember[] }> { return this.transport.platform('/api/admin/members'); }
  updateMember(id: string, version: number, role: TenantMember['role'], state: TenantMember['state'], personaScopes: string[]): Promise<{ userId: string; version: number }> { return this.transport.platform(`/api/admin/members/${encodeURIComponent(id)}`, 'PATCH', { version, role, state, personaScopes }); }
  searchKnowledge(query: string): Promise<{ sources: Array<{ id: string; family: string; version: number; data: Record<string, unknown>; sourceRunId: string | null; reviewerId: string; expiresAt: string }> }> { return this.transport.platform(`/api/knowledge/search?q=${encodeURIComponent(query)}`); }
  notify(channelId: string, sourceRunId: string, deliveryKey: string, simulate: boolean): Promise<{ execution: CanonicalWorkflowSnapshot }> { return this.transport.platform('/api/operations/notifications', 'POST', { channelId, sourceRunId, deliveryKey, simulate }); }
}
