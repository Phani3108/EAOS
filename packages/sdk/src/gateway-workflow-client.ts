import type { WorkflowClient } from './workflow-runner.js';
import type { WorkflowDefinition, WorkflowExecution, TaskResult } from './types.js';

export interface CanonicalWorkflowSnapshot {
    id: string; tenantId: string; userId: string; skillId: string; status: WorkflowExecution['status']; mode: 'live' | 'simulation';
    inputs: Record<string, unknown>; outputs: Record<string, string>; startedAt: string; completedAt?: string;
    steps: Array<{ stepId: string; status: string; outputKey?: string; childRunId?: string; error?: string; latencyMs?: number; tokensUsed?: number; startedAt?: string; completedAt?: string }>;
}
export class GatewayWorkflowClient implements WorkflowClient {
    private readonly base: string;
    constructor(private readonly options: { baseUrl: string; headers: () => Promise<Record<string, string>>; fetch?: typeof fetch; simulate?: boolean }) {
        const url = new URL(options.baseUrl);
        if (url.username || url.password || url.search || url.hash || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('Use an HTTPS gateway or a local fixture without URL credentials');
        this.base = options.baseUrl.replace(/\/$/, '');
    }
    private async request(path: string, method = 'GET', body?: unknown): Promise<any> {
        const response = await (this.options.fetch ?? fetch)(`${this.base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...await this.options.headers() }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(30_000) });
        if (response.status === 404 && method === 'GET') return undefined;
        const data = await response.json() as { error?: string };
        if (!response.ok) throw new Error(data.error ?? `Gateway request failed (${response.status})`);
        return data;
    }
    async platform<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
        if (!/^\/api\/(operations|evaluations|registry|admin|knowledge|catalog|certification|workflows|orchestrator|prompts)(?:\/|\?|$)/.test(path)) throw new Error('Unsupported platform API path');
        return this.request(path, method, body) as Promise<T>;
    }
    async submit(format: 'sdk' | 'workflow-engine', workflow: unknown, variables: unknown, simulate = this.options.simulate ?? false): Promise<CanonicalWorkflowSnapshot> {
        const data = await this.request('/api/workflows/execute', 'POST', { format, workflow, variables, simulate });
        return data.execution;
    }
    async snapshot(id: string): Promise<CanonicalWorkflowSnapshot | undefined> { return (await this.request(`/api/executions/${encodeURIComponent(id)}`))?.execution; }
    async trace(id: string): Promise<{ attempts: Array<{ step_id: string; attempt: number; error?: string; started_at: string }>; artifacts: unknown[]; lineage: unknown[] }> { return this.request(`/api/executions/${encodeURIComponent(id)}/trace`); }
    async execute(workflow: WorkflowDefinition, trigger: unknown): Promise<WorkflowExecution> { return this.project(await this.submit('sdk', workflow, trigger)); }
    async get(id: string): Promise<WorkflowExecution | undefined> { const run = await this.snapshot(id); return run ? this.project(run) : undefined; }
    async decide(id: string, stepId: string, approved: boolean, confirmations: Record<string, boolean> = {}): Promise<void> {
        await this.request(`/api/executions/${encodeURIComponent(id)}/${approved ? 'approve' : 'reject'}/${encodeURIComponent(stepId)}`, 'POST', { confirmations });
    }
    async cancel(id: string): Promise<boolean> { return Boolean((await this.request(`/api/executions/${encodeURIComponent(id)}/cancel`, 'POST', {})).cancelled); }
    private project(run: CanonicalWorkflowSnapshot): WorkflowExecution {
        const results = new Map<string, TaskResult>();
        for (const step of run.steps) {
            if (!['completed','simulated','failed','rejected','inconclusive','unsupported','cancelled'].includes(step.status)) continue;
            results.set(step.stepId, { taskId: step.stepId, status: ['completed','simulated'].includes(step.status) ? 'success' : 'failure', output: step.outputKey ? run.outputs[step.outputKey] : undefined, error: step.error ? { code: step.status, message: step.error, retryable: false } : undefined, durationMs: step.latencyMs ?? 0, tokensUsed: step.tokensUsed ?? 0, toolCallCount: 0 });
        }
        return { id: run.id, workflowId: run.skillId, status: run.status, mode: run.mode, trigger: run.inputs.trigger ?? run.inputs.variables, stepResults: results, stepStates: new Map(run.steps.map(step => [step.stepId, { status: step.status, childRunId: step.childRunId }])), startedAt: new Date(run.startedAt), completedAt: run.completedAt ? new Date(run.completedAt) : undefined };
    }
}
