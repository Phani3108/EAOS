/**
 * @agentos/sdk — Workflow Runner
 *
 * Executes DAG-based workflows by resolving dependencies, evaluating conditions,
 * dispatching tasks to workers, and handling retries and approval gates.
 */

import type {
    WorkflowDefinition,
    WorkflowStep,
    WorkflowExecution,
    TaskResult,
    RetryConfig,
} from './types.js';
import { validateGraph, resolveGraphInput } from './graph-plan.js';

// ---------------------------------------------------------------------------
// Workflow Runner
// ---------------------------------------------------------------------------

/**
 * Executes a workflow definition as a DAG of tasks.
 */
export interface WorkflowClient {
    execute(workflow: WorkflowDefinition, trigger: unknown): Promise<WorkflowExecution>;
    get(id: string): Promise<WorkflowExecution | undefined>;
    decide(id: string, stepId: string, approved: boolean, confirmations?: Record<string, boolean>): Promise<void>;
    cancel(id: string): Promise<boolean>;
}

export class WorkflowRunner {
    constructor(private readonly client: WorkflowClient) {
        if (!client || typeof client.execute !== 'function' || typeof client.get !== 'function' || typeof client.cancel !== 'function' || typeof client.decide !== 'function') throw new Error('WorkflowRunner requires an authenticated canonical workflow client');
    }
    execute(workflow: WorkflowDefinition, trigger: unknown): Promise<WorkflowExecution> { return this.client.execute(workflow, trigger); }
    get(id: string): Promise<WorkflowExecution | undefined> { return this.client.get(id); }
    decide(id: string, stepId: string, approved: boolean, confirmations?: Record<string, boolean>): Promise<void> { return this.client.decide(id, stepId, approved, confirmations); }
    cancel(id: string): Promise<boolean> { return this.client.cancel(id); }
}

export class LegacyWorkflowRunner {
    constructor(
        private readonly dispatcher: TaskDispatcher,
        private readonly conditionEvaluator: ConditionEvaluator,
        private readonly approvalManager: ApprovalManager,
        private readonly client?: { execute(workflow: WorkflowDefinition, trigger: unknown): Promise<WorkflowExecution> },
    ) { }

    /**
     * Execute a workflow from a definition and trigger data.
     */
    async execute(
        workflow: WorkflowDefinition,
        trigger: unknown
    ): Promise<WorkflowExecution> {
        if (this.client) return this.client.execute(workflow, trigger);
        const executionId = crypto.randomUUID();
        const stepResults = new Map<string, TaskResult>();
        const skipped = new Set<string>();

        const execution: WorkflowExecution = {
            id: executionId,
            workflowId: workflow.name,
            status: 'running',
            trigger,
            stepResults,
            startedAt: new Date(),
        };

        try {
            // Build the execution plan (topological sort)
            const executionOrder = this.resolveExecutionOrder(workflow.steps);

            // Execute steps in order, respecting dependencies
            for (const step of executionOrder) {
                // Check if dependencies are met
                const depsReady = this.areDependenciesMet(step, stepResults);
                if (!depsReady) {
                    if (!(step.dependsOn ?? []).some(id => skipped.has(id))) throw new Error(`Unresolved dependency for '${step.id}'`);
                    skipped.add(step.id);
                    continue; // skip — dependency failed or was skipped
                }

                // Evaluate condition
                if (step.condition) {
                    const conditionMet = await this.conditionEvaluator.evaluate(
                        step.condition,
                        { trigger, steps: this.buildStepContext(stepResults) }
                    );
                    if (!conditionMet) {
                        skipped.add(step.id);
                        continue; // skip this step
                    }
                }

                // Handle approval gate
                if (step.approval?.required) {
                    const approved = await this.approvalManager.requestApproval({
                        stepId: step.id,
                        executionId,
                        workflowId: workflow.name,
                        approvers: step.approval.approvers,
                        timeoutMinutes: step.approval.timeoutMinutes,
                        escalation: step.approval.escalation,
                    });

                    if (!approved) {
                        execution.status = 'failed';
                        execution.error = `Approval denied for step '${step.id}'`;
                        break;
                    }
                }

                // Resolve input templates
                const resolvedInput = this.resolveTemplates(
                    step.input ?? {},
                    { trigger, steps: this.buildStepContext(stepResults) }
                );

                // Dispatch task to worker with retry
                const result = await this.executeStepWithRetry(
                    step,
                    executionId,
                    resolvedInput,
                    step.retry ?? workflow.retry
                );

                stepResults.set(step.id, result);

                if (result.status !== 'success') {
                    execution.status = 'failed';
                    execution.error = `Step '${step.id}' failed: ${result.error?.message}`;
                    break;
                }
            }

            if (execution.status === 'running') {
                if (stepResults.size + skipped.size !== workflow.steps.length) throw new Error('Workflow has unresolved required steps');
                execution.status = 'completed';
            }
        } catch (err) {
            execution.status = 'failed';
            execution.error = (err as Error).message;
        }

        execution.completedAt = new Date();
        return execution;
    }

    // -------------------------------------------------------------------------
    // DAG Resolution
    // -------------------------------------------------------------------------

    /**
     * Topological sort of workflow steps based on `dependsOn`.
     */
    private resolveExecutionOrder(steps: WorkflowStep[]): WorkflowStep[] {
        validateGraph(steps, steps.flatMap(step => (step.dependsOn ?? []).map(from => ({ from, to: step.id }))));
        const stepMap = new Map(steps.map((s) => [s.id, s]));
        const visited = new Set<string>();
        const order: WorkflowStep[] = [];

        const visit = (stepId: string) => {
            if (visited.has(stepId)) return;
            visited.add(stepId);

            const step = stepMap.get(stepId);
            if (!step) throw new Error(`Unknown step: ${stepId}`);

            for (const dep of step.dependsOn ?? []) {
                visit(dep);
            }

            order.push(step);
        };

        for (const step of steps) {
            visit(step.id);
        }

        return order;
    }

    /**
     * Check if all dependencies for a step have completed successfully.
     */
    private areDependenciesMet(
        step: WorkflowStep,
        results: Map<string, TaskResult>
    ): boolean {
        if (!step.dependsOn?.length) return true;

        return step.dependsOn.every((depId) => {
            const result = results.get(depId);
            return result?.status === 'success';
        });
    }

    // -------------------------------------------------------------------------
    // Retry
    // -------------------------------------------------------------------------

    /**
     * Execute a step with retry logic.
     */
    private async executeStepWithRetry(
        step: WorkflowStep,
        executionId: string,
        input: Record<string, unknown>,
        retry?: RetryConfig
    ): Promise<TaskResult> {
        const maxAttempts = retry?.maxAttempts ?? 1;
        const initialDelay = retry?.initialDelayMs ?? 1000;
        if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10 || !Number.isFinite(initialDelay) || initialDelay < 0 || initialDelay > 60_000) throw new Error('Invalid retry policy');
        const backoff = retry?.backoff ?? 'exponential';

        let lastResult: TaskResult | null = null;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            lastResult = await this.dispatcher.dispatch({
                executionId,
                stepId: step.id,
                worker: step.worker,
                action: step.action,
                input,
                timeoutMs: step.timeoutMs,
            });

            if (lastResult.status === 'success' || lastResult.error?.retryable !== true) {
                return lastResult;
            }

            // Don't retry on the last attempt
            if (attempt < maxAttempts - 1) {
                const delay = Math.min(60_000, this.calculateDelay(backoff, initialDelay, attempt));
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }

        return lastResult!;
    }

    /**
     * Calculate retry delay based on backoff strategy.
     */
    private calculateDelay(
        strategy: string,
        initialDelay: number,
        attempt: number
    ): number {
        switch (strategy) {
            case 'fixed':
                return initialDelay;
            case 'linear':
                return initialDelay * (attempt + 1);
            case 'exponential':
                return initialDelay * Math.pow(2, attempt);
            default:
                return initialDelay;
        }
    }

    // -------------------------------------------------------------------------
    // Template Resolution
    // -------------------------------------------------------------------------

    /**
     * Resolve `{{ }}` template expressions in step inputs.
     */
    private resolveTemplates(
        input: Record<string, unknown>,
        context: Record<string, unknown>
    ): Record<string, unknown> {
        return resolveGraphInput(input, context) as Record<string, unknown>;
    }

    /**
     * Resolve template expressions like `{{ trigger.pr_url }}`.
     */
    private resolveTemplateString(template: string, context: Record<string, unknown>): unknown {
        const match = template.match(/^\{\{\s*(.+?)\s*\}\}$/);
        if (match) {
            return this.resolvePath(match[1], context);
        }

        // Replace inline expressions
        return template.replace(/\{\{\s*(.+?)\s*\}\}/g, (_, path) => {
            const value = this.resolvePath(path, context);
            return String(value ?? '');
        });
    }

    /**
     * Resolve a dot-path expression against a context object.
     */
    private resolvePath(path: string, context: Record<string, unknown>): unknown {
        return resolveGraphInput({ $ref: path }, context);
    }

    /**
     * Build a step context map from results.
     */
    private buildStepContext(results: Map<string, TaskResult>): Record<string, unknown> {
        const ctx: Record<string, unknown> = {};
        for (const [stepId, result] of results) {
            ctx[stepId] = { output: result.output, status: result.status };
        }
        return ctx;
    }
}

// ---------------------------------------------------------------------------
// Interfaces — implemented by the runtime
// ---------------------------------------------------------------------------

export interface TaskDispatcher {
    dispatch(request: {
        executionId: string;
        stepId: string;
        worker: string;
        action?: string;
        input: Record<string, unknown>;
        timeoutMs?: number;
    }): Promise<TaskResult>;
}

export interface ConditionEvaluator {
    evaluate(expression: string, context: Record<string, unknown>): Promise<boolean>;
}

export interface ApprovalManager {
    requestApproval(request: {
        stepId: string;
        executionId: string;
        workflowId: string;
        approvers: string[];
        timeoutMinutes: number;
        escalation?: string;
    }): Promise<boolean>;
}
