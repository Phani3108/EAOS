/**
 * Innovation Labs — Sandbox environment for experimental agents, skills, and
 * cross-functional prototypes with an incubation → graduation pipeline.
 *
 * Supports hackathon mode for time-boxed multi-agent experiments.
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import type { Store } from './db.js';
import { readAll } from './db.js';
import { eventBus } from './event-bus.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExperimentStatus =
  | 'draft'
  | 'active'
  | 'evaluating'
  | 'graduated'
  | 'archived';

export type ExperimentCategory =
  | 'agent'
  | 'skill'
  | 'workflow'
  | 'integration'
  | 'process';

export interface Experiment {
  id: string;
  title: string;
  description: string;
  category: ExperimentCategory;
  status: ExperimentStatus;
  hypothesis: string;
  successCriteria: string[];
  createdBy: string;                 // userId or agentId
  assignedAgents: string[];          // agentIds pulled from any regiment
  targetRegiment?: string;           // where it graduates to
  tags: string[];

  // Metrics
  results: ExperimentResult[];
  score?: number;                    // 0-100 evaluation score

  // Hackathon fields
  hackathonId?: string;
  timeboxMs?: number;                // time limit in ms
  startedAt?: string;
  completedAt?: string;

  createdAt: string;
  updatedAt: string;
}

export interface ExperimentResult {
  id: string;
  metric: string;
  value: number;
  unit: string;
  notes?: string;
  recordedAt: string;
}

export interface Hackathon {
  id: string;
  title: string;
  description: string;
  status: 'planned' | 'active' | 'completed';
  durationMs: number;               // total hackathon duration
  startedAt?: string;
  endsAt?: string;
  completedAt?: string;
  experimentIds: string[];
  createdAt: string;
}

export interface GraduationRequest {
  id: string;
  experimentId: string;
  targetRegiment: string;
  targetSkillId?: string;
  proposedBy: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewNotes?: string;
  createdAt: string;
  reviewedAt?: string;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const experiments = new Map<string, Experiment>();
const hackathons = new Map<string, Hackathon>();
const graduations = new Map<string, GraduationRequest>();

let backingStore: Store | null = null;
const EXPERIMENTS_TABLE = 'innovation_experiments';
const HACKATHONS_TABLE = 'innovation_hackathons';
const GRADUATIONS_TABLE = 'innovation_graduations';

function persist(table: string, id: string, data: unknown): void {
  if (!backingStore) return;
  try {
    const existing = backingStore.get(table, id);
    if (existing) {
      backingStore.update(table, id, data as unknown as Record<string, unknown>);
    } else {
      backingStore.insert(table, id, data as unknown as Record<string, unknown>);
    }
  } catch { /* ignore */ }
}

export async function initInnovationStore(store: Store): Promise<void> {
  backingStore = store;
  try {
    for (const row of await readAll(store, EXPERIMENTS_TABLE)) {
      const e = row as unknown as Experiment;
      if (e.id) experiments.set(e.id, e);
    }
    for (const row of await readAll(store, HACKATHONS_TABLE)) {
      const h = row as unknown as Hackathon;
      if (h.id) hackathons.set(h.id, h);
    }
    for (const row of await readAll(store, GRADUATIONS_TABLE)) {
      const g = row as unknown as GraduationRequest;
      if (g.id) graduations.set(g.id, g);
    }
  } catch { /* tables may not exist yet */ }
}

// ---------------------------------------------------------------------------
// Experiment CRUD
// ---------------------------------------------------------------------------

export function createExperiment(input: {
  title: string;
  description: string;
  category: ExperimentCategory;
  hypothesis: string;
  successCriteria: string[];
  createdBy: string;
  assignedAgents?: string[];
  targetRegiment?: string;
  tags?: string[];
  hackathonId?: string;
  timeboxMs?: number;
}): Experiment {
  const id = `exp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();
  const exp: Experiment = {
    id,
    title: input.title,
    description: input.description,
    category: input.category,
    status: 'draft',
    hypothesis: input.hypothesis,
    successCriteria: input.successCriteria,
    createdBy: input.createdBy,
    assignedAgents: input.assignedAgents ?? [],
    targetRegiment: input.targetRegiment,
    tags: input.tags ?? [],
    results: [],
    hackathonId: input.hackathonId,
    timeboxMs: input.timeboxMs,
    createdAt: now,
    updatedAt: now,
  };
  experiments.set(id, exp);
  persist(EXPERIMENTS_TABLE, id, exp);
  eventBus.emit('innovation.experiment.created', { experimentId: id, title: exp.title });
  return exp;
}

export function getExperiment(id: string): Experiment | undefined {
  return experiments.get(id);
}

export function listExperiments(filters?: {
  status?: ExperimentStatus;
  category?: ExperimentCategory;
  hackathonId?: string;
}): Experiment[] {
  let list = [...experiments.values()];
  if (filters?.status) list = list.filter(e => e.status === filters.status);
  if (filters?.category) list = list.filter(e => e.category === filters.category);
  if (filters?.hackathonId) list = list.filter(e => e.hackathonId === filters.hackathonId);
  return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function updateExperiment(
  id: string,
  updates: Partial<Pick<Experiment, 'title' | 'description' | 'hypothesis' | 'successCriteria' | 'assignedAgents' | 'targetRegiment' | 'tags'>>,
): Experiment {
  const exp = experiments.get(id);
  if (!exp) throw new Error(`Experiment ${id} not found`);
  Object.assign(exp, updates, { updatedAt: new Date().toISOString() });
  persist(EXPERIMENTS_TABLE, id, exp);
  return exp;
}

export function transitionExperiment(id: string, newStatus: ExperimentStatus): Experiment {
  const exp = experiments.get(id);
  if (!exp) throw new Error(`Experiment ${id} not found`);

  // Valid transitions
  const VALID: Record<ExperimentStatus, ExperimentStatus[]> = {
    draft: ['active', 'archived'],
    active: ['evaluating', 'archived'],
    evaluating: ['graduated', 'active', 'archived'],
    graduated: ['archived'],
    archived: ['draft'],
  };
  if (!VALID[exp.status]?.includes(newStatus)) {
    throw new Error(`Cannot transition from ${exp.status} to ${newStatus}`);
  }

  exp.status = newStatus;
  exp.updatedAt = new Date().toISOString();
  if (newStatus === 'active' && !exp.startedAt) exp.startedAt = exp.updatedAt;
  if (newStatus === 'graduated' || newStatus === 'archived') exp.completedAt = exp.updatedAt;
  persist(EXPERIMENTS_TABLE, id, exp);
  eventBus.emit(`innovation.experiment.${newStatus}`, { experimentId: id, title: exp.title });
  return exp;
}

export function addExperimentResult(id: string, result: Omit<ExperimentResult, 'id' | 'recordedAt'>): Experiment {
  const exp = experiments.get(id);
  if (!exp) throw new Error(`Experiment ${id} not found`);
  const entry: ExperimentResult = {
    id: `res-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ...result,
    recordedAt: new Date().toISOString(),
  };
  exp.results.push(entry);
  exp.updatedAt = entry.recordedAt;
  persist(EXPERIMENTS_TABLE, id, exp);
  return exp;
}

export function scoreExperiment(id: string, score: number): Experiment {
  const exp = experiments.get(id);
  if (!exp) throw new Error(`Experiment ${id} not found`);
  exp.score = Math.max(0, Math.min(100, score));
  exp.updatedAt = new Date().toISOString();
  persist(EXPERIMENTS_TABLE, id, exp);
  return exp;
}

export function deleteExperiment(id: string): boolean {
  const existed = experiments.delete(id);
  if (existed && backingStore) {
    try { backingStore.delete(EXPERIMENTS_TABLE, id); } catch { /* ignore */ }
  }
  return existed;
}

// ---------------------------------------------------------------------------
// Hackathon CRUD
// ---------------------------------------------------------------------------

export function createHackathon(input: {
  title: string;
  description: string;
  durationMs: number;
}): Hackathon {
  const id = `hack-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const h: Hackathon = {
    id,
    title: input.title,
    description: input.description,
    status: 'planned',
    durationMs: input.durationMs,
    experimentIds: [],
    createdAt: new Date().toISOString(),
  };
  hackathons.set(id, h);
  persist(HACKATHONS_TABLE, id, h);
  return h;
}

export function getHackathon(id: string): Hackathon | undefined {
  return hackathons.get(id);
}

export function listHackathons(): Hackathon[] {
  return [...hackathons.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function startHackathon(id: string): Hackathon {
  const h = hackathons.get(id);
  if (!h) throw new Error(`Hackathon ${id} not found`);
  if (h.status !== 'planned') throw new Error(`Hackathon already ${h.status}`);
  h.status = 'active';
  h.startedAt = new Date().toISOString();
  h.endsAt = new Date(Date.now() + h.durationMs).toISOString();

  // Activate all linked experiments
  for (const expId of h.experimentIds) {
    try { transitionExperiment(expId, 'active'); } catch { /* skip if already active */ }
  }

  persist(HACKATHONS_TABLE, id, h);
  eventBus.emit('innovation.hackathon.started', { hackathonId: id, title: h.title, endsAt: h.endsAt });
  return h;
}

export function completeHackathon(id: string): Hackathon {
  const h = hackathons.get(id);
  if (!h) throw new Error(`Hackathon ${id} not found`);
  h.status = 'completed';
  h.completedAt = new Date().toISOString();
  persist(HACKATHONS_TABLE, id, h);
  eventBus.emit('innovation.hackathon.completed', { hackathonId: id, title: h.title });
  return h;
}

export function addExperimentToHackathon(hackathonId: string, experimentId: string): Hackathon {
  const h = hackathons.get(hackathonId);
  if (!h) throw new Error(`Hackathon ${hackathonId} not found`);
  const exp = experiments.get(experimentId);
  if (!exp) throw new Error(`Experiment ${experimentId} not found`);
  if (!h.experimentIds.includes(experimentId)) {
    h.experimentIds.push(experimentId);
    exp.hackathonId = hackathonId;
    exp.timeboxMs = h.durationMs;
    persist(HACKATHONS_TABLE, hackathonId, h);
    persist(EXPERIMENTS_TABLE, experimentId, exp);
  }
  return h;
}

// ---------------------------------------------------------------------------
// Graduation Pipeline
// ---------------------------------------------------------------------------

export function requestGraduation(input: {
  experimentId: string;
  targetRegiment: string;
  targetSkillId?: string;
  proposedBy: string;
}): GraduationRequest {
  const exp = experiments.get(input.experimentId);
  if (!exp) throw new Error(`Experiment ${input.experimentId} not found`);
  if (exp.status !== 'evaluating' && exp.status !== 'active') {
    throw new Error(`Experiment must be active or evaluating to request graduation`);
  }
  const id = `grad-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const req: GraduationRequest = {
    id,
    experimentId: input.experimentId,
    targetRegiment: input.targetRegiment,
    targetSkillId: input.targetSkillId,
    proposedBy: input.proposedBy,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  graduations.set(id, req);
  persist(GRADUATIONS_TABLE, id, req);
  eventBus.emit('innovation.graduation.requested', {
    graduationId: id, experimentId: input.experimentId, targetRegiment: input.targetRegiment,
  });
  return req;
}

export function reviewGraduation(
  id: string,
  decision: 'approved' | 'rejected',
  reviewedBy: string,
  notes?: string,
): GraduationRequest {
  const req = graduations.get(id);
  if (!req) throw new Error(`Graduation request ${id} not found`);
  req.status = decision;
  req.reviewedBy = reviewedBy;
  req.reviewNotes = notes;
  req.reviewedAt = new Date().toISOString();
  persist(GRADUATIONS_TABLE, id, req);

  if (decision === 'approved') {
    try { transitionExperiment(req.experimentId, 'graduated'); } catch { /* ignore */ }
    eventBus.emit('innovation.graduation.approved', { graduationId: id, experimentId: req.experimentId });
  }
  return req;
}

export function listGraduations(status?: GraduationRequest['status']): GraduationRequest[] {
  let list = [...graduations.values()];
  if (status) list = list.filter(g => g.status === status);
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------------------------------------------------------------------------
// Innovation Backlog (aggregated view for C-Suite)
// ---------------------------------------------------------------------------

export function getInnovationBacklog(): {
  total: number;
  byStatus: Record<ExperimentStatus, number>;
  byCategory: Record<ExperimentCategory, number>;
  activeHackathons: number;
  pendingGraduations: number;
  avgScore: number;
  recentExperiments: Experiment[];
} {
  const all = [...experiments.values()];
  const byStatus = { draft: 0, active: 0, evaluating: 0, graduated: 0, archived: 0 };
  const byCategory = { agent: 0, skill: 0, workflow: 0, integration: 0, process: 0 };
  let scoreSum = 0;
  let scoreCount = 0;

  for (const e of all) {
    byStatus[e.status]++;
    byCategory[e.category]++;
    if (e.score !== undefined) { scoreSum += e.score; scoreCount++; }
  }

  return {
    total: all.length,
    byStatus,
    byCategory,
    activeHackathons: [...hackathons.values()].filter(h => h.status === 'active').length,
    pendingGraduations: [...graduations.values()].filter(g => g.status === 'pending').length,
    avgScore: scoreCount > 0 ? Math.round(scoreSum / scoreCount) : 0,
    recentExperiments: all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10),
  };
}
