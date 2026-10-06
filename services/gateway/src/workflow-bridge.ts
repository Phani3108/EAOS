/**
 * Gateway ↔ Workflow Engine bridge
 *
 * Exposes the @agentos/workflow-engine as gateway-level functions
 * for executing, resuming, and querying DAG-based workflows.
 */

import { WorkflowEngine } from '@agentos/workflow-engine';
import type { Workflow, WorkflowExecution, StepStatus } from '@agentos/workflow-engine';
import { GatewayWorkflowClient, type CanonicalWorkflowSnapshot } from '@agentos/sdk';

export interface WorkflowOwner { tenantId: string; userId: string }
export interface WorkflowBridgeClient {
    execute(owner: WorkflowOwner, workflow: Workflow, variables?: Record<string, unknown>): Promise<WorkflowExecution>;
    get(owner: WorkflowOwner, id: string): Promise<WorkflowExecution | undefined>;
    resume(owner: WorkflowOwner, id: string, stepId: string, result: unknown): Promise<void>;
    cancel(owner: WorkflowOwner, id: string): Promise<boolean>;
}
export class GatewayWorkflowBridgeClient implements WorkflowBridgeClient {
    constructor(private readonly clientFor: (owner: WorkflowOwner) => GatewayWorkflowClient) {}
    private project(owner: WorkflowOwner, run: CanonicalWorkflowSnapshot, attempts: Awaited<ReturnType<GatewayWorkflowClient['trace']>>['attempts'] = []): WorkflowExecution {
        if (run.tenantId !== owner.tenantId || run.userId !== owner.userId) throw new Error('Workflow owner differs from authenticated server state');
        return { id: run.id, workflowId: run.skillId, status: run.status === 'completed' ? 'complete' : run.status, startedAt: new Date(run.startedAt), completedAt: run.completedAt ? new Date(run.completedAt) : undefined, variables: run.inputs, stepStates: new Map(run.steps.map(step => [step.stepId, { stepId: step.stepId, status: (step.status === 'completed' ? 'complete' : step.status === 'approval_required' ? 'waiting_approval' : step.status) as StepStatus, attempts: attempts.filter(attempt => attempt.step_id === step.stepId).length, startedAt: step.startedAt ? new Date(step.startedAt) : undefined, completedAt: step.completedAt ? new Date(step.completedAt) : undefined, output: step.outputKey ? run.outputs[step.outputKey] : undefined, error: step.error }])), errors: attempts.filter(attempt => attempt.error).map(attempt => ({ stepId: attempt.step_id, error: attempt.error!, timestamp: new Date(attempt.started_at), attempt: attempt.attempt })), checkpoints: [] };
    }
    async execute(owner: WorkflowOwner, workflow: Workflow, variables?: Record<string, unknown>): Promise<WorkflowExecution> { return this.project(owner, await this.clientFor(owner).submit('workflow-engine', workflow, variables ?? workflow.variables)); }
    async get(owner: WorkflowOwner, id: string): Promise<WorkflowExecution | undefined> { const client = this.clientFor(owner); const run = await client.snapshot(id); return run ? this.project(owner, run, (await client.trace(id)).attempts) : undefined; }
    async resume(owner: WorkflowOwner, id: string, stepId: string, result: unknown): Promise<void> {
        if (!await this.get(owner, id)) throw new Error('Workflow not found');
        if (!result || typeof result !== 'object' || typeof (result as { approved?: unknown }).approved !== 'boolean') throw new Error('Explicit approval decision required');
        const decision = result as { approved: boolean; confirmations?: Record<string, boolean> };
        await this.clientFor(owner).decide(id, stepId, decision.approved, decision.confirmations);
    }
    async cancel(owner: WorkflowOwner, id: string): Promise<boolean> { if (!await this.get(owner, id)) return false; return this.clientFor(owner).cancel(id); }
}
let client: WorkflowBridgeClient | undefined;
export function configureWorkflowBridge(value: WorkflowBridgeClient): void { client = value; }
function requireClient(owner?: WorkflowOwner): WorkflowBridgeClient {
    if (!owner?.tenantId || !owner.userId || !client) throw new Error('A tenant-scoped canonical workflow client is required');
    return client;
}

// Singleton engine instance
const engine = new WorkflowEngine();

// Live skill execution requires the canonical submission client
engine.registerExecutor('skill', {
    async execute() {
        throw new Error('Skill execution must use a validated canonical definition and owner context');
    },
});

// Tool execution requires a conforming adapter; no synthetic success
engine.registerExecutor('tool', {
    async execute() {
        throw new Error('No tenant-scoped tool executor is registered');
    },
});

engine.registerExecutor('approval', {
    async execute() {
        return { output: null, status: 'waiting_approval' };
    },
});

engine.registerExecutor('transform', {
    async execute() {
        throw new Error('Transforms require explicit validated input bindings');
    },
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function executeWorkflow(workflow: Workflow, variables?: Record<string, unknown>, owner?: WorkflowOwner): Promise<WorkflowExecution> {
    return requireClient(owner).execute(owner!, workflow, variables);
}

export function getWorkflowExecution(id: string, owner?: WorkflowOwner): Promise<WorkflowExecution | undefined> {
    return requireClient(owner).get(owner!, id);
}

export function resumeWorkflow(executionId: string, stepId: string, result: unknown, owner?: WorkflowOwner): Promise<void> {
    return requireClient(owner).resume(owner!, executionId, stepId, result);
}

export function cancelWorkflow(id: string, owner?: WorkflowOwner): Promise<boolean> { return requireClient(owner).cancel(owner!, id); }

export { engine as workflowEngine };
