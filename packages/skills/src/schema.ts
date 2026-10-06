/**
 * EOS Skills Schema — First-Class Runtime Objects
 *
 * Skills are NOT prompts. They are organizational intelligence assets
 * with schemas, versions, lifecycles, permissions, and evaluation scores.
 *
 * A skill = intent + context requirements + tools + output schema + guardrails
 */

// ---------------------------------------------------------------------------
// Core Skill Schema
// ---------------------------------------------------------------------------

export interface Skill {
    /** Unique identifier: domain.category.name */
    id: string;
    /** Semantic version */
    version: string;
    /** Human-readable name */
    name: string;
    /** What this skill does — shown in UI and discovery */
    description: string;

    /** Classification */
    domain: SkillDomain;
    category: string;
    tags: string[];

    /** The actual skill definition */
    definition: SkillDefinition;

    /** Runtime requirements */
    requirements: SkillRequirements;

    /** Output contract */
    output: SkillOutputContract;

    /** Governance */
    governance: SkillGovernance;

    /** Evaluation metrics */
    evaluation: SkillEvaluation;

    /** Lifecycle state */
    lifecycle: SkillLifecycle;

    /** Metadata */
    meta: SkillMeta;
}

export type SkillDomain =
    | 'engineering'
    | 'marketing'
    | 'leadership'
    | 'learning'
    | 'operations'
    | 'cross-domain';

// ---------------------------------------------------------------------------
// Skill Definition — The actual intelligence
// ---------------------------------------------------------------------------

export interface SkillDefinition {
    /** System prompt template with {{variable}} placeholders */
    systemPrompt: string;

    /** User prompt template */
    userPromptTemplate: string;

    /** Prompt variables and their types */
    variables: SkillVariable[];

    /** Tools this skill can invoke */
    tools: SkillToolBinding[];

    /** Memory hooks — what context to retrieve */
    memoryHooks: MemoryHook[];

    /** Safety constraints */
    guardrails: Guardrail[];

    /** Chain-of-thought instructions */
    reasoningInstructions?: string;

    /** Expected output schema (JSON Schema) */
    outputSchema?: Record<string, unknown>;

    /** Few-shot examples */
    examples: SkillExample[];
}

export interface SkillVariable {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    required: boolean;
    description: string;
    default?: unknown;
    validation?: string; // regex or rule
}

export interface SkillToolBinding {
    toolId: string;
    purpose: string;
    required: boolean;
    permissions: ('read' | 'write' | 'admin')[];
}

export interface MemoryHook {
    type: 'vector' | 'keyword' | 'graph' | 'structured';
    namespaces: string[];
    knowledgeTypes: string[];
    maxResults: number;
    minRelevance: number;
}

export interface Guardrail {
    type: 'content_filter' | 'pii_detection' | 'bias_check' | 'hallucination_threshold' | 'cost_limit' | 'latency_limit' | 'custom';
    config: Record<string, unknown>;
    action: 'block' | 'warn' | 'log';
}

export interface SkillExample {
    input: Record<string, unknown>;
    expectedOutput: unknown;
    explanation?: string;
}

// ---------------------------------------------------------------------------
// Requirements — What the skill needs to run
// ---------------------------------------------------------------------------

export interface SkillRequirements {
    /** Model capability requirements */
    model: {
        minCapability: 'basic' | 'standard' | 'advanced' | 'frontier';
        preferredModels?: string[];
        maxTokens: number;
        temperature?: number;
        requiresStructuredOutput: boolean;
    };

    /** Required connectors */
    connectors: string[];

    /** Required memory namespaces */
    memoryNamespaces: string[];

    /** Estimated latency */
    estimatedLatencyMs: number;

    /** Estimated cost per execution */
    estimatedCostUsd: number;

    /** Required privilege level */
    privilegeLevel: 'user' | 'operator' | 'admin';
}

// ---------------------------------------------------------------------------
// Output Contract — What the skill guarantees
// ---------------------------------------------------------------------------

export interface SkillOutputContract {
    /** TypeScript/JSON Schema type name */
    typeName: string;

    /** Schema definition */
    schema: Record<string, unknown>;

    /** Must include evidence/sources */
    requiresSources: boolean;

    /** Minimum grounding score */
    minGroundingScore: number;

    /** Must include confidence */
    requiresConfidence: boolean;

    /** Rendering hints for UI */
    renderingHints: {
        format: 'card' | 'table' | 'timeline' | 'document' | 'code' | 'diagram';
        expandable: boolean;
        exportable: boolean;
    };
}

// ---------------------------------------------------------------------------
// Governance — Who can use/edit/publish
// ---------------------------------------------------------------------------

export interface SkillGovernance {
    /** Who owns this skill */
    owner: string;

    /** Who can edit */
    editors: string[];

    /** Who can use (empty = everyone) */
    allowedUsers: string[];

    /** Teams that can use */
    allowedTeams: string[];

    /** Requires approval before execution */
    requiresApproval: boolean;

    /** Approval chain */
    approvers: string[];

    /** Audit requirements */
    auditLevel: 'none' | 'basic' | 'full';

    /** Data sensitivity */
    dataSensitivity: 'public' | 'internal' | 'confidential' | 'restricted';
}

// ---------------------------------------------------------------------------
// Evaluation — Quality metrics
// ---------------------------------------------------------------------------

export interface SkillEvaluation {
    /** Total executions */
    totalExecutions: number;

    /** Success rate */
    successRate: number;

    /** Average confidence of outputs */
    avgConfidence: number;

    /** Average grounding score */
    avgGroundingScore: number;

    /** Average latency */
    avgLatencyMs: number;

    /** Average cost */
    avgCostUsd: number;

    /** User satisfaction (1-5) */
    userSatisfaction: number;

    /** Number of times output was edited/corrected */
    editRate: number;

    /** Last evaluation date */
    lastEvaluatedAt: Date;

    /** Quality tier based on metrics */
    qualityTier: 'experimental' | 'beta' | 'production' | 'certified';
}

// ---------------------------------------------------------------------------
// Lifecycle — States and transitions
// ---------------------------------------------------------------------------

export type LifecycleState =
    | 'draft'
    | 'review'
    | 'testing'
    | 'published'
    | 'deprecated'
    | 'archived';

export interface SkillLifecycle {
    state: LifecycleState;
    publishedAt?: Date;
    deprecatedAt?: Date;
    deprecationReason?: string;
    successorSkillId?: string;
    changelog: Array<{
        version: string;
        date: Date;
        author: string;
        changes: string;
    }>;
}

export interface SkillMeta {
    createdAt: Date;
    updatedAt: Date;
    createdBy: string;
    updatedBy: string;
}

// ---------------------------------------------------------------------------
// Lifecycle State Machine
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
    draft: ['review', 'archived'],
    review: ['testing', 'draft'],
    testing: ['published', 'draft'],
    published: ['deprecated'],
    deprecated: ['archived', 'published'], // can un-deprecate
    archived: ['draft'], // can revive
};

export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function validateSkill(skill: Skill): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // ID format: domain.category.name
    if (!/^[a-z]+\.[a-z_]+\.[a-z_]+$/.test(skill.id)) {
        errors.push(`Invalid skill ID format: ${skill.id}. Expected: domain.category.name`);
    }

    // Semver
    if (!/^\d+\.\d+\.\d+$/.test(skill.version)) {
        errors.push(`Invalid version format: ${skill.version}. Expected: semver (e.g., 1.0.0)`);
    }

    // System prompt must exist
    if (!skill.definition.systemPrompt || skill.definition.systemPrompt.length < 50) {
        errors.push('System prompt is missing or too short (minimum 50 characters)');
    }

    // Variables must be defined
    const templateVars = skill.definition.userPromptTemplate.match(/\{\{(\w+)\}\}/g) ?? [];
    const definedVars = new Set(skill.definition.variables.map((v) => v.name));
    for (const tv of templateVars) {
        const name = tv.replace(/\{\{|\}\}/g, '');
        if (!definedVars.has(name)) {
            errors.push(`Template variable {{${name}}} is not defined in variables`);
        }
    }

    // Output contract
    if (skill.output.requiresSources && skill.definition.memoryHooks.length === 0) {
        warnings.push('Output requires sources but no memory hooks are defined');
    }

    if (skill.output.minGroundingScore > 0 && skill.definition.guardrails.every(g => g.type !== 'hallucination_threshold')) {
        warnings.push('Grounding score required but no hallucination guardrail defined');
    }

    // Examples
    if (skill.definition.examples.length === 0) {
        warnings.push('No examples defined — skill quality may be lower');
    }

    // Governance
    if (!skill.governance.owner) {
        errors.push('Skill must have an owner');
    }

    if (skill.governance.dataSensitivity === 'restricted' && skill.governance.auditLevel !== 'full') {
        errors.push('Restricted data skills require full audit level');
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

// ---------------------------------------------------------------------------
// UnifiedSkillDef — Shared type used by gateway & frontend for all personas
// ---------------------------------------------------------------------------

/**
 * ExecutableType distinguishes:
 *  - skill: a focused, atomic action the user can run standalone
 *  - workflow: a pre-composed template that wires multiple skills together
 */
export type ExecutableType = 'skill' | 'workflow';

export interface UnifiedInputField {
    id: string;
    label: string;
    type: 'text' | 'textarea' | 'url' | 'number' | 'date' | 'select' | 'multiselect' | 'file' | 'tags' | 'toggle';
    required?: boolean;
    placeholder?: string;
    options?: string[] | { label: string; value: string }[];
    /** Short inline hint shown below field */
    helpText?: string;
    /** Rich description shown in right panel */
    description?: string;
    /** Clickable examples the user can pick from */
    examples?: string[];
    /** Suggested values that auto-fill on click */
    suggestedValues?: string[];
    /** URL for external help docs */
    helpUrl?: string;
    /** ID of a prompt from prompt library that's related to this field */
    relatedPromptId?: string;
    section: 'basic' | 'advanced';
    /** Show this field only if the named field has a truthy value */
    dependsOn?: string;
    /** For file fields: accepted MIME types or extensions */
    accept?: string;
    multiple?: boolean;
}

export interface UnifiedStepDef {
    id: string;
    order: number;
    name: string;
    agent: string;
    tool?: string;
    outputKey: string;
    requiresApproval?: boolean;
    approvalFields?: string[];
    approvalApprovers?: string[];
    approvalTimeoutMs?: number;
    description?: string;
    agentLabel?: string;
    agentPersona?: PersonaId;
    toolId?: string;
    toolLabel?: string;
    kind?: StepKind;
    inputBindings?: Record<string, unknown>;
    condition?: { expression: string; trueStep: string; falseStep: string };
    transform?: Record<string, unknown>;
    transformExpression?: string;
    waitMs?: number;
    subworkflow?: { definition: UnifiedSkillDef };
    planCandidates?: UnifiedSkillDef[];
    taskPrompt?: string;
    retry?: { maxAttempts: number; backoffMs: number; strategy?: 'fixed' | 'linear' | 'exponential' };
    timeoutMs?: number;
    outputRequirements?: { sections?: string[]; minCitations?: number };
    toolAction?: { action: string; resourceType: string; inputBindings: Record<string, string> };
    /** Capability identifier for capability-based routing */
    capability?: string;
    /** DAG mode: IDs of steps this step depends on */
    dependsOn?: string[];
}

export interface UnifiedSkillDef {
    id: string;
    slug: string;
    name: string;
    description: string;
    icon: string;
    /** The persona this belongs to */
    persona: PersonaId | 'leadership';
    /** Visual grouping label */
    cluster: string;
    /** Whether this is an atomic skill or a composed workflow template */
    executableType: ExecutableType;
    complexity: 'simple' | 'moderate' | 'complex';
    estimatedTime: string;
    inputs: UnifiedInputField[];
    steps: UnifiedStepDef[];
    outputs: string[];
    requiredTools: string[];
    optionalTools: string[];
    tags: string[];
    /** Link to prompt library entry */
    promptIds?: string[];
    /** For workflows: the skill IDs this workflow composes */
    composedSkillIds?: string[];
    /** For workflows: DAG edges (if non-sequential) */
    edges?: { from: string; to: string; condition?: string }[];
    executionMode?: 'sequential' | 'dag';
    maxConcurrency?: number;
    schemaVersion?: 1;
    version?: string;
    definitionHash?: string;
}

export { MARKETING_INPUT_FIELDS } from './marketing-inputs.js';

export const WORKFLOW_PERSONAS = ['engineering', 'product', 'marketing', 'hr', 'ta', 'program'] as const;
export type WorkflowPersona = typeof WORKFLOW_PERSONAS[number];
export type PersonaId = WorkflowPersona | 'executive' | 'design' | 'learning';
export type RunMode = 'live' | 'simulation';
export type Provenance = 'live' | 'simulated' | 'none';
export const EXECUTION_STATUSES = ['queued', 'running', 'paused', 'completed', 'failed', 'rejected', 'cancelled', 'unsupported', 'inconclusive', 'simulated'] as const;
export type ExecutionStatus = typeof EXECUTION_STATUSES[number];
export const STEP_STATUSES = ['pending', 'running', 'approval_required', 'completed', 'failed', 'rejected', 'cancelled', 'unsupported', 'inconclusive', 'simulated', 'skipped'] as const;
export type StepStatus = typeof STEP_STATUSES[number];
export type StepKind = 'llm' | 'tool_read' | 'tool_effect' | 'transform' | 'condition' | 'join' | 'approval' | 'subworkflow' | 'planner' | 'wait';

export interface ExecutionError {
    code: string;
    message: string;
    retryable: boolean;
    stepId?: string;
}

export interface ExecutionAttempt {
    id: string;
    tenantId: string;
    runId: string;
    stepId: string;
    number: number;
    fencingToken: number;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    startedAt: string;
    finishedAt?: string;
    error?: ExecutionError;
}

export interface ExecutionArtifact {
    id: string;
    tenantId: string;
    runId: string;
    stepId: string;
    outputKey: string;
    mediaType: string;
    provenance: Provenance;
    schemaVersion: number;
    content: unknown;
    parentArtifactIds: string[];
    createdAt: string;
}

export interface ExecutionApproval {
    id: string;
    tenantId: string;
    runId: string;
    stepId: string;
    attempt: number;
    artifactIds: string[];
    status: 'pending' | 'approved' | 'rejected' | 'expired';
    requestedBy: string;
    decidedBy?: string;
    reason?: string;
    createdAt: string;
    decidedAt?: string;
}

export interface ExecutionEvent {
    id: string;
    tenantId: string;
    runId: string;
    stepId?: string;
    type: string;
    provenance: Provenance;
    data: Record<string, unknown>;
    createdAt: string;
}

export interface ExecutionStep {
    stepId: string;
    stepName: string;
    agentId: string;
    toolId: string;
    kind: StepKind;
    status: StepStatus;
    provenance: Provenance;
    outputKey: string;
    dependsOn: string[];
    attempts: ExecutionAttempt[];
    artifactIds: string[];
    error?: ExecutionError;
}

export interface ExecutionContract {
    schemaVersion: 1;
    definitionHash: string;
    definitionVersion: string;
    id: string;
    tenantId: string;
    userId: string;
    parentRunId?: string;
    persona: WorkflowPersona;
    skillId: string;
    skillName: string;
    mode: RunMode;
    status: ExecutionStatus;
    inputs: Record<string, unknown>;
    steps: ExecutionStep[];
    artifacts: ExecutionArtifact[];
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
    error?: ExecutionError;
}

export function canonicalPersona(value: string): PersonaId | undefined {
    const normalized = value.trim().toLowerCase();
    const aliases: Record<string, PersonaId> = { 'talent-acquisition': 'ta', 'program-management': 'program', leadership: 'executive' };
    return Object.hasOwn(aliases, normalized) ? aliases[normalized] : [...WORKFLOW_PERSONAS, 'executive', 'design', 'learning'].includes(normalized) ? normalized as PersonaId : undefined;
}

export function aggregateExecutionStatus(steps: readonly StepStatus[], mode: RunMode): ExecutionStatus {
    for (const status of ['cancelled', 'rejected', 'failed', 'unsupported', 'inconclusive'] as const) if (steps.includes(status)) return status;
    if (steps.includes('approval_required')) return 'paused';
    if (steps.includes('running')) return 'running';
    if (!steps.length || steps.includes('pending') || steps.every(status => status === 'skipped')) return 'inconclusive';
    if (mode === 'simulation') return steps.every(status => status === 'simulated' || status === 'skipped') ? 'simulated' : 'inconclusive';
    return steps.every(status => status === 'completed' || status === 'skipped') ? 'completed' : 'inconclusive';
}

export function isTerminalExecutionStatus(status: string): boolean {
    return ['completed', 'failed', 'rejected', 'cancelled', 'unsupported', 'inconclusive', 'simulated'].includes(status);
}

export function assertExecutionTransition(from: ExecutionStatus, to: ExecutionStatus): void {
    if (from === to) return;
    const transitions: Partial<Record<ExecutionStatus, readonly ExecutionStatus[]>> = {
        queued: ['running', 'cancelled', 'failed', 'unsupported'],
        running: ['paused', 'completed', 'failed', 'rejected', 'cancelled', 'unsupported', 'inconclusive', 'simulated'],
        paused: ['running', 'rejected', 'cancelled', 'failed'],
    };
    if (!transitions[from]?.includes(to)) throw new Error(`Invalid execution transition: ${from} -> ${to}`);
}
