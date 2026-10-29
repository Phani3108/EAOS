/**
 * Execution Store — Unified state for running skills/workflows across all personas.
 * Replaces per-persona execution tracking with a single source of truth.
 */
'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StepStatus = import('@agentos/skills/schema').StepStatus;

export interface ExecutionStep {
  stepId: string;
  stepName: string;
  agent: string;
  tool?: string;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  outputKey?: string;
  outputPreview?: string;
  error?: string;
  /** IDs of steps this step depends on (DAG mode) */
  dependsOn?: string[];
}

/** Directed edge between execution steps (DAG mode) */
export interface ExecutionEdge {
  from: string;
  to: string;
  condition?: string;
}

export type ExecutionMode = 'sequential' | 'dag';

export type ExecutionStatus = 'configuring' | 'precheck' | import('@agentos/skills/schema').ExecutionStatus;

export interface Execution {
  id: string;
  /** 'marketing' | 'engineering' | 'product' | etc. */
  persona: string;
  /** Skill or workflow ID */
  skillId: string;
  skillName: string;
  /** Whether this was a skill or workflow execution */
  executableType: 'skill' | 'workflow';
  /** Sequential or DAG-based execution */
  executionMode: ExecutionMode;
  /** DAG edges (only when executionMode === 'dag') */
  edges?: ExecutionEdge[];
  /** Which workspace section triggered this */
  workspace: string;
  status: ExecutionStatus;
  steps: ExecutionStep[];
  /** Accumulated outputs keyed by outputKey */
  outputs: Record<string, string>;
  /** User-provided inputs */
  inputs: Record<string, unknown>;
  /** File IDs attached */
  fileIds?: string[];
  /** Whether running in simulation mode */
  simulate: boolean;
  /** Pre-check result */
  preCheck?: PreCheckResult;
  startedAt: string;
  completedAt?: string;
  totalDurationMs?: number;
}

export interface PreCheckResult {
  canExecute: boolean;
  reason?: string;
  missingTools?: string[];
  connectedTools?: string[];
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  persona: string;
  category?: string;
  /** Whether this is an atomic skill or a composed workflow template */
  executableType: 'skill' | 'workflow';
  /** Tools this skill needs */
  requiredTools: string[];
  /** Steps in the workflow */
  steps: SkillStep[];
  /** Input fields the user needs to fill */
  inputFields: SkillInputField[];
  support?: { executionClass: string; readiness: string; certification: { vendorSandbox: string; domainReview: string } };
  /** Output format definition */
  outputFormat?: string;
  icon?: string;
  estimatedTime?: string;
  /** Linked prompt IDs from prompt library */
  promptIds?: string[];
  /** For workflows: the skill IDs this composes */
  composedSkillIds?: string[];
}

export interface SkillStep {
  id: string;
  name: string;
  agent: string;
  tool?: string;
  outputKey?: string;
  requiresApproval?: boolean;
  description?: string;
}

export interface SkillInputField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'multiselect' | 'file';
  placeholder?: string;
  required: boolean;
  multiple?: boolean;
  options?: { label: string; value: string }[];
  /** Short inline hint shown below the input */
  hint?: string;
  /** Rich description shown in right panel when field is focused */
  description?: string;
  /** Clickable examples the user can pick from */
  examples?: string[];
  /** Suggested values shown in right panel */
  suggestedValues?: string[];
  /** URL for external help documentation */
  helpUrl?: string;
  /** ID of a related prompt from the prompt library */
  relatedPromptId?: string;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface ExecutionState {
  /** Currently active execution (the one being viewed/configured) */
  activeExecution: Execution | null;
  /** All executions (history) */
  executions: Execution[];

  /** Available skills for the selected persona */
  availableSkills: SkillDefinition[];
  /** Currently selected skill (before execution starts) */
  selectedSkill: SkillDefinition | null;

  /** Currently focused input field key (for right panel contextual help) */
  focusedField: string | null;

  // Actions
  setSelectedSkill: (skill: SkillDefinition | null) => void;
  setAvailableSkills: (skills: SkillDefinition[]) => void;
  setFocusedField: (fieldKey: string | null) => void;

  /** Create a new execution and make it active */
  createExecution: (params: {
    persona: string;
    skill: SkillDefinition;
    workspace: string;
    inputs: Record<string, unknown>;
    fileIds?: string[];
    simulate: boolean;
  }) => Execution;

  /** Set active execution by ID (for viewing existing) */
  setActiveExecution: (id: string | null) => void;

  /** Update execution top-level fields */
  updateExecution: (id: string, updates: Partial<Execution>) => void;

  /** Update a single step in an execution */
  updateStep: (execId: string, stepId: string, updates: Partial<ExecutionStep>) => void;

  /** Set pre-check result for active execution */
  setPreCheck: (execId: string, result: PreCheckResult) => void;

  /** Set all outputs for an execution */
  setOutputs: (execId: string, outputs: Record<string, string>) => void;

  /** Clear active execution (go back to skill picker) */
  clearActive: () => void;

  /** Get executions for a specific persona */
  getByPersona: (persona: string) => Execution[];

  /** Get recent executions across all personas */
  getRecent: (limit?: number) => Execution[];
}

export const useExecutionStore = create<ExecutionState>()(persist((set, get) => ({
  activeExecution: null,
  executions: [],
  availableSkills: [],
  selectedSkill: null,
  focusedField: null,

  setSelectedSkill: (skill) => set({ selectedSkill: skill }),
  setAvailableSkills: (skills) => set({ availableSkills: skills }),
  setFocusedField: (fieldKey) => set({ focusedField: fieldKey }),

  createExecution: ({ persona, skill, workspace, inputs, fileIds, simulate }) => {
    const id = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const execution: Execution = {
      id,
      persona,
      skillId: skill.id,
      skillName: skill.name,
      executableType: skill.executableType ?? 'skill',
      executionMode: 'sequential',
      workspace,
      status: 'queued',
      steps: skill.steps.map(s => ({
        stepId: s.id,
        stepName: s.name,
        agent: s.agent,
        tool: s.tool,
        status: 'pending' as StepStatus,
        outputKey: s.outputKey,
      })),
      outputs: {},
      inputs,
      fileIds,
      simulate,
      startedAt: new Date().toISOString(),
    };

    set(state => ({
      activeExecution: execution,
      executions: [execution, ...state.executions],
    }));

    return execution;
  },

  setActiveExecution: (id) => {
    if (!id) {
      set({ activeExecution: null });
      return;
    }
    const exec = get().executions.find(e => e.id === id);
    if (exec) set({ activeExecution: exec });
  },

  updateExecution: (id, updates) => {
    set(state => {
      const updated = state.executions.map(e =>
        e.id === id ? { ...e, ...updates } : e
      );
      const active = state.activeExecution?.id === id
        ? { ...state.activeExecution, ...updates }
        : state.activeExecution;
      return { executions: updated, activeExecution: active };
    });
  },

  updateStep: (execId, stepId, updates) => {
    set(state => {
      const mapSteps = (steps: ExecutionStep[]) =>
        steps.map(s => s.stepId === stepId ? { ...s, ...updates } : s);

      const updated = state.executions.map(e =>
        e.id === execId ? { ...e, steps: mapSteps(e.steps) } : e
      );
      const active = state.activeExecution?.id === execId
        ? { ...state.activeExecution, steps: mapSteps(state.activeExecution.steps) }
        : state.activeExecution;
      return { executions: updated, activeExecution: active };
    });
  },

  setPreCheck: (execId, result) => {
    get().updateExecution(execId, { preCheck: result });
  },

  setOutputs: (execId, outputs) => {
    get().updateExecution(execId, { outputs });
  },

  clearActive: () => set({ activeExecution: null, selectedSkill: null }),

  getByPersona: (persona) => get().executions.filter(e => e.persona === persona),

  getRecent: (limit = 20) =>
    get().executions
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, limit),
}), {
  name: 'execution-store',
  partialize: (state) => ({
    executions: state.executions,
  }),
}));
