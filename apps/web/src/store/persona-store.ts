/**
 * Persona Store — Shared Zustand state for Engineering and Product personas
 * Mirrors the Marketing store pattern for execution tracking and section navigation.
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */
'use client';

import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EngineeringSection = 'run' | 'library' | 'pipelines' | 'history';

export type ProductSection = 'run' | 'library' | 'pipelines' | 'history';

export type HRSection = 'run' | 'library' | 'pipelines' | 'history';

export type TASection = 'run' | 'library' | 'pipelines' | 'history';

export type ProgramSection = 'run' | 'library' | 'pipelines' | 'history';

export type ExecutionStepStatus = import('@agentos/skills/schema').StepStatus;

export interface PersonaExecutionStep {
  id: string;
  stepId: string;
  stepName: string;
  agent: string;
  agentCallSign?: string;
  agentRank?: string;
  tool?: string;
  status: ExecutionStepStatus;
  startedAt?: string;
  completedAt?: string;
  outputKey?: string;
  outputPreview?: string;
  error?: string;
  // KPI metrics from backend
  latencyMs?: number;
  tokenCost?: number;
  qualityScore?: number;
  handoffValid?: boolean;
}

export interface PersonaExecution {
  id: string;
  persona: 'engineering' | 'product' | 'hr' | 'ta' | 'program';
  skillId: string;
  skillName: string;
  status: import('@agentos/skills/schema').ExecutionStatus;
  mode?: import('@agentos/skills/schema').RunMode;
  steps: PersonaExecutionStep[];
  outputs: Record<string, string>;
  startedAt: string;
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Engineering Store
// ---------------------------------------------------------------------------

interface EngineeringState {
  activeSection: EngineeringSection;
  setActiveSection: (section: EngineeringSection) => void;

  selectedSkillId: string | null;
  setSelectedSkillId: (id: string | null) => void;

  activeExecution: PersonaExecution | null;
  executions: PersonaExecution[];
  addExecution: (exec: PersonaExecution) => void;
  updateExecution: (id: string, updates: Partial<PersonaExecution>) => void;
  updateExecutionStep: (execId: string, stepId: string, updates: Partial<PersonaExecutionStep>) => void;
}

export const useEngineeringStore = create<EngineeringState>((set) => ({
  activeSection: 'run',
  setActiveSection: (section) => set({ activeSection: section }),

  selectedSkillId: null,
  setSelectedSkillId: (id) => set({ selectedSkillId: id }),

  activeExecution: null,
  executions: [],
  addExecution: (exec) =>
    set((s) => ({
      executions: [exec, ...s.executions].slice(0, 50),
      activeExecution: exec,
    })),
  updateExecution: (id, updates) =>
    set((s) => ({
      executions: s.executions.map((e) => (e.id === id ? { ...e, ...updates } : e)),
      activeExecution: s.activeExecution?.id === id ? { ...s.activeExecution, ...updates } : s.activeExecution,
    })),
  updateExecutionStep: (execId, stepId, updates) =>
    set((s) => ({
      executions: s.executions.map((e) =>
        e.id === execId
          ? { ...e, steps: e.steps.map((st) => (st.stepId === stepId ? { ...st, ...updates } : st)) }
          : e
      ),
      activeExecution:
        s.activeExecution?.id === execId
          ? {
              ...s.activeExecution,
              steps: s.activeExecution.steps.map((st) =>
                st.stepId === stepId ? { ...st, ...updates } : st
              ),
            }
          : s.activeExecution,
    })),
}));

// ---------------------------------------------------------------------------
// Product Store
// ---------------------------------------------------------------------------

interface ProductState {
  activeSection: ProductSection;
  setActiveSection: (section: ProductSection) => void;

  selectedSkillId: string | null;
  setSelectedSkillId: (id: string | null) => void;

  activeExecution: PersonaExecution | null;
  executions: PersonaExecution[];
  addExecution: (exec: PersonaExecution) => void;
  updateExecution: (id: string, updates: Partial<PersonaExecution>) => void;
  updateExecutionStep: (execId: string, stepId: string, updates: Partial<PersonaExecutionStep>) => void;
}

export const useProductStore = create<ProductState>((set) => ({
  activeSection: 'run',
  setActiveSection: (section) => set({ activeSection: section }),

  selectedSkillId: null,
  setSelectedSkillId: (id) => set({ selectedSkillId: id }),

  activeExecution: null,
  executions: [],
  addExecution: (exec) =>
    set((s) => ({
      executions: [exec, ...s.executions].slice(0, 50),
      activeExecution: exec,
    })),
  updateExecution: (id, updates) =>
    set((s) => ({
      executions: s.executions.map((e) => (e.id === id ? { ...e, ...updates } : e)),
      activeExecution: s.activeExecution?.id === id ? { ...s.activeExecution, ...updates } : s.activeExecution,
    })),
  updateExecutionStep: (execId, stepId, updates) =>
    set((s) => ({
      executions: s.executions.map((e) =>
        e.id === execId
          ? { ...e, steps: e.steps.map((st) => (st.stepId === stepId ? { ...st, ...updates } : st)) }
          : e
      ),
      activeExecution:
        s.activeExecution?.id === execId
          ? {
              ...s.activeExecution,
              steps: s.activeExecution.steps.map((st) =>
                st.stepId === stepId ? { ...st, ...updates } : st
              ),
            }
          : s.activeExecution,
    })),
}));

// ---------------------------------------------------------------------------
// HR Store
// ---------------------------------------------------------------------------

interface HRState {
  activeSection: HRSection;
  setActiveSection: (section: HRSection) => void;

  selectedSkillId: string | null;
  setSelectedSkillId: (id: string | null) => void;

  activeExecution: PersonaExecution | null;
  executions: PersonaExecution[];
  addExecution: (exec: PersonaExecution) => void;
  updateExecution: (id: string, updates: Partial<PersonaExecution>) => void;
  updateExecutionStep: (execId: string, stepId: string, updates: Partial<PersonaExecutionStep>) => void;
}

export const useHRStore = create<HRState>((set) => ({
  activeSection: 'run',
  setActiveSection: (section) => set({ activeSection: section }),

  selectedSkillId: null,
  setSelectedSkillId: (id) => set({ selectedSkillId: id }),

  activeExecution: null,
  executions: [],
  addExecution: (exec) =>
    set((s) => ({
      executions: [exec, ...s.executions].slice(0, 50),
      activeExecution: exec,
    })),
  updateExecution: (id, updates) =>
    set((s) => ({
      executions: s.executions.map((e) => (e.id === id ? { ...e, ...updates } : e)),
      activeExecution: s.activeExecution?.id === id ? { ...s.activeExecution, ...updates } : s.activeExecution,
    })),
  updateExecutionStep: (execId, stepId, updates) =>
    set((s) => ({
      executions: s.executions.map((e) =>
        e.id === execId
          ? { ...e, steps: e.steps.map((st) => (st.stepId === stepId ? { ...st, ...updates } : st)) }
          : e
      ),
      activeExecution:
        s.activeExecution?.id === execId
          ? {
              ...s.activeExecution,
              steps: s.activeExecution.steps.map((st) =>
                st.stepId === stepId ? { ...st, ...updates } : st
              ),
            }
          : s.activeExecution,
    })),
}));

// ---------------------------------------------------------------------------
// TA Store (Talent Acquisition)
// ---------------------------------------------------------------------------

const createPersonaStore = (set: any) => ({
  activeSection: 'run' as const,
  setActiveSection: (section: string) => set({ activeSection: section }),
  selectedSkillId: null as string | null,
  setSelectedSkillId: (id: string | null) => set({ selectedSkillId: id }),
  activeExecution: null as PersonaExecution | null,
  executions: [] as PersonaExecution[],
  addExecution: (exec: PersonaExecution) =>
    set((s: any) => ({ executions: [exec, ...s.executions].slice(0, 50), activeExecution: exec })),
  updateExecution: (id: string, updates: Partial<PersonaExecution>) =>
    set((s: any) => ({
      executions: s.executions.map((e: PersonaExecution) => (e.id === id ? { ...e, ...updates } : e)),
      activeExecution: s.activeExecution?.id === id ? { ...s.activeExecution, ...updates } : s.activeExecution,
    })),
  updateExecutionStep: (execId: string, stepId: string, updates: Partial<PersonaExecutionStep>) =>
    set((s: any) => ({
      executions: s.executions.map((e: PersonaExecution) =>
        e.id === execId ? { ...e, steps: e.steps.map((st: PersonaExecutionStep) => (st.stepId === stepId ? { ...st, ...updates } : st)) } : e
      ),
      activeExecution:
        s.activeExecution?.id === execId
          ? { ...s.activeExecution, steps: s.activeExecution.steps.map((st: PersonaExecutionStep) => st.stepId === stepId ? { ...st, ...updates } : st) }
          : s.activeExecution,
    })),
});

export const useTAStore = create(createPersonaStore);

// ---------------------------------------------------------------------------
// Program Store
// ---------------------------------------------------------------------------

export const useProgramStore = create(createPersonaStore);
