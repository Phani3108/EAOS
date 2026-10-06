import { z } from 'zod';
import type { PlatformRepository, PlatformPrincipal } from '@agentos/db/platform-repository';
import type { PostgresRunRepository } from '@agentos/db/run-repository';
import type { AuthUser } from './auth.js';
import { requirePersonaAccess } from './auth.js';
import { compileDefinition, requiredPersonas } from './definition-registry.js';
import { preparePersonaExecution } from './persona-api.js';
import type { RuntimeSnapshot } from '@agentos/db/run-repository';
import { compileConnectorManifest, connectorContract } from './connector-service.js';
import { validate } from './validation.js';
import { WORKFLOW_PERSONAS, type UnifiedSkillDef, type WorkflowPersona } from '@agentos/skills/schema';
import { getAgentsByPersona } from './agent-registry.js';

export const platformPrincipal = (user: AuthUser): PlatformPrincipal => ({ tenantId: user.tenantId, userId: user.id, role: user.role, personaScopes: user.personaScopes ?? [] });
const id = z.string().min(1).max(200);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.number().int().nonnegative();
const measuredAliases = ['/api/metrics','/api/observability/metrics','/api/costs/meter','/api/costs/history'];
export function isPlatformRoute(path: string): boolean { return ['/api/operations','/api/evaluations','/api/registry/packages','/api/registry/connectors','/api/admin/members','/api/knowledge/governance','/api/knowledge/search','/api/prompts'].some(prefix => path === prefix || path.startsWith(prefix + '/')) || measuredAliases.includes(path) || path.startsWith('/api/agent-evals') || path.startsWith('/api/evals/'); }
export async function platformRequest(repository: PlatformRepository | undefined, runs: PostgresRunRepository | undefined, user: AuthUser, url: URL, method: string, readBody: () => Promise<Record<string, unknown>>, onMemberChange: (id: string) => void): Promise<{ status: number; data: unknown }> {
  if (!repository || !runs) return { status: 422, data: { error: 'Operating platform requires durable PostgreSQL storage', code: 'durable_runtime_required' } };
  const principal = platformPrincipal(user), path = url.pathname;
  if ((path === '/api/operations' || path === '/api/operations/summary' || measuredAliases.includes(path) || path.startsWith('/api/agent-evals')) && method === 'GET') return { status: 200, data: await repository.summary(principal) };
  if ((path === '/api/operations/agents' || path === '/api/evals/agents') && method === 'GET') return { status: 200, data: { agents: await repository.agentMetrics(principal), synthetic: false } };
  if (path.startsWith('/api/evals/')) return { status: 410, data: { error: 'Legacy fingerprints are not measured quality. Use versioned evaluations and the operations API.' } };
  if (path === '/api/operations/notifications' && method === 'GET') return { status: 200, data: { notifications: await repository.notifications(principal) } };
  if (path === '/api/operations/notifications' && method === 'POST') {
    const input = validate(z.object({ channelId: id, sourceRunId: id, deliveryKey: id, simulate: z.boolean() }).strict(), await readBody());
    const { channel, source } = await repository.notificationSource(principal, input.channelId, input.sourceRunId);
    const persona = source.persona as WorkflowPersona;
    const agent = persona === 'program' ? 'pmo-director' : getAgentsByPersona(persona === 'ta' ? 'hr' : persona)[0]?.id;
    if (!agent) return { status: 422, data: { error: 'Source persona has no notification executor' } };
    const definition = compileDefinition({ id: `notification-${persona}`, slug: 'notify-run', name: 'Notify run result', description: 'Approved source-run notification', icon: '', persona, executableType: 'workflow', cluster: 'Operations', complexity: 'simple', estimatedTime: '', inputs: [], outputs: ['receipt'], requiredTools: ['slack'], optionalTools: [], tags: ['notification'], steps: [{ id: 'deliver', order: 1, name: 'Approve and deliver run result', agent, agentPersona: persona, kind: 'tool_effect', tool: 'slack', outputKey: 'receipt', requiresApproval: true, toolAction: { action: 'create', resourceType: 'message', inputBindings: { channel: 'inputs.channel', text: 'inputs.text' } } }] });
    const prepared = preparePersonaExecution(user.tenantId, persona, definition, { channel: channel.config.destination, text: JSON.stringify({ runId: source.id, status: source.status, mode: source.mode, outputs: source.outputs }) }, user.id, input.simulate);
    prepared.exec.source = { type: 'notification', label: 'Run result notification', sourceRunId: source.id, channelId: input.channelId };
    const execution = await repository.notification(principal, runs, input.channelId, source.id, input.deliveryKey, prepared.exec as unknown as RuntimeSnapshot, { ...definition }, prepared.payload);
    return { status: 201, data: { execution } };
  }
  if (path === '/api/operations/jobs' && method === 'GET') return { status: 200, data: { jobs: await repository.recovery(principal) } };
  if (path === '/api/operations/events' && method === 'GET') return { status: 200, data: await repository.replayEvents(principal, url.searchParams.get('cursor') ?? undefined) };
  if (path === '/api/operations/audit' && method === 'GET') return { status: 200, data: { events: await repository.auditLog(principal) } };
  const recover = path.match(/^\/api\/operations\/runs\/([^/]+)\/(retry|cancel)$/);
  if (recover && method === 'POST') {
    if (!['admin','operator'].includes(user.role)) return { status: 403, data: { error: 'Operator role required' } };
    const run = await runs.get(user.tenantId, recover[1]!);
    if (!run || !requirePersonaAccess(user, run.persona) || Array.isArray(run.requiredPersonas) && run.requiredPersonas.some(scope => typeof scope !== 'string' || !requirePersonaAccess(user, scope))) return { status: 404, data: { error: 'Run not found' } };
    const changed = recover[2] === 'retry' ? await runs.retryFailed(user.tenantId, run.id) : await runs.cancel(user.tenantId, run.id);
    return { status: changed ? 202 : 409, data: { changed, runId: run.id } };
  }
  if (path === '/api/evaluations/datasets') {
    if (method === 'GET') return { status: 200, data: { datasets: await repository.listDatasets(principal) } };
    if (method === 'POST') {
      const input = validate(z.object({ name: id, cases: z.array(z.object({ id, inputs: z.record(z.string(), z.json()), expected: z.string().min(1).max(64_000) }).strict()).min(1).max(100) }).strict(), await readBody());
      return { status: 201, data: { dataset: await repository.createDataset(principal, input) } };
    }
  }
  const dataset = path.match(/^\/api\/evaluations\/datasets\/([^/]+)(\/share)?$/);
  if (dataset) {
    if (method === 'GET' && !dataset[2]) return { status: 200, data: { dataset: await repository.getDataset(principal, dataset[1]!) } };
    if (method === 'POST' && dataset[2]) {
      const input = validate(z.object({ version, readers: z.array(id).max(100) }).strict(), await readBody());
      await repository.shareDataset(principal, dataset[1]!, input.version, input.readers);
      return { status: 200, data: { shared: true } };
    }
  }
  if (path === '/api/evaluations' && method === 'POST') {
    const input = validate(z.object({ datasetId: id, datasetVersion: version, definitionHash: hash, observations: z.array(z.object({ caseId: id, runId: id, passed: z.boolean(), reason: z.string().min(10).max(4000) }).strict()).min(1).max(100) }).strict(), await readBody());
    return { status: 201, data: { evaluation: await repository.recordEvaluation(principal, input) } };
  }
  if (path === '/api/prompts' && method === 'GET') {
    const prompts = await repository.activePrompts(principal);
    return { status: 200, data: { prompts, total: prompts.length, authority: 'canonical-registry', legacyImported: false } };
  }
  if (path === '/api/prompts' && method === 'POST') {
    const input = validate(z.object({ name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/), persona: z.enum(WORKFLOW_PERSONAS), agentId: id, content: z.string().min(1).max(20_000), origin: z.string().min(1).max(1000), license: z.string().min(1).max(100), visibility: z.enum(['private','tenant']).default('private'), reviewers: z.array(id).max(30).default([]) }).strict(), await readBody());
    if (!requirePersonaAccess(user, input.persona)) return { status: 403, data: { error: 'Prompt persona scope denied' } };
    const definition = compileDefinition({ id: `prompt-${input.name}`, slug: input.name, name: input.name, description: 'Versioned runtime prompt', icon: '', persona: input.persona, executableType: 'skill', cluster: 'Prompts', complexity: 'simple', estimatedTime: '', inputs: [{ id: 'user_input', label: 'User input', type: 'textarea', required: true, section: 'basic' }], steps: [{ id: 'respond', order: 1, name: 'Respond using reviewed prompt', agent: input.agentId, agentPersona: input.persona, kind: 'llm', outputKey: 'response', taskPrompt: input.content }], outputs: ['response'], requiredTools: ['llm'], optionalTools: [], tags: ['prompt'] });
    return { status: 201, data: await repository.stageVersion(principal, { name: `prompt.${input.name}`, kind: 'workflow', definition: { ...definition }, origin: input.origin, license: input.license, visibility: input.visibility, reviewers: input.reviewers }) };
  }
  if (path.startsWith('/api/prompts/')) return { status: 410, data: { error: 'Runtime prompts use canonical registry versions, review and activation. Legacy editorial records were not imported.' } };
  if (path === '/api/registry/connectors' && method === 'GET') return { status: 200, data: { contracts: ['github','jira','slack'].map(connectorContract), activationEnabled: false } };
  if (path === '/api/registry/packages') {
    if (method === 'GET') return { status: 200, data: { packages: await repository.listPackages(principal) } };
    if (method === 'POST') {
      const input = validate(z.object({ name: id, kind: z.enum(['workflow','connector']), definition: z.record(z.string(), z.unknown()), origin: z.string().min(1).max(1000), license: z.string().min(1).max(100), visibility: z.enum(['private','tenant']).default('private'), reviewers: z.array(id).max(30).default([]) }).strict(), await readBody());
      let definition: Record<string, unknown>;
      if (input.kind === 'workflow') {
        definition = { ...compileDefinition(input.definition as unknown as UnifiedSkillDef) };
        if (requiredPersonas(definition as unknown as UnifiedSkillDef).some(persona => !requirePersonaAccess(user, persona))) return { status: 403, data: { error: 'Workflow persona denied' } };
      } else {
        definition = { ...compileConnectorManifest(input.definition) };
      }
      return { status: 201, data: await repository.stageVersion(principal, { ...input, definition }) };
    }
  }
  const pkg = path.match(/^\/api\/registry\/packages\/([^/]+)\/(active|review|activate|execute|preview|conformance)$/);
  if (pkg) {
    if (method === 'GET' && pkg[2] === 'conformance') return { status: 200, data: await repository.connectorConformance(principal, pkg[1]!, validate(hash, url.searchParams.get('hash'))) };
    if (method === 'GET' && pkg[2] === 'active') return { status: 200, data: await repository.getActiveVersion(principal, pkg[1]!) };
    if (method === 'POST' && pkg[2] === 'review') {
      const input = validate(z.object({ hash, evaluationId: id, approved: z.boolean(), reason: z.string().min(10).max(4000) }).strict(), await readBody());
      await repository.reviewVersion(principal, pkg[1]!, input.hash, input.evaluationId, input.approved, input.reason);
      return { status: 200, data: { reviewed: true } };
    }
    if (method === 'POST' && pkg[2] === 'activate') {
      const input = validate(z.object({ hash, expectedRevision: version }).strict(), await readBody());
      return { status: 200, data: await repository.activateVersion(principal, pkg[1]!, input.hash, input.expectedRevision) };
    }
    if (method === 'POST' && pkg[2] === 'preview') {
      const input = validate(z.object({ hash, inputs: z.record(z.string(), z.unknown()), simulate: z.boolean(), requestKey: z.string().min(1).max(160) }).strict(), await readBody());
      const candidate = await repository.candidateVersion(principal, pkg[1]!, input.hash);
      const definition = compileDefinition(candidate.definition as unknown as UnifiedSkillDef);
      if (definition.definitionHash !== candidate.hash || requiredPersonas(definition).some(persona => !requirePersonaAccess(user, persona))) return { status: 403, data: { error: 'Candidate scope denied' } };
      const prepared = preparePersonaExecution(user.tenantId, definition.persona, definition, input.inputs, user.id, input.simulate);
      prepared.exec.source = { type: 'candidate-evaluation', label: definition.name, packageId: candidate.packageId };
      return { status: 201, data: { execution: await repository.submitCandidate(principal, runs, candidate.packageId, prepared.exec as unknown as RuntimeSnapshot, { ...definition }, prepared.payload, `candidate:${input.requestKey}`) } };
    }
    if (method === 'POST' && pkg[2] === 'execute') {
      const input = validate(z.object({ inputs: z.record(z.string(), z.unknown()), simulate: z.boolean(), requestKey: z.string().min(1).max(160) }).strict(), await readBody());
      const active = await repository.getActiveVersion(principal, pkg[1]!);
      const definition = compileDefinition(active.definition as unknown as UnifiedSkillDef);
      if (definition.definitionHash !== active.hash || requiredPersonas(definition).some(persona => !requirePersonaAccess(user, persona))) return { status: 403, data: { error: 'Active version cannot be executed by this principal' } };
      const prepared = preparePersonaExecution(user.tenantId, definition.persona, definition, input.inputs, user.id, input.simulate);
      prepared.exec.source = { type: 'registry', label: definition.name, packageId: active.packageId, revision: active.revision };
      const execution = await repository.submitPublished(principal, runs, active.packageId, active.revision, prepared.exec as unknown as RuntimeSnapshot, { ...definition }, prepared.payload, `registry:${input.requestKey}`);
      return { status: 201, data: { execution } };
    }
  }
  if (path === '/api/knowledge/governance' && method === 'GET') return { status: 200, data: { requests: await repository.reviewRequests(principal) } };
  if (path === '/api/knowledge/search' && method === 'GET') return { status: 200, data: { sources: await repository.searchKnowledge(principal, url.searchParams.get('q') ?? '') } };
  if (path === '/api/knowledge/governance/request' && method === 'POST') {
    const input = validate(z.object({ family: z.enum(['knowledge','memory']), id, version, reviewerId: id, sourceRunId: id.optional(), readers: z.array(id).max(100), expiresAt: z.iso.datetime() }).strict(), await readBody());
    await repository.requestRecordReview(principal, input);
    return { status: 201, data: { requested: true } };
  }
  if (path === '/api/knowledge/governance/approve' && method === 'POST') {
    const input = validate(z.object({ family: z.enum(['knowledge','memory']), id, version, ownerId: id, sourceRunId: id.optional(), readers: z.array(id).max(100), expiresAt: z.iso.datetime() }).strict(), await readBody());
    await repository.reviewRecord(principal, input);
    return { status: 200, data: { approved: true } };
  }
  if (path === '/api/admin/members' && method === 'GET') return { status: 200, data: { members: await repository.members(principal) } };
  const member = path.match(/^\/api\/admin\/members\/([^/]+)$/);
  if (member && method === 'PATCH') {
    const input = validate(z.object({ version, role: z.enum(['user','operator','admin']), state: z.enum(['active','suspended']), personaScopes: z.array(id).max(30) }).strict(), await readBody());
    const result = await repository.updateMember(principal, member[1]!, input.version, input);
    onMemberChange(member[1]!);
    if (input.state === 'suspended') {
      const pending = await runs.list(user.tenantId, member[1]!, 100, 0);
      for (const run of pending.executions) if (['queued','running','paused'].includes(run.status)) await runs.cancel(user.tenantId, run.id, member[1]!);
    }
    return { status: 200, data: result };
  }
  return { status: 404, data: { error: 'Unknown operating-platform route' } };
}
