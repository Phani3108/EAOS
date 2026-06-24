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

export type StepStatus = 'pending' | 'ready' | 'running' | 'complete' | 'failed' | 'skipped' | 'waiting_approval';

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
    status: 'running' | 'complete' | 'failed' | 'paused';
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

        const state = execution.stepStates.get(stepId);
        if (!state || state.status !== 'waiting_approval') throw new Error(`Step ${stepId} not waiting for approval`);

        state.status = 'complete';
        state.completedAt = new Date();
        state.output = result;

        // Find workflow and continue
        // In production: retrieve workflow from persistence
    }

    /**
     * Get execution status.
     */
    getExecution(executionId: string): WorkflowExecution | undefined {
        return this.executions.get(executionId);
    }

    // -------------------------------------------------------------------------
    // DAG processing
    // -------------------------------------------------------------------------

    private async processReadySteps(workflow: Workflow, execution: WorkflowExecution): Promise<void> {
        const readySteps = this.findReadySteps(workflow, execution);

        if (readySteps.length === 0) {
            // Check if all steps are complete
            const allDone = [...execution.stepStates.values()].every(
                s => s.status === 'complete' || s.status === 'skipped' || s.status === 'failed'
            );
            if (allDone) {
                execution.status = execution.errors.length > 0 ? 'failed' : 'complete';
                execution.completedAt = new Date();
            }
            return;
        }

        // Execute ready steps in parallel
        await Promise.all(readySteps.map(step => this.executeStep(workflow, execution, step)));
    }

    private findReadySteps(workflow: Workflow, execution: WorkflowExecution): WorkflowStep[] {
        return workflow.steps.filter(step => {
            const state = execution.stepStates.get(step.id);
            if (!state || state.status !== 'pending') return false;

            // Check all incoming edges are satisfied
            const incomingEdges = workflow.edges.filter(e => e.to === step.id);

            // If no incoming edges, this is a root step → ready
            if (incomingEdges.length === 0) return true;

            return incomingEdges.some(edge => {
                const fromState = execution.stepStates.get(edge.from);
                if (!fromState || fromState.status !== 'complete') return false;

                // Check edge condition if any
                if (edge.condition) {
                    return this.evaluateExpression(edge.condition, execution.variables);
                }
                return true;
            });
        });
    }

    private async executeStep(workflow: Workflow, execution: WorkflowExecution, step: WorkflowStep): Promise<void> {
        const state = execution.stepStates.get(step.id)!;
        state.status = 'running';
        state.startedAt = new Date();
        state.attempts++;

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

                await Promise.all(parallelSteps.map(s => this.executeStep(workflow, execution, s)));
                state.status = 'complete';
                state.completedAt = new Date();
            } else {
                // Execute via registered executor
                const executor = this.stepExecutors.get(step.config.type);
                if (!executor) throw new Error(`No executor for step type: ${step.config.type}`);

                const timeoutPromise = new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('Step timeout')), step.timeoutMs)
                );

                const result = await Promise.race([
                    executor.execute(step.config, execution.variables),
                    timeoutPromise,
                ]);

                state.output = result;
                state.status = 'complete';
                state.completedAt = new Date();

                // Store output in variables for downstream steps
                execution.variables[`${step.id}_output`] = result;
            }

            // Create checkpoint
            execution.checkpoints.push({
                stepId: step.id,
                state: { ...execution.variables },
                timestamp: new Date(),
            });

            // Continue to next steps
            await this.processReadySteps(workflow, execution);

        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            execution.errors.push({ stepId: step.id, error: errMsg, timestamp: new Date(), attempt: state.attempts });

            if (step.onError === 'retry' && state.attempts < step.retry.maxAttempts) {
                state.status = 'pending';
                await new Promise(r => setTimeout(r, step.retry.backoffMs * state.attempts));
                await this.executeStep(workflow, execution, step);
            } else if (step.onError === 'skip') {
                state.status = 'skipped';
                state.completedAt = new Date();
                await this.processReadySteps(workflow, execution);
            } else if (step.onError === 'fallback' && step.fallbackStepId) {
                const fallback = workflow.steps.find(s => s.id === step.fallbackStepId);
                if (fallback) {
                    state.status = 'failed';
                    await this.executeStep(workflow, execution, fallback);
                }
            } else {
                state.status = 'failed';
                state.error = errMsg;
                execution.status = 'failed';
            }
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private validateDAG(workflow: Workflow): void {
        const visited = new Set<string>();
        const stack = new Set<string>();

        const hasCycle = (stepId: string): boolean => {
            if (stack.has(stepId)) return true;
            if (visited.has(stepId)) return false;
            visited.add(stepId);
            stack.add(stepId);

            const outgoing = workflow.edges.filter(e => e.from === stepId);
            for (const edge of outgoing) {
                if (hasCycle(edge.to)) return true;
            }

            stack.delete(stepId);
            return false;
        };

        for (const step of workflow.steps) {
            if (hasCycle(step.id)) {
                throw new Error(`Workflow ${workflow.id} contains a cycle at step ${step.id}`);
            }
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
function evalSafeExpression(expr: string, vars: Record<string, unknown>): unknown {
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
    execute(config: StepConfig, variables: Record<string, unknown>): Promise<unknown>;
}
