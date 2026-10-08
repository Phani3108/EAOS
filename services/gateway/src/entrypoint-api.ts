import type { AuthUser } from './auth.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { requirePersonaAccess } from './auth.js';
import type { PostgresRunRepository, RuntimeSnapshot } from '@agentos/db/run-repository';
import { WORKFLOW_PERSONAS } from '@agentos/skills/schema';
import { createPersonaExecution } from './persona-api.js';
import { compileGoalRequest, compileSomanRequest, compileSwarmRequest } from './entrypoint-adapters.js';
import { SWARM_TEMPLATES } from './swarm-manager.js';
import { compileClientRequest } from './workflow-client-adapter.js';

const singles = /^\/api\/(?:orchestrator\/goal|pipeline|swarms|a2a\/swarms)\/([^/]+)(?:\/(cancel|dissolve|advance))?$/;
export function isEntrypointRoute(path: string, method: string): boolean {
    if (['/api/workflows/execute','/api/workflows/validate'].includes(path) && method === 'POST') return true;
    if (method === 'GET' && (path === '/api/pipeline/graph' || /^\/api\/[^/]+\/pipeline\/graph$/.test(path))) return true;
    if (['/api/orchestrator/goal','/api/pipeline/execute','/api/swarms/launch','/api/a2a/swarms'].includes(path) && method === 'POST') return true;
    if (['/api/orchestrator/goals','/api/pipelines','/api/a2a/swarms','/api/swarms/stats','/api/swarms/templates'].includes(path) && method === 'GET') return true;
    return singles.test(path) && !['/api/pipeline/graph','/api/swarms/templates','/api/swarms/stats'].includes(path) && ['GET','POST'].includes(method);
}
function kind(path: string): 'goal' | 'soman' | 'swarm' {
    return path.includes('/orchestrator/') ? 'goal' : path.includes('/pipeline') ? 'soman' : 'swarm';
}
function source(run: RuntimeSnapshot): { type: string; label: string; [key: string]: unknown } {
    return run.source as { type: string; label: string; [key: string]: unknown };
}
export function projectEntrypoint(run: RuntimeSnapshot): Record<string, unknown> {
    const origin = source(run);
    const base = { id: run.id, status: run.status, mode: run.mode, startedAt: run.startedAt, completedAt: run.completedAt, execution: run };
    if (origin.type === 'goal') return { ...base, goal: origin.label, reasoning: 'Validated canonical execution', tasks: run.steps.map(step => ({ id: step.stepId, name: step.stepName, agent: step.agent, dependencies: step.dependsOn ?? [], status: step.status, output: step.outputKey ? run.outputs[step.outputKey] : undefined, childRunId: step.childRunId, error: step.error })), totalTokensUsed: run.totalTokensUsed ?? 0 };
    if (origin.type === 'soman') return { ...base, intent: origin.label, graphId: origin.graphId, totalCostUsd: run.totalTokenCost ?? 0, nodeStates: Object.fromEntries(run.steps.map(step => [step.stepId, step])), afterActionReport: null, statusReports: run.steps.map(step => ({ nodeId: step.stepId, status: step.status, output: step.outputKey ? run.outputs[step.outputKey] : undefined, error: step.error })) };
    const phases = run.steps.filter(step => step.kind === 'subworkflow');
    const active = phases.findIndex(step => !['completed','simulated','skipped'].includes(step.status));
    return { ...base, swarm: { swarm_id: run.id, mission: origin.label, type: origin.templateType, status: run.status, mode: run.mode, agents: origin.agents, can_advance: run.steps.some(step => step.status === 'approval_required'), current_phase: active < 0 ? phases.length : active, phases: phases.map(step => ({ name: step.stepName, status: step.status, childRunId: step.childRunId })), task_ref: run.id, created_at: run.startedAt, completed_at: run.completedAt, messages: [], meetings: [], artifacts: phases.filter(step => step.outputKey && run.outputs[step.outputKey]).map(step => ({ type: 'phase_output', title: step.stepName, content: run.outputs[step.outputKey!], author: step.agent, created_at: step.completedAt ?? run.startedAt })), metrics: { total_messages: 0, total_tool_calls: 0, total_tokens: Number(run.totalTokensUsed ?? 0), total_cost_usd: Number(run.totalTokenCost ?? 0), duration_ms: run.startedAt ? Math.max(0, new Date(String(run.completedAt ?? new Date().toISOString())).getTime() - new Date(String(run.startedAt)).getTime()) : 0, human_interventions: run.steps.filter(step => step.approvalDecision).length } }, kickoffMeeting: null, runtimes: [] };
}

export async function entrypointRequest(repository: PostgresRunRepository | undefined, principal: AuthUser, url: URL, method: string, readBody: () => Promise<Record<string, unknown>>, requestKey?: string): Promise<{ status: number; data: unknown }> {
    const path = url.pathname;
    if (method === 'GET' && (path === '/api/pipeline/graph' || /^\/api\/[^/]+\/pipeline\/graph$/.test(path))) {
        const persona = path === '/api/pipeline/graph' ? url.searchParams.get('persona') : path.split('/')[2];
        if (!persona || !(WORKFLOW_PERSONAS as readonly string[]).includes(persona)) return { status: 400, data: { error: 'Known workflow persona required' } };
        if (!requirePersonaAccess(principal, persona)) return { status: 403, data: { error: 'Persona access denied' } };
        try {
            const root = fileURLToPath(new URL('../../../', import.meta.url));
            const data = JSON.parse(await readFile(resolve(root, 'agents', persona, 'graph_runtime', 'graph.json'), 'utf8'));
            return { status: 200, data };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 404, data: { error: 'No registered graph for this persona' } };
            throw error;
        }
    }
    if (path === '/api/swarms/templates' && method === 'GET') return { status: 200, data: { templates: SWARM_TEMPLATES } };
    if (!repository) return { status: 422, data: { error: 'Canonical orchestration requires durable PostgreSQL storage', code: 'durable_runtime_required' } };
    if (['/api/workflows/execute','/api/workflows/validate'].includes(path) && method === 'POST') {
        if (!['admin','operator'].includes(principal.role)) return { status: 403, data: { error: 'Operator role required' } };
        let admission;
        try { admission = compileClientRequest(principal, await readBody()); }
        catch (error) { return { status: (error as { statusCode?: number }).statusCode ?? 422, data: { error: error instanceof Error ? error.message : 'Invalid workflow contract' } }; }
        if (requestKey && requestKey.length > 160) return { status: 400, data: { error: 'Idempotency key is too long' } };
        if (path === '/api/workflows/validate') return { status: 200, data: { valid: true, definition: admission.definition, inputs: admission.inputs, requiredStorage: 'postgresql', executed: false } };
        const execution = await createPersonaExecution(principal.tenantId, admission.definition.persona, admission.definition, admission.inputs, principal.id, admission.simulate, undefined, undefined, undefined, requestKey ? `client:${requestKey}` : undefined, admission.source);
        return { status: 200, data: { execution } };
    }
    if (['/api/orchestrator/goal','/api/pipeline/execute','/api/swarms/launch','/api/a2a/swarms'].includes(path) && method === 'POST') {
        if (kind(path) !== 'goal' && !['admin','operator'].includes(principal.role)) return { status: 403, data: { error: 'Operator role required' } };
        const body = await readBody();
        const compile = kind(path) === 'goal' ? compileGoalRequest : kind(path) === 'soman' ? compileSomanRequest : compileSwarmRequest;
        let admission;
        try { admission = compile(principal, body); }
        catch (error) { return { status: (error as { statusCode?: number }).statusCode ?? 422, data: { error: error instanceof Error ? error.message : 'Invalid orchestration contract' } }; }
        if (requestKey && requestKey.length > 160) return { status: 400, data: { error: 'Idempotency key is too long' } };
        const run = await createPersonaExecution(principal.tenantId, admission.definition.persona, admission.definition, admission.inputs, principal.id, admission.simulate, undefined, admission.provider, admission.modelId, requestKey ? `${admission.source.type}:${requestKey}` : undefined, admission.source);
        return { status: admission.source.type === 'swarm' ? 201 : 200, data: projectEntrypoint(run as unknown as RuntimeSnapshot) };
    }
    const match = path.match(singles);
    const expected = kind(path);
    const privileged = principal.role === 'admin' || principal.role === 'operator';
    if (match) {
        const run = await repository.get(principal.tenantId, match[1]!);
        if (!run || source(run)?.type !== expected || !requirePersonaAccess(principal, run.persona) || Array.isArray(run.requiredPersonas) && run.requiredPersonas.some(persona => typeof persona !== 'string' || !requirePersonaAccess(principal, persona)) || !privileged && run.userId !== principal.id) return { status: 404, data: { error: 'Execution not found' } };
        if (method === 'GET' && !match[2]) return { status: 200, data: projectEntrypoint(run) };
        if (method === 'POST' && ['cancel','dissolve'].includes(match[2] ?? '')) return { status: 200, data: { cancelled: await repository.cancel(principal.tenantId, run.id, privileged ? undefined : principal.id) } };
        if (method === 'POST' && match[2] === 'advance' && expected === 'swarm') {
            if (!privileged) return { status: 403, data: { error: 'Operator role required' } };
            const body = await readBody();
            const gate = run.steps.find(step => step.status === 'approval_required');
            if (!gate) return { status: 409, data: { error: 'No completed phase is waiting for approval; progress cannot be forced' } };
            if (body.stepId !== undefined && body.stepId !== gate.stepId) return { status: 409, data: { error: 'Swarm phase changed' } };
            await repository.decide(principal.tenantId, run.id, gate.stepId, principal.id, true, 'Phase advancement approved', body.confirmations && typeof body.confirmations === 'object' ? body.confirmations as Record<string, boolean> : {});
            return { status: 200, data: projectEntrypoint((await repository.get(principal.tenantId, run.id))!) };
        }
        return { status: 405, data: { error: 'Unsupported orchestration operation' } };
    }
    const limit = Number(url.searchParams.get('limit') ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return { status: 400, data: { error: 'Invalid history limit' } };
    const result = await repository.list(principal.tenantId, privileged ? undefined : principal.id, limit, 0, { source: expected, personas: [...WORKFLOW_PERSONAS,'executive','design','learning'].filter(persona => requirePersonaAccess(principal, persona)) });
    const rows = result.executions.map(projectEntrypoint);
    if (path === '/api/a2a/swarms') return { status: 200, data: { swarms: rows.map(row => row.swarm), total: result.total } };
    if (path === '/api/swarms/stats') return { status: 200, data: { total: result.total, active: result.executions.filter(run => ['queued','running','paused'].includes(run.status)).length, completed: result.executions.filter(run => run.status === 'completed').length, totalAgents: result.executions.reduce((sum, run) => sum + (Array.isArray(source(run).agents) ? (source(run).agents as unknown[]).length : 0), 0), totalMessages: 0 } };
    return { status: 200, data: rows };
}
