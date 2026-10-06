/**
 * Workflow Engine — DAG-based workflow orchestration
 *
 * Workflows are directed acyclic graphs where each node is a step
 * (skill execution, tool call, approval gate, condition, or sub-workflow).
 * The engine handles: execution ordering, parallel branches, condition gates,
 * error handling, retries, checkpointing, and live progress streaming.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import { planGraph, validateGraph } from '@agentos/sdk';

export type StepStatus = 'pending' | 'ready' | 'running' | 'complete' | 'failed' | 'skipped' | 'waiting_approval' | 'rejected' | 'cancelled' | 'inconclusive' | 'simulated' | 'unsupported';

export interface Workflow {
    id: string;
    name: string;
    description: string;
    version: string;
    steps: WorkflowStep[];
    edges: WorkflowEdge[];
    variables: Record<string, unknown>;
    triggers: WorkflowTrigger[];
    metadata: { createdBy: string; createdAt: Date; domain: string };
    /** Template metadata — present when this workflow is a reusable template */
    template?: WorkflowTemplate;
}

/** Metadata for workflows that act as reusable templates users can fork & customize */
export interface WorkflowTemplate {
    /** Persona this template belongs to */
    persona: 'engineering' | 'marketing' | 'product' | 'leadership' | 'learning';
    /** Visual grouping */
    category: string;
    /** Icon for UI display */
    icon: string;
    /** Skill IDs this workflow composes */
    composedSkillIds: string[];
    /** Prompt IDs linked to this workflow */
    promptIds: string[];
    /** Whether users can fork / customize before running */
    forkable: boolean;
    /** If forked, the original template ID */
    forkedFrom?: string;
    /** Usage & rating */
    usageCount: number;
    rating: number;
}

export interface WorkflowStep {
    id: string;
    name: string;
    type: 'skill' | 'tool' | 'approval' | 'condition' | 'parallel' | 'sub_workflow' | 'transform';

    /** What to execute */
    config: StepConfig;

    /** Retry policy */
    retry: { maxAttempts: number; backoffMs: number };

    /** Timeout */
    timeoutMs: number;

    /** Error handling */
    onError: 'fail' | 'skip' | 'retry' | 'fallback';
    fallbackStepId?: string;
}

export type StepConfig =
    | { type: 'skill'; skillId: string; inputs: Record<string, unknown> }
    | { type: 'tool'; toolId: string; params: Record<string, unknown> }
    | { type: 'approval'; action: string; sensitivity: string }
    | { type: 'condition'; expression: string; trueEdge: string; falseEdge: string }
    | { type: 'parallel'; stepIds: string[] }
    | { type: 'sub_workflow'; workflowId: string; inputs: Record<string, unknown> }
    | { type: 'transform'; expression: string };

export interface WorkflowEdge {
    from: string;
    to: string;
    condition?: string; // expression that must be true
}

export interface WorkflowTrigger {
    type: 'manual' | 'event' | 'schedule' | 'webhook';
    config: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Execution state
// ---------------------------------------------------------------------------

export interface WorkflowExecution {
    id: string;
    workflowId: string;
    workflowVersion?: string;
    workflowSignature?: string;
    status: 'queued' | 'running' | 'complete' | 'simulated' | 'failed' | 'paused' | 'rejected' | 'cancelled' | 'inconclusive' | 'unsupported';
    startedAt: Date;
    completedAt?: Date;
    stepStates: Map<string, StepState>;
    variables: Record<string, unknown>;
    errors: WorkflowError[];
    checkpoints: Checkpoint[];
}

export interface StepState {
    stepId: string;
    status: StepStatus;
    startedAt?: Date;
    completedAt?: Date;
    attempts: number;
    output?: unknown;
    error?: string;
}

interface WorkflowError { stepId: string; error: string; timestamp: Date; attempt: number }
interface Checkpoint { stepId: string; state: Record<string, unknown>; timestamp: Date }

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class WorkflowEngine {
    private executions: Map<string, WorkflowExecution> = new Map();
    private stepExecutors: Map<string, StepExecutor> = new Map();
    private workflows = new Map<string, Workflow>();
    private controllers = new Map<string, AbortController>();
    private processing = new Map<string, Promise<void>>();
    private checkpointTails = new Map<string, Promise<void>>();

    private checkpoint(execution: WorkflowExecution): Promise<void> {
        const next = (this.checkpointTails.get(execution.id) ?? Promise.resolve()).then(async () => { await this.options.checkpoint?.(structuredClone(execution)); });
        this.checkpointTails.set(execution.id, next);
        return next;
    }

    constructor(private readonly options: { maxConcurrency?: number; checkpoint?: (execution: WorkflowExecution) => Promise<void> } = {}) {
        if (options.maxConcurrency !== undefined && (!Number.isInteger(options.maxConcurrency) || options.maxConcurrency < 1 || options.maxConcurrency > 100)) throw new Error('Invalid workflow concurrency');
    }

    /**
     * Register a step executor for a step type.
     */
    registerExecutor(type: string, executor: StepExecutor): void {
        this.stepExecutors.set(type, executor);
    }

    /**
     * Start a workflow execution.
     */
    async execute(workflow: Workflow, initialVars?: Record<string, unknown>): Promise<WorkflowExecution> {
        // Validate DAG
        this.validateDAG(workflow);

        const execution: WorkflowExecution = {
            id: `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            workflowId: workflow.id,
            workflowVersion: workflow.version,
            workflowSignature: JSON.stringify({ steps: workflow.steps, edges: workflow.edges, variables: workflow.variables }),
            status: 'running',
            startedAt: new Date(),
            stepStates: new Map(),
            variables: { ...workflow.variables, ...initialVars },
            errors: [],
            checkpoints: [],
        };

        // Initialize all step states
        for (const step of workflow.steps) {
            execution.stepStates.set(step.id, {
                stepId: step.id,
                status: 'pending',
                attempts: 0,
            });
        }

        this.executions.set(execution.id, execution);
        this.workflows.set(execution.id, structuredClone(workflow));
        this.controllers.set(execution.id, new AbortController());
        await this.checkpoint(execution);

        // Find and execute ready steps (no dependencies)
        await this.processReadySteps(workflow, execution);

        return execution;
    }

    /**
     * Resume a paused execution (e.g., after approval).
     */
    async resume(executionId: string, stepId: string, result: unknown): Promise<void> {
        const execution = this.executions.get(executionId);
        if (!execution) throw new Error(`Execution ${executionId} not found`);

        await this.processing.get(executionId);
        const state = execution.stepStates.get(stepId);
        if (execution.status !== 'paused' || !state || state.status !== 'waiting_approval') throw new Error(`Step ${stepId} not waiting for approval`);
        const approved = typeof result === 'boolean' ? result : (result as { approved?: unknown })?.approved;
        if (typeof approved !== 'boolean') throw new Error('Approval requires an explicit boolean decision');
        state.status = approved ? 'complete' : 'rejected';
        state.completedAt = new Date();
        state.output = result;
        execution.variables[`${stepId}_output`] = result;
        execution.status = approved ? 'running' : 'rejected';
        if (!approved) execution.completedAt = new Date();
        await this.checkpoint(execution);

        // Find workflow and continue
        // In production: retrieve workflow from persistence
        const workflow = this.workflows.get(executionId);
        if (!workflow) throw new Error('Workflow definition is unavailable');
        if (approved) await this.processReadySteps(workflow, execution);
    }

    /**
     * Get execution status.
     */
    getExecution(executionId: string): WorkflowExecution | undefined {
        return this.executions.get(executionId);
    }

    async restore(workflow: Workflow, snapshot: WorkflowExecution): Promise<WorkflowExecution> {
        this.validateDAG(workflow);
        if (snapshot.workflowId !== workflow.id || snapshot.workflowVersion !== workflow.version || snapshot.workflowSignature !== JSON.stringify({ steps: workflow.steps, edges: workflow.edges, variables: workflow.variables }) || snapshot.stepStates.size !== workflow.steps.length || workflow.steps.some(step => !snapshot.stepStates.has(step.id))) throw new Error('Checkpoint does not match the workflow definition');
        const execution = structuredClone(snapshot);
        for (const step of workflow.steps) {
            const state = execution.stepStates.get(step.id)!;
            if (state.status === 'running' && step.type === 'tool') { state.status = 'inconclusive'; execution.status = 'inconclusive'; state.error = 'Interrupted effect requires reconciliation'; }
            else if (state.status === 'running' || state.status === 'ready') state.status = 'pending';
        }
        this.workflows.set(execution.id, structuredClone(workflow));
        this.executions.set(execution.id, execution);
        this.controllers.set(execution.id, new AbortController());
        await this.checkpoint(execution);
        if (execution.status === 'running') await this.processReadySteps(workflow, execution);
        return execution;
    }

    async cancel(executionId: string): Promise<void> {
        const execution = this.executions.get(executionId);
        if (!execution || !['running','paused'].includes(execution.status)) return;
        execution.status = 'cancelled';
        execution.completedAt = new Date();
        this.controllers.get(executionId)?.abort(new Error('Workflow cancelled'));
        for (const state of execution.stepStates.values()) if (['pending','ready','running','waiting_approval'].includes(state.status)) state.status = 'cancelled';
        await this.checkpoint(execution);
    }

    // -------------------------------------------------------------------------
    // DAG processing
    // -------------------------------------------------------------------------

    private async processReadySteps(workflow: Workflow, execution: WorkflowExecution): Promise<void> {
        const active = this.processing.get(execution.id);
        if (active) return active;
        const work = this.drainReadySteps(workflow, execution);
        this.processing.set(execution.id, work);
        try { await work; } finally { this.processing.delete(execution.id); }
    }

    private async drainReadySteps(workflow: Workflow, execution: WorkflowExecution): Promise<void> {
        while (execution.status === 'running') {
            const readySteps = this.findReadySteps(workflow, execution).slice(0, this.options.maxConcurrency ?? 4);
            const states = [...execution.stepStates.values()];
            if (states.some(state => ['failed','rejected','cancelled','inconclusive'].includes(state.status))) {
                execution.status = states.some(state => state.status === 'inconclusive') ? 'inconclusive' : 'failed';
                execution.completedAt = new Date();
                await this.checkpoint(execution);
                return;
            }
            if (!readySteps.length) {
                // Check if all steps are complete
                const allDone = states.every(state => state.status === 'complete' || state.status === 'skipped');
                execution.status = allDone ? 'complete' : states.some(state => state.status === 'waiting_approval') ? 'paused' : 'failed';
                if (execution.status !== 'paused') execution.completedAt = new Date();
                await this.checkpoint(execution);
                return;
            }
            for (const step of readySteps) execution.stepStates.get(step.id)!.status = 'ready';
            await this.checkpoint(execution);
            // Execute ready steps in parallel
            await Promise.all(readySteps.map(step => this.executeStep(workflow, execution, step)));
        }
        await this.checkpoint(execution);
    }

    private findReadySteps(workflow: Workflow, execution: WorkflowExecution): WorkflowStep[] {
        // Check all incoming edges are satisfied
        const edges = workflow.edges.map(edge => {
            const from = workflow.steps.find(step => step.id === edge.from)!;
            const state = execution.stepStates.get(edge.from)!;
            let enabled = true;
            if (state.status === 'complete') {
                if (from.config.type === 'condition') enabled = edge.to === (state.output ? from.config.trueEdge : from.config.falseEdge);
                // Check edge condition if any
                if (edge.condition) enabled = enabled && this.evaluateExpression(edge.condition, execution.variables);
            }
            return { ...edge, enabled };
        });
        // If no incoming edges, this is a root step → ready
        const plan = planGraph(workflow.steps.map(step => ({ id: step.id, status: execution.stepStates.get(step.id)!.status })), edges);
        for (const id of plan.skipped) Object.assign(execution.stepStates.get(id)!, { status: 'skipped', completedAt: new Date() });
        for (const id of plan.blocked) Object.assign(execution.stepStates.get(id)!, { status: 'failed', error: 'Required dependency failed', completedAt: new Date() });
        return plan.ready.map(id => workflow.steps.find(step => step.id === id)!);
    }

    private async executeStep(workflow: Workflow, execution: WorkflowExecution, step: WorkflowStep): Promise<void> {
        const state = execution.stepStates.get(step.id)!;
        if (this.controllers.get(execution.id)?.signal.aborted || !['ready','pending'].includes(state.status)) return;
        state.status = 'running';
        state.startedAt = new Date();
        state.attempts++;
        await this.checkpoint(execution);

        try {
            // Handle special step types
            if (step.config.type === 'condition') {
                const result = this.evaluateExpression(step.config.expression, execution.variables);
                state.output = result;
                state.status = 'complete';
                state.completedAt = new Date();
            } else if (step.config.type === 'approval') {
                state.status = 'waiting_approval';
                execution.status = 'paused';
                return;
            } else if (step.config.type === 'parallel') {
                // Execute parallel sub-steps
                const parallelSteps = step.config.stepIds
                    .map(id => workflow.steps.find(s => s.id === id))
                    .filter((s): s is WorkflowStep => s !== undefined);

                if (parallelSteps.some(child => !['complete','skipped'].includes(execution.stepStates.get(child.id)!.status))) throw new Error('Parallel join has unresolved work');
                state.output = Object.fromEntries(parallelSteps.filter(child => execution.stepStates.get(child.id)!.status === 'complete').map(child => [child.id, execution.stepStates.get(child.id)!.output]));
                state.status = 'complete';
                state.completedAt = new Date();
            } else {
                // Execute via registered executor
                const executor = this.stepExecutors.get(step.config.type);
                if (!executor) throw new Error(`No executor for step type: ${step.config.type}`);

                const result = await this.invokeExecutor(executor, step, execution, state.attempts);
                if (this.controllers.get(execution.id)?.signal.aborted) return;
                const outcome = result && typeof result === 'object' ? (result as { status?: string; error?: unknown }).status : undefined;
                if (outcome && ['failed','failure','error','unsupported','inconclusive'].includes(outcome)) throw Object.assign(new Error(`Executor reported ${outcome}`), { retryable: false, inconclusive: outcome === 'inconclusive' });
                if (outcome === 'waiting_approval') { state.status = 'waiting_approval'; execution.status = 'paused'; return; }

                state.output = result;
                state.status = 'complete';
                state.completedAt = new Date();

                // Store output in variables for downstream steps
                execution.variables[`${step.id}_output`] = result;
            }

            execution.variables[`${step.id}_output`] = state.output;
            // Create checkpoint
            execution.checkpoints.push({
                stepId: step.id,
                state: { ...execution.variables },
                timestamp: new Date(),
            });

            // Continue to next steps
            await this.checkpoint(execution);

        } catch (error) {
            if (this.controllers.get(execution.id)?.signal.aborted) return;
            const errMsg = error instanceof Error ? error.message : String(error);
            execution.errors.push({ stepId: step.id, error: errMsg, timestamp: new Date(), attempt: state.attempts });

            if (step.onError === 'retry' && state.attempts < step.retry.maxAttempts && (error as { retryable?: boolean })?.retryable !== false && !(error as { inconclusive?: boolean })?.inconclusive) {
                state.status = 'pending';
                await new Promise(r => setTimeout(r, step.retry.backoffMs * state.attempts));
                await this.executeStep(workflow, execution, step);
            } else if (step.onError === 'skip') {
                state.status = 'skipped';
                state.completedAt = new Date();
                await this.checkpoint(execution);
            } else if (step.onError === 'fallback' && step.fallbackStepId) {
                const fallback = workflow.steps.find(s => s.id === step.fallbackStepId);
                if (fallback) {
                    state.status = 'failed';
                    await this.executeStep(workflow, execution, fallback);
                }
            } else {
                state.status = (error as { inconclusive?: boolean })?.inconclusive ? 'inconclusive' : 'failed';
                state.error = errMsg;
                state.completedAt = new Date();
                execution.status = state.status;
                execution.completedAt = new Date();
            }
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private async invokeExecutor(executor: StepExecutor, step: WorkflowStep, execution: WorkflowExecution, attempt: number): Promise<unknown> {
        const controller = new AbortController();
        const parent = this.controllers.get(execution.id)!.signal;
        parent.throwIfAborted();
        const cancel = () => controller.abort(parent.reason ?? new Error('Workflow cancelled'));
        parent.addEventListener('abort', cancel, { once: true });
        if (parent.aborted) cancel();
        let rejectAbort!: (reason: unknown) => void;
        const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
        const onAbort = () => rejectAbort(controller.signal.reason);
        controller.signal.addEventListener('abort', onAbort, { once: true });
        if (controller.signal.aborted) onAbort();
        const timer = setTimeout(() => controller.abort(Object.assign(new Error('Step timeout'), { retryable: step.type !== 'tool', inconclusive: step.type === 'tool' })), step.timeoutMs);
        try {
            return await Promise.race([executor.execute(step.config, structuredClone(execution.variables), { signal: controller.signal, stepId: step.id, attempt }), aborted]);
        } finally {
            clearTimeout(timer);
            parent.removeEventListener('abort', cancel);
            controller.signal.removeEventListener('abort', onAbort);
        }
    }

    private validateDAG(workflow: Workflow): void {
        validateGraph(workflow.steps, workflow.edges);
        for (const step of workflow.steps) {
            if (step.type !== step.config.type || !Number.isInteger(step.retry.maxAttempts) || step.retry.maxAttempts < 1 || step.retry.maxAttempts > 10 || !Number.isFinite(step.retry.backoffMs) || step.retry.backoffMs < 0 || step.retry.backoffMs > 60_000 || !Number.isFinite(step.timeoutMs) || step.timeoutMs <= 0 || step.timeoutMs > 3_600_000) throw new Error('Invalid step execution policy');
            if (step.onError === 'fallback') throw new Error('Fallback must be represented by explicit graph branches');
            if (step.config.type === 'condition') {
                const config = step.config;
                if (!workflow.edges.some(edge => edge.from === step.id && edge.to === config.trueEdge) || !workflow.edges.some(edge => edge.from === step.id && edge.to === config.falseEdge)) throw new Error('Condition references an unknown branch');
                if (config.expression.length > 4000) throw new Error('Condition is too large');
                evalSafeExpression(config.expression, {});
            }
            if (step.config.type === 'parallel' && (!step.config.stepIds.length || step.config.stepIds.some(id => !workflow.edges.some(edge => edge.from === id && edge.to === step.id)))) throw new Error('Parallel joins require explicit dependency edges');
        }
        for (const edge of workflow.edges) if (edge.condition) {
            if (edge.condition.length > 4000) throw new Error('Edge condition is too large');
            evalSafeExpression(edge.condition, {});
        }
    }

    private evaluateExpression(expr: string, vars: Record<string, unknown>): boolean {
        // Safe expression evaluator for workflow conditions.
        //
        // Replaces the previous `new Function(...)` (a code-injection vector)
        // with a small tokenizer + recursive-descent parser. NO Function/eval.
        //
        // Supported grammar (anything outside it FAILS CLOSED → returns false):
        //   - variable references over `vars`            e.g. budget_shift_percent
        //   - literals: number, 'string' / "string", true, false, null
        //   - comparisons:  ===  ==  !==  !=  >  <  >=  <=
        //   - logical:      &&  ||  !
        //   - arithmetic:   +  -  *  /  (and unary -)
        //   - parentheses for grouping
        //
        // The boolean result mirrors the old `Boolean(fn(...))` coercion: a
        // bare variable reference (e.g. "performance_below_threshold") yields
        // the truthiness of that variable's value.
        try {
            const value = evalSafeExpression(expr, vars);
            return Boolean(value);
        } catch {
            // Fail closed: unparseable / out-of-grammar expressions are false.
            return false;
        }
    }
}

// ---------------------------------------------------------------------------
// Safe expression evaluator (no Function / eval)
// ---------------------------------------------------------------------------

type TokenType =
    | 'number' | 'string' | 'ident'
    | 'op' | 'lparen' | 'rparen';

interface Token { type: TokenType; value: string }

/** Tokenize an expression. Throws on any unrecognized character (fail closed). */
function tokenizeExpression(input: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    const n = input.length;

    const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c);
    const isIdentPart = (c: string) => /[A-Za-z0-9_$.]/.test(c);
    const isDigit = (c: string) => /[0-9]/.test(c);

    while (i < n) {
        const c = input[i];

        // Whitespace
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }

        // String literal ('...' or "...")
        if (c === '"' || c === "'") {
            const quote = c;
            let str = '';
            i++;
            while (i < n && input[i] !== quote) {
                if (input[i] === '\\' && i + 1 < n) {
                    // Minimal escape handling for quote / backslash.
                    const next = input[i + 1];
                    if (next === quote || next === '\\') { str += next; i += 2; continue; }
                }
                str += input[i];
                i++;
            }
            if (i >= n) throw new Error('Unterminated string literal');
            i++; // closing quote
            tokens.push({ type: 'string', value: str });
            continue;
        }

        // Number literal (integer or decimal)
        if (isDigit(c) || (c === '.' && isDigit(input[i + 1] ?? ''))) {
            let num = '';
            while (i < n && (isDigit(input[i]) || input[i] === '.')) { num += input[i]; i++; }
            if ((num.match(/\./g) ?? []).length > 1) throw new Error(`Invalid number: ${num}`);
            tokens.push({ type: 'number', value: num });
            continue;
        }

        // Identifier / keyword (variable, true, false, null)
        if (isIdentStart(c)) {
            let id = '';
            while (i < n && isIdentPart(input[i])) { id += input[i]; i++; }
            tokens.push({ type: 'ident', value: id });
            continue;
        }

        // Parentheses
        if (c === '(') { tokens.push({ type: 'lparen', value: '(' }); i++; continue; }
        if (c === ')') { tokens.push({ type: 'rparen', value: ')' }); i++; continue; }

        // Multi-char operators (longest match first)
        const three = input.slice(i, i + 3);
        if (three === '===' || three === '!==') { tokens.push({ type: 'op', value: three }); i += 3; continue; }

        const two = input.slice(i, i + 2);
        if (two === '==' || two === '!=' || two === '>=' || two === '<=' || two === '&&' || two === '||') {
            tokens.push({ type: 'op', value: two }); i += 2; continue;
        }

        if (c === '>' || c === '<' || c === '+' || c === '-' || c === '*' || c === '/' || c === '!') {
            tokens.push({ type: 'op', value: c }); i++; continue;
        }

        throw new Error(`Unexpected character: ${c}`);
    }

    return tokens;
}

/**
 * Recursive-descent parser + evaluator over the token stream.
 * Precedence (low → high): || , && , equality , comparison , additive ,
 * multiplicative , unary , primary.
 */
export function evalSafeExpression(expr: string, vars: Record<string, unknown>): unknown {
    const tokens = tokenizeExpression(expr);
    let pos = 0;

    const peek = (): Token | undefined => tokens[pos];
    const next = (): Token => {
        const t = tokens[pos];
        if (!t) throw new Error('Unexpected end of expression');
        pos++;
        return t;
    };
    const eatOp = (value: string): boolean => {
        const t = peek();
        if (t && t.type === 'op' && t.value === value) { pos++; return true; }
        return false;
    };

    // primary := number | string | ident-literal | variable | '(' expr ')' | unary
    function parsePrimary(): unknown {
        const t = peek();
        if (!t) throw new Error('Unexpected end of expression');

        if (t.type === 'op' && (t.value === '!' || t.value === '-')) {
            next();
            const operand = parsePrimary();
            if (t.value === '!') return !operand;
            return -toNumber(operand);
        }

        if (t.type === 'lparen') {
            next();
            const val = parseOr();
            const close = next();
            if (close.type !== 'rparen') throw new Error('Expected )');
            return val;
        }

        if (t.type === 'number') { next(); return Number(t.value); }
        if (t.type === 'string') { next(); return t.value; }

        if (t.type === 'ident') {
            next();
            if (t.value === 'true') return true;
            if (t.value === 'false') return false;
            if (t.value === 'null') return null;
            if (t.value === 'undefined') return undefined;
            return resolveVar(t.value, vars);
        }

        throw new Error(`Unexpected token: ${t.value}`);
    }

    // multiplicative := primary (('*' | '/') primary)*
    function parseMul(): unknown {
        let left = parsePrimary();
        for (;;) {
            if (eatOp('*')) left = toNumber(left) * toNumber(parsePrimary());
            else if (eatOp('/')) left = toNumber(left) / toNumber(parsePrimary());
            else break;
        }
        return left;
    }

    // additive := multiplicative (('+' | '-') multiplicative)*
    function parseAdd(): unknown {
        let left = parseMul();
        for (;;) {
            if (eatOp('+')) {
                const right = parseMul();
                // '+' is arithmetic-only in this grammar (string concat is not
                // a supported workflow operation); coerce to number.
                left = toNumber(left) + toNumber(right);
            } else if (eatOp('-')) {
                left = toNumber(left) - toNumber(parseMul());
            } else break;
        }
        return left;
    }

    // comparison := additive (('>' | '<' | '>=' | '<=') additive)*
    function parseComparison(): unknown {
        let left = parseAdd();
        for (;;) {
            const t = peek();
            if (t && t.type === 'op' && (t.value === '>' || t.value === '<' || t.value === '>=' || t.value === '<=')) {
                next();
                const right = parseAdd();
                const l = toNumber(left), r = toNumber(right);
                if (t.value === '>') left = l > r;
                else if (t.value === '<') left = l < r;
                else if (t.value === '>=') left = l >= r;
                else left = l <= r;
            } else break;
        }
        return left;
    }

    // equality := comparison (('===' | '==' | '!==' | '!=') comparison)*
    function parseEquality(): unknown {
        let left = parseComparison();
        for (;;) {
            const t = peek();
            if (t && t.type === 'op' && (t.value === '===' || t.value === '==' || t.value === '!==' || t.value === '!=')) {
                next();
                const right = parseComparison();
                // Use strict comparison semantics for both == and === (and the
                // negated forms) to avoid surprising coercions; this matches the
                // intent of the simple equality checks workflows author.
                const eq = left === right;
                left = (t.value === '===' || t.value === '==') ? eq : !eq;
            } else break;
        }
        return left;
    }

    // and := equality ('&&' equality)*
    function parseAnd(): unknown {
        let left = parseEquality();
        while (eatOp('&&')) {
            const right = parseEquality();
            left = Boolean(left) && Boolean(right);
        }
        return left;
    }

    // or := and ('||' and)*
    function parseOr(): unknown {
        let left = parseAnd();
        while (eatOp('||')) {
            const right = parseAnd();
            left = Boolean(left) || Boolean(right);
        }
        return left;
    }

    const result = parseOr();
    if (pos !== tokens.length) {
        // Trailing tokens → not a valid single expression. Fail closed.
        throw new Error('Unexpected trailing tokens in expression');
    }
    return result;
}

/** Coerce a value to a number for arithmetic/comparison; NaN propagates. */
function toNumber(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'string' && value.trim() !== '') return Number(value);
    if (value === null) return 0;
    return NaN;
}

/**
 * Resolve a (possibly dotted) variable reference over `vars`.
 * Unknown variables resolve to `undefined` (matching the previous evaluator,
 * where a referenced-but-undefined name would be `undefined`). Only own
 * enumerable properties are traversed — no prototype walking.
 */
function resolveVar(path: string, vars: Record<string, unknown>): unknown {
    const segments = path.split('.');
    let current: unknown = vars;
    for (const seg of segments) {
        if (current === null || current === undefined) return undefined;
        if (typeof current !== 'object') return undefined;
        if (!Object.prototype.hasOwnProperty.call(current, seg)) return undefined;
        current = (current as Record<string, unknown>)[seg];
    }
    return current;
}

// ---------------------------------------------------------------------------
// Step executor interface
// ---------------------------------------------------------------------------

export interface StepExecutor {
    execute(config: StepConfig, variables: Record<string, unknown>, context?: { signal: AbortSignal; stepId: string; attempt: number }): Promise<unknown>;
}
