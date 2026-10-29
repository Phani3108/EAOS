/**
 * Agent Improvement — Performance reviews, improvement plans, feedback loops,
 * and training exemplar management for continuous agent optimization.
 *
 * Builds on top of persona-api.ts retraining flags and KPIs.
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

export type ReviewOutcome = 'exceeds' | 'meets' | 'needs-improvement' | 'underperforming';
export type ImprovementStatus = 'planned' | 'in-progress' | 'completed' | 'abandoned';

export interface PerformanceReview {
  id: string;
  agentId: string;
  callSign: string;
  regiment: string;
  period: string;                   // e.g. "2026-Q1"
  reviewedBy: string;               // userId or C-Suite agentId

  // Metric snapshot at review time
  metrics: {
    totalExecutions: number;
    avgQualityScore: number;
    avgLatencyMs: number;
    avgTokenCost: number;
    handoffSuccessRate: number;
    taskCompletionRate: number;
  };

  // Evaluation
  outcome: ReviewOutcome;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];

  // Scoring
  overallScore: number;             // 1-10
  qualityScore: number;
  efficiencyScore: number;
  reliabilityScore: number;

  createdAt: string;
}

export interface ImprovementPlan {
  id: string;
  agentId: string;
  callSign: string;
  reviewId?: string;                // linked performance review
  status: ImprovementStatus;
  title: string;
  objectives: ImprovementObjective[];
  startDate: string;
  targetDate: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ImprovementObjective {
  id: string;
  description: string;
  metric: string;                   // which KPI to improve
  currentValue: number;
  targetValue: number;
  achieved: boolean;
  notes?: string;
}

export interface FeedbackEntry {
  id: string;
  agentId: string;
  executionId?: string;
  type: 'positive' | 'negative' | 'correction';
  category: 'quality' | 'speed' | 'accuracy' | 'handoff' | 'cost' | 'general';
  feedback: string;
  submittedBy: string;
  createdAt: string;
}

export interface TrainingExemplar {
  id: string;
  agentId: string;
  executionId: string;
  skillName: string;
  rating: 'exemplary' | 'good' | 'cautionary';
  reason: string;
  prompt?: string;
  output?: string;
  submittedBy: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const reviews = new Map<string, PerformanceReview>();
const plans = new Map<string, ImprovementPlan>();
const feedback: FeedbackEntry[] = [];
const exemplars = new Map<string, TrainingExemplar>();

const MAX_FEEDBACK = 1000;
let backingStore: Store | null = null;

const REVIEWS_TABLE = 'performance_reviews';
const PLANS_TABLE = 'improvement_plans';
const FEEDBACK_TABLE = 'agent_feedback';
const EXEMPLARS_TABLE = 'training_exemplars';

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

export async function initImprovementStore(store: Store): Promise<void> {
  backingStore = store;
  try {
    for (const row of await readAll(store, REVIEWS_TABLE)) {
      const r = row as unknown as PerformanceReview;
      if (r.id) reviews.set(r.id, r);
    }
    for (const row of await readAll(store, PLANS_TABLE)) {
      const p = row as unknown as ImprovementPlan;
      if (p.id) plans.set(p.id, p);
    }
    for (const row of await readAll(store, FEEDBACK_TABLE)) {
      const f = row as unknown as FeedbackEntry;
      if (f.id) feedback.push(f);
    }
    for (const row of await readAll(store, EXEMPLARS_TABLE)) {
      const e = row as unknown as TrainingExemplar;
      if (e.id) exemplars.set(e.id, e);
    }
  } catch { /* tables may not exist yet */ }
}

// ---------------------------------------------------------------------------
// Performance Reviews
// ---------------------------------------------------------------------------

export function createReview(input: {
  agentId: string;
  callSign: string;
  regiment: string;
  period: string;
  reviewedBy: string;
  metrics: PerformanceReview['metrics'];
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  overallScore: number;
  qualityScore: number;
  efficiencyScore: number;
  reliabilityScore: number;
}): PerformanceReview {
  const id = `rev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Derive outcome from overall score
  let outcome: ReviewOutcome;
  if (input.overallScore >= 8) outcome = 'exceeds';
  else if (input.overallScore >= 6) outcome = 'meets';
  else if (input.overallScore >= 4) outcome = 'needs-improvement';
  else outcome = 'underperforming';

  const review: PerformanceReview = {
    id,
    ...input,
    outcome,
    createdAt: new Date().toISOString(),
  };
  reviews.set(id, review);
  persist(REVIEWS_TABLE, id, review);
  eventBus.emit('agent.review.created', { reviewId: id, agentId: input.agentId, outcome });
  return review;
}

export function getReview(id: string): PerformanceReview | undefined {
  return reviews.get(id);
}

export function listReviews(agentId?: string): PerformanceReview[] {
  let list = [...reviews.values()];
  if (agentId) list = list.filter(r => r.agentId === agentId);
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ---------------------------------------------------------------------------
// Improvement Plans
// ---------------------------------------------------------------------------

export function createPlan(input: {
  agentId: string;
  callSign: string;
  reviewId?: string;
  title: string;
  objectives: Omit<ImprovementObjective, 'id' | 'achieved'>[];
  targetDate: string;
}): ImprovementPlan {
  const id = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();
  const plan: ImprovementPlan = {
    id,
    agentId: input.agentId,
    callSign: input.callSign,
    reviewId: input.reviewId,
    status: 'planned',
    title: input.title,
    objectives: input.objectives.map(o => ({
      ...o,
      id: `obj-${Math.random().toString(36).slice(2, 7)}`,
      achieved: false,
    })),
    startDate: now,
    targetDate: input.targetDate,
    createdAt: now,
    updatedAt: now,
  };
  plans.set(id, plan);
  persist(PLANS_TABLE, id, plan);
  eventBus.emit('agent.improvement.plan_created', { planId: id, agentId: input.agentId });
  return plan;
}

export function getPlan(id: string): ImprovementPlan | undefined {
  return plans.get(id);
}

export function listPlans(agentId?: string, status?: ImprovementStatus): ImprovementPlan[] {
  let list = [...plans.values()];
  if (agentId) list = list.filter(p => p.agentId === agentId);
  if (status) list = list.filter(p => p.status === status);
  return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function updatePlanStatus(id: string, status: ImprovementStatus): ImprovementPlan {
  const plan = plans.get(id);
  if (!plan) throw new Error(`Plan ${id} not found`);
  plan.status = status;
  plan.updatedAt = new Date().toISOString();
  if (status === 'completed') plan.completedAt = plan.updatedAt;
  persist(PLANS_TABLE, id, plan);
  eventBus.emit(`agent.improvement.plan_${status}`, { planId: id, agentId: plan.agentId });
  return plan;
}

export function updateObjective(planId: string, objectiveId: string, updates: { achieved?: boolean; notes?: string }): ImprovementPlan {
  const plan = plans.get(planId);
  if (!plan) throw new Error(`Plan ${planId} not found`);
  const obj = plan.objectives.find(o => o.id === objectiveId);
  if (!obj) throw new Error(`Objective ${objectiveId} not found`);
  if (updates.achieved !== undefined) obj.achieved = updates.achieved;
  if (updates.notes !== undefined) obj.notes = updates.notes;
  plan.updatedAt = new Date().toISOString();

  // Auto-complete plan if all objectives achieved
  if (plan.objectives.every(o => o.achieved)) {
    plan.status = 'completed';
    plan.completedAt = plan.updatedAt;
    eventBus.emit('agent.improvement.plan_completed', { planId, agentId: plan.agentId });
  }

  persist(PLANS_TABLE, planId, plan);
  return plan;
}

// ---------------------------------------------------------------------------
// Feedback Loop
// ---------------------------------------------------------------------------

export function submitFeedback(input: {
  agentId: string;
  executionId?: string;
  type: FeedbackEntry['type'];
  category: FeedbackEntry['category'];
  feedback: string;
  submittedBy: string;
}): FeedbackEntry {
  const id = `fb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const entry: FeedbackEntry = { id, ...input, createdAt: new Date().toISOString() };
  feedback.push(entry);
  if (feedback.length > MAX_FEEDBACK) feedback.splice(0, feedback.length - MAX_FEEDBACK);
  persist(FEEDBACK_TABLE, id, entry);
  eventBus.emit('agent.feedback.submitted', { feedbackId: id, agentId: input.agentId, type: input.type });
  return entry;
}

export function listFeedback(options?: {
  agentId?: string;
  type?: FeedbackEntry['type'];
  limit?: number;
}): FeedbackEntry[] {
  let list = [...feedback];
  if (options?.agentId) list = list.filter(f => f.agentId === options.agentId);
  if (options?.type) list = list.filter(f => f.type === options.type);
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return list.slice(0, options?.limit ?? 100);
}

export function getFeedbackSummary(agentId: string): {
  total: number;
  positive: number;
  negative: number;
  corrections: number;
  byCategory: Record<string, number>;
  recentTrend: 'improving' | 'stable' | 'declining';
} {
  const entries = feedback.filter(f => f.agentId === agentId);
  const positive = entries.filter(f => f.type === 'positive').length;
  const negative = entries.filter(f => f.type === 'negative').length;
  const corrections = entries.filter(f => f.type === 'correction').length;

  const byCategory: Record<string, number> = {};
  for (const f of entries) {
    byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
  }

  // Trend: compare recent 10 vs previous 10
  const sorted = entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const recent10 = sorted.slice(0, 10);
  const prev10 = sorted.slice(10, 20);
  const recentPos = recent10.filter(f => f.type === 'positive').length;
  const prevPos = prev10.filter(f => f.type === 'positive').length;
  let recentTrend: 'improving' | 'stable' | 'declining' = 'stable';
  if (prev10.length > 0) {
    if (recentPos > prevPos + 1) recentTrend = 'improving';
    else if (recentPos < prevPos - 1) recentTrend = 'declining';
  }

  return { total: entries.length, positive, negative, corrections, byCategory, recentTrend };
}

// ---------------------------------------------------------------------------
// Training Exemplars
// ---------------------------------------------------------------------------

export function addExemplar(input: {
  agentId: string;
  executionId: string;
  skillName: string;
  rating: TrainingExemplar['rating'];
  reason: string;
  prompt?: string;
  output?: string;
  submittedBy: string;
}): TrainingExemplar {
  const id = `ex-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const entry: TrainingExemplar = { id, ...input, createdAt: new Date().toISOString() };
  exemplars.set(id, entry);
  persist(EXEMPLARS_TABLE, id, entry);
  eventBus.emit('agent.exemplar.added', { exemplarId: id, agentId: input.agentId, rating: input.rating });
  return entry;
}

export function listExemplars(options?: {
  agentId?: string;
  rating?: TrainingExemplar['rating'];
}): TrainingExemplar[] {
  let list = [...exemplars.values()];
  if (options?.agentId) list = list.filter(e => e.agentId === options.agentId);
  if (options?.rating) list = list.filter(e => e.rating === options.rating);
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function deleteExemplar(id: string): boolean {
  const existed = exemplars.delete(id);
  if (existed && backingStore) {
    try { backingStore.delete(EXEMPLARS_TABLE, id); } catch { /* ignore */ }
  }
  return existed;
}

// ---------------------------------------------------------------------------
// Agent Health Report (aggregated view)
// ---------------------------------------------------------------------------

export function getAgentHealthReport(): {
  totalReviews: number;
  avgOverallScore: number;
  outcomeDistribution: Record<ReviewOutcome, number>;
  activePlans: number;
  completedPlans: number;
  totalFeedback: number;
  feedbackSentiment: { positive: number; negative: number; corrections: number };
  totalExemplars: number;
  agentsNeedingAttention: string[];
} {
  const allReviews = [...reviews.values()];
  const allPlans = [...plans.values()];

  const outcomeDistribution: Record<ReviewOutcome, number> = {
    exceeds: 0, meets: 0, 'needs-improvement': 0, underperforming: 0,
  };
  let scoreSum = 0;
  for (const r of allReviews) {
    outcomeDistribution[r.outcome]++;
    scoreSum += r.overallScore;
  }

  const positive = feedback.filter(f => f.type === 'positive').length;
  const negative = feedback.filter(f => f.type === 'negative').length;
  const corrections = feedback.filter(f => f.type === 'correction').length;

  // Agents needing attention: underperforming or needs-improvement in most recent review
  const latestByAgent = new Map<string, PerformanceReview>();
  for (const r of allReviews) {
    const existing = latestByAgent.get(r.agentId);
    if (!existing || r.createdAt > existing.createdAt) {
      latestByAgent.set(r.agentId, r);
    }
  }
  const agentsNeedingAttention = [...latestByAgent.values()]
    .filter(r => r.outcome === 'underperforming' || r.outcome === 'needs-improvement')
    .map(r => r.agentId);

  return {
    totalReviews: allReviews.length,
    avgOverallScore: allReviews.length > 0 ? Math.round((scoreSum / allReviews.length) * 10) / 10 : 0,
    outcomeDistribution,
    activePlans: allPlans.filter(p => p.status === 'in-progress' || p.status === 'planned').length,
    completedPlans: allPlans.filter(p => p.status === 'completed').length,
    totalFeedback: feedback.length,
    feedbackSentiment: { positive, negative, corrections },
    totalExemplars: exemplars.size,
    agentsNeedingAttention,
  };
}
