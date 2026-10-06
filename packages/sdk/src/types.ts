/**
 * @agentos/sdk — Worker SDK
 *
 * Core types shared across the AgentOS SDK.
 */

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------

export type TaskStatus =
    | 'pending'
    | 'policy_check'
    | 'awaiting_approval'
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'retrying'
    | 'denied';

export interface Task<TInput = unknown, TOutput = unknown> {
    id: string;
    workflowId?: string;
    executionId?: string;
    type: string;
    input: TInput;
    output?: TOutput;
    status: TaskStatus;
    priority: TaskPriority;
    assignedWorker?: string;
    parentTaskId?: string;
    retryCount: number;
    maxRetries: number;
    createdAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    timeoutMs: number;
    metadata: Record<string, unknown>;
}

export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

export interface TaskResult<T = unknown> {
    taskId: string;
    status: 'success' | 'failure';
    output?: T;
    error?: TaskError;
    durationMs: number;
    tokensUsed: number;
    toolCallCount: number;
}

export interface TaskError {
    code: string;
    message: string;
    stack?: string;
    retryable: boolean;
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export interface WorkerConfig {
    id: string;
    name: string;
    cluster: string;
    model: string;
    tools: string[];
    policies: string[];
    sandbox: SandboxConfig;
    contextSources: ContextSourceConfig[];
}

export type WorkerStatus =
    | 'initializing'
    | 'ready'
    | 'executing'
    | 'draining'
    | 'failed'
    | 'terminated';

export interface SandboxConfig {
    maxTokens: number;
    maxToolCalls: number;
    timeoutMs: number;
    maxMemoryMb: number;
    maxCpuPercent: number;
}

export interface ContextSourceConfig {
    type: 'vector' | 'episode';
    namespace?: string;
    filter?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export interface ToolDefinition {
    name: string;
    description: string;
    category: string;
    input: Record<string, ToolParameter>;
    output: Record<string, ToolParameter>;
    auth?: ToolAuth;
    timeoutMs: number;
    idempotent: boolean;
    sideEffects: boolean;
}

export interface ToolParameter {
    type: string;
    description: string;
    required?: boolean;
    default?: unknown;
    enum?: unknown[];
}

export interface ToolAuth {
    type: 'none' | 'api_key' | 'oauth2' | 'jwt' | 'basic';
    secretRef?: string;
    scopes?: string[];
}

export interface ToolInvocation {
    toolName: string;
    args: Record<string, unknown>;
    timeout?: number;
}

export interface ToolResult<T = unknown> {
    toolName: string;
    status: 'success' | 'failure';
    data?: T;
    error?: string;
    durationMs: number;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface EventEnvelope<T = unknown> {
    id: string;
    type: string;
    source: string;
    subject?: string;
    time: Date;
    specVersion: '1.0';
    dataContentType: 'application/json';
    data: T;
    traceId: string;
    tenantId: string;
    executionId?: string;
    idempotencyKey: string;
    metadata: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export interface VectorDocument {
    id: string;
    namespace: string;
    content: string;
    embedding?: number[];
    metadata: Record<string, unknown>;
    source: {
        type: 'document' | 'code' | 'conversation' | 'episode';
        uri: string;
        timestamp: Date;
    };
    ttl?: Date;
}

export interface Episode {
    id: string;
    executionId: string;
    workerId: string;
    taskId: string;
    sequence: number;
    action: {
        type: 'llm_call' | 'tool_invocation' | 'delegation' | 'decision';
        input: unknown;
        model?: string;
        toolName?: string;
    };
    result: {
        output: unknown;
        status: 'success' | 'failure';
        durationMs: number;
        tokensUsed?: number;
    };
    context: Record<string, unknown>;
    timestamp: Date;
}

export interface MemoryQuery {
    namespace?: string;
    query?: string;
    topK?: number;
    filter?: Record<string, unknown>;
    minSimilarity?: number;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export type PolicyScopeType = 'global' | 'cluster' | 'worker' | 'tool' | 'workflow';

export interface PolicyScope {
    type: PolicyScopeType;
    cluster?: string;
    worker?: string;
    tool?: string;
    workflow?: string;
}

export type PolicyActionType = 'allow' | 'deny' | 'require_approval' | 'rate_limit' | 'transform';

export interface PolicyAction {
    type: PolicyActionType;
    reason?: string;
    approvers?: string[];
    timeoutMinutes?: number;
    escalation?: string;
    maxPerMinute?: number;
    transformer?: string;
}

export interface Policy {
    id: string;
    name: string;
    description: string;
    scope: PolicyScope;
    priority: number;
    condition: PolicyCondition;
    action: PolicyAction;
    enabled: boolean;
    metadata: {
        author: string;
        createdAt: Date;
        version: number;
    };
}

export type PolicyCondition =
    | FieldCondition
    | AllCondition
    | AnyCondition
    | NotCondition;

export interface FieldCondition {
    field: string;
    equals?: unknown;
    notEquals?: unknown;
    in?: unknown[];
    notIn?: unknown[];
    greaterThan?: number;
    lessThan?: number;
    matches?: string;
    exists?: boolean;
}

export interface AllCondition {
    all: PolicyCondition[];
}

export interface AnyCondition {
    any: PolicyCondition[];
}

export interface NotCondition {
    not: PolicyCondition;
}

export interface PolicyEvaluationResult {
    decision: 'allow' | 'deny' | 'escalate';
    matchedPolicies: Array<{
        policyId: string;
        policyName: string;
        action: PolicyAction;
    }>;
    reason?: string;
}

// ---------------------------------------------------------------------------
// Delegation
// ---------------------------------------------------------------------------

export interface DelegationRequest {
    id: string;
    sourceWorker: string;
    targetWorker: string;
    taskType: string;
    input: unknown;
    priority: TaskPriority;
    timeout: number;
    parentTaskId: string;
    parentExecutionId: string;
    contextSnapshot: Record<string, unknown>;
}

export interface DelegationResponse {
    requestId: string;
    status: 'completed' | 'failed' | 'timeout';
    output?: unknown;
    error?: string;
    durationMs: number;
    delegateWorkerId: string;
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export interface WorkflowDefinition {
    name: string;
    description: string;
    version: string;
    trigger: WorkflowTrigger;
    timeoutMs?: number;
    priority: TaskPriority;
    steps: WorkflowStep[];
    retry?: RetryConfig;
    onFailure?: WorkflowHook[];
    onSuccess?: WorkflowHook[];
}

export interface WorkflowTrigger {
    event: string;
    filter?: string;
}

export interface WorkflowStep {
    id: string;
    name: string;
    worker: string;
    action?: string;
    dependsOn?: string[];
    condition?: string;
    input?: Record<string, unknown>;
    output?: string[];
    approval?: ApprovalConfig;
    retry?: RetryConfig;
    timeoutMs?: number;
}

export interface ApprovalConfig {
    required: boolean;
    approvers: string[];
    timeoutMinutes: number;
    escalation?: string;
}

export interface RetryConfig {
    maxAttempts: number;
    backoff: 'fixed' | 'linear' | 'exponential';
    initialDelayMs: number;
}

export interface WorkflowHook {
    action: 'notify' | 'escalate' | 'webhook';
    channel?: string;
    target: string;
    message?: string;
}

export interface WorkflowExecution {
    id: string;
    workflowId: string;
    status: 'queued' | 'running' | 'paused' | 'completed' | 'simulated' | 'failed' | 'rejected' | 'inconclusive' | 'unsupported' | 'cancelled';
    mode?: 'live' | 'simulation';
    stepStates?: Map<string, { status: string; childRunId?: string }>;
    trigger: unknown;
    stepResults: Map<string, TaskResult>;
    startedAt: Date;
    completedAt?: Date;
    error?: string;
}
