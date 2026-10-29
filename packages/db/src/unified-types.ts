/**
 * Unified Execution Types — Shared between backend and frontend
 *
 * Single source of truth for execution, step, and agent types.
 * Supports both sequential (linear skill) and DAG (workflow) execution.
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

// ---------------------------------------------------------------------------
// Execution Mode
// ---------------------------------------------------------------------------

export type ExecutionMode = 'sequential' | 'dag';
export type ExecutableType = 'skill' | 'workflow' | 'goal';
export type PersonaId = import('@agentos/skills/schema').WorkflowPersona;
export type ExecutionStatus = import('@agentos/skills/schema').ExecutionStatus;
export type StepStatus = import('@agentos/skills/schema').StepStatus;

// ---------------------------------------------------------------------------
// Unified Execution Record — replaces PersonaExecutionRecord AND
// MarketingExecutionRecord with a single type that handles both
// sequential and DAG execution.
// ---------------------------------------------------------------------------

export interface UnifiedExecution {
  id: string;
  persona: PersonaId;
  executableType: ExecutableType;

  /** Skill or workflow ID */
  skillId: string;
  skillName: string;

  status: ExecutionStatus;
  executionMode: ExecutionMode;

  /** LLM provider used */
  provider?: string;
  model?: string;

  /** User-provided inputs */
  inputs: Record<string, unknown>;
  /** Accumulated outputs keyed by step outputKey */
  outputs: Record<string, string>;

  /** Execution steps — ordered for sequential, keyed for DAG */
  steps: UnifiedStep[];

  /**
   * DAG edges — only populated when executionMode === 'dag'.
   * Defines execution order via directed edges between step IDs.
   */
  edges: ExecutionEdge[];

  /** User who initiated */
  userId?: string;

  // -- Aggregate metrics --
  totalTokenCost?: number;
  totalLatencyMs?: number;
  avgQualityScore?: number;

  // -- Timestamps --
  startedAt: string;
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Unified Step — works for both linear steps and DAG nodes
// ---------------------------------------------------------------------------

export interface UnifiedStep {
  stepId: string;
  stepName: string;
  stepIndex: number;

  /** Agent assigned to this step */
  agent: string;
  agentCallSign?: string;
  agentRank?: string;

  /** Tool required (optional) */
  tool?: string;

  status: StepStatus;

  /** Key to store output under in execution.outputs */
  outputKey?: string;
  outputPreview?: string;
  error?: string;

  /** Whether this step requires human approval before proceeding */
  requiresApproval?: boolean;

  // -- KPI tracking --
  latencyMs?: number;
  tokenCost?: number;
  qualityScore?: number;
  handoffValid?: boolean;
  handoffWarnings?: string[];

  /**
   * DAG dependencies — step IDs that must complete before this step runs.
   * Empty for sequential mode or root steps.
   */
  dependsOn: string[];

  // -- Timestamps --
  startedAt?: string;
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// DAG Edge — defines directed edges for workflow execution
// ---------------------------------------------------------------------------

export interface ExecutionEdge {
  from: string;
  to: string;
  /** Optional condition expression — edge only activates when true */
  condition?: string;
}

// ---------------------------------------------------------------------------
// Agent KPI — performance tracking per agent across executions
// ---------------------------------------------------------------------------

export interface AgentKPI {
  agentId: string;
  callSign: string;
  totalExecutions: number;
  avgLatencyMs: number;
  avgQualityScore: number;
  avgTokenCost: number;
  handoffSuccessRate: number;
  lastExecutedAt: string;
  /** SLA thresholds (Phase B) */
  slaQualityThreshold?: number;
  slaLatencyThresholdMs?: number;
  underperformanceStreak?: number;
}

// ---------------------------------------------------------------------------
// Skill Definition — unified type for frontend rendering
// Supports both atomic skills and composed workflows
// ---------------------------------------------------------------------------

export interface UnifiedSkillDef {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  persona: PersonaId;
  executableType: ExecutableType;
  executionMode: ExecutionMode;

  /** Visual grouping in UI */
  cluster: string;
  complexity: 'simple' | 'moderate' | 'complex';
  estimatedTime: string;

  /** User input fields */
  inputs: SkillInputField[];

  /** Execution steps */
  steps: SkillStepDef[];

  /**
   * DAG edges — only present for workflow-type definitions.
   * When absent, steps execute sequentially by array order.
   */
  edges?: ExecutionEdge[];

  /** Expected output keys */
  outputs: string[];

  /** Tool requirements */
  requiredTools: string[];
  optionalTools: string[];
  tags: string[];
}

export interface SkillStepDef {
  id: string;
  name: string;
  agent: string;
  tool?: string;
  outputKey: string;
  requiresApproval?: boolean;
  description?: string;
  /** DAG: steps this depends on (by step ID) */
  dependsOn?: string[];
}

export interface SkillInputField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'multiselect' | 'file';
  placeholder?: string;
  required: boolean;
  options?: { label: string; value: string }[];
  hint?: string;
  description?: string;
  examples?: string[];
  suggestedValues?: string[];
  helpUrl?: string;
  relatedPromptId?: string;
  /** Input grouping for advanced/basic sections */
  section?: 'basic' | 'advanced';
}

// ---------------------------------------------------------------------------
// Pre-check — tool connectivity verification before execution
// ---------------------------------------------------------------------------

export interface PreCheckResult {
  canExecute: boolean;
  reason?: string;
  missingTools?: string[];
  connectedTools?: string[];
}

// ---------------------------------------------------------------------------
// Notification — cross-channel delivery record
// ---------------------------------------------------------------------------

export interface NotificationRecord {
  id: string;
  userId?: string;
  channel: 'slack' | 'teams' | 'email' | 'webhook' | 'in_app';
  eventType: string;
  title: string;
  body?: string;
  link?: string;
  read: boolean;
  delivered: boolean;
  executionId?: string;
  createdAt: string;
}
