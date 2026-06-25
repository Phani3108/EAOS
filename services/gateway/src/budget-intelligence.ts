/**
 * Budget Intelligence — Per-agent budget allocation, token spend tracking,
 * burn-rate projections, and cost alerts with CFO-level aggregation.
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import type { Store } from './db.js';
import { eventBus } from './event-bus.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BudgetPeriod = 'monthly' | 'quarterly' | 'annual';

export interface AgentBudget {
  agentId: string;
  agentName: string;
  regiment: string;
  period: BudgetPeriod;
  allocatedUsd: number;            // budgeted amount
  spentUsd: number;                // total spend to date in current period
  tokenCount: number;              // total tokens consumed
  taskCount: number;               // total tasks executed
  periodStart: string;
  periodEnd: string;
  alertThresholdPct: number;       // alert when spend exceeds this % of allocated (default 80)
  alertFired: boolean;
  overspendAlertFired: boolean;    // dedupe: overspend (>100%) alert fires once on transition
  createdAt: string;
  updatedAt: string;
}

export interface SpendEntry {
  id: string;
  agentId: string;
  executionId?: string;
  taskDescription: string;
  tokenCount: number;
  costUsd: number;
  model: string;                   // LLM model used
  provider: string;                // LLM provider
  latencyMs: number;
  createdAt: string;
}

export interface BurnRate {
  agentId: string;
  dailyAvgUsd: number;
  weeklyAvgUsd: number;
  projectedMonthEndUsd: number;
  daysUntilBudgetExhausted: number | null;  // null = infinite (under budget trend)
  trend: 'increasing' | 'stable' | 'decreasing';
}

export interface CostAlert {
  id: string;
  type: 'budget_threshold' | 'burn_spike' | 'overspend' | 'unusual_pattern';
  severity: 'info' | 'warning' | 'critical';
  agentId: string;
  message: string;
  acknowledged: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const budgets = new Map<string, AgentBudget>();
const spendLog: SpendEntry[] = [];
const alerts: CostAlert[] = [];

const MAX_SPEND_LOG = 2000;
const MAX_ALERTS = 500;

let backingStore: Store | null = null;
const BUDGETS_TABLE = 'agent_budgets';
const SPEND_TABLE = 'agent_spend_log';
const ALERTS_TABLE = 'cost_alerts';

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

export function initBudgetStore(store: Store): void {
  backingStore = store;
  try {
    for (const row of store.all(BUDGETS_TABLE)) {
      const b = row as unknown as AgentBudget;
      if (b.agentId) budgets.set(b.agentId, b);
    }
    for (const row of store.all(SPEND_TABLE)) {
      const s = row as unknown as SpendEntry;
      if (s.id) spendLog.push(s);
    }
    for (const row of store.all(ALERTS_TABLE)) {
      const a = row as unknown as CostAlert;
      if (a.id) alerts.push(a);
    }
  } catch { /* tables may not exist yet */ }
}

// ---------------------------------------------------------------------------
// Budget CRUD
// ---------------------------------------------------------------------------

export function setBudget(input: {
  agentId: string;
  agentName: string;
  regiment: string;
  period: BudgetPeriod;
  allocatedUsd: number;
  alertThresholdPct?: number;
}): AgentBudget {
  const now = new Date();
  const periodStart = now.toISOString();
  let periodEnd: string;
  if (input.period === 'monthly') {
    periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()).toISOString();
  } else if (input.period === 'quarterly') {
    periodEnd = new Date(now.getFullYear(), now.getMonth() + 3, now.getDate()).toISOString();
  } else {
    periodEnd = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()).toISOString();
  }

  const existing = budgets.get(input.agentId);
  const budget: AgentBudget = {
    agentId: input.agentId,
    agentName: input.agentName,
    regiment: input.regiment,
    period: input.period,
    allocatedUsd: input.allocatedUsd,
    spentUsd: existing?.spentUsd ?? 0,
    tokenCount: existing?.tokenCount ?? 0,
    taskCount: existing?.taskCount ?? 0,
    periodStart,
    periodEnd,
    alertThresholdPct: input.alertThresholdPct ?? 80,
    alertFired: false,
    overspendAlertFired: false,
    createdAt: existing?.createdAt ?? periodStart,
    updatedAt: periodStart,
  };
  budgets.set(input.agentId, budget);
  persist(BUDGETS_TABLE, input.agentId, budget);
  return budget;
}

export function getBudget(agentId: string): AgentBudget | undefined {
  return budgets.get(agentId);
}

export function listBudgets(regiment?: string): AgentBudget[] {
  let list = [...budgets.values()];
  if (regiment) list = list.filter(b => b.regiment === regiment);
  return list.sort((a, b) => b.spentUsd - a.spentUsd);
}

export function deleteBudget(agentId: string): boolean {
  const existed = budgets.delete(agentId);
  if (existed && backingStore) {
    try { backingStore.delete(BUDGETS_TABLE, agentId); } catch { /* ignore */ }
  }
  return existed;
}

// ---------------------------------------------------------------------------
// Spend Recording
// ---------------------------------------------------------------------------

export function recordSpend(input: {
  agentId: string;
  executionId?: string;
  taskDescription: string;
  tokenCount: number;
  costUsd: number;
  model: string;
  provider: string;
  latencyMs: number;
}): SpendEntry {
  const id = `spend-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const entry: SpendEntry = { id, ...input, createdAt: new Date().toISOString() };
  spendLog.push(entry);
  if (spendLog.length > MAX_SPEND_LOG) spendLog.splice(0, spendLog.length - MAX_SPEND_LOG);
  persist(SPEND_TABLE, id, entry);

  // Update budget
  const budget = budgets.get(input.agentId);
  if (budget) {
    budget.spentUsd += input.costUsd;
    budget.tokenCount += input.tokenCount;
    budget.taskCount += 1;
    budget.updatedAt = entry.createdAt;
    persist(BUDGETS_TABLE, input.agentId, budget);

    // Check threshold
    const pct = (budget.spentUsd / budget.allocatedUsd) * 100;
    if (pct >= budget.alertThresholdPct && !budget.alertFired) {
      budget.alertFired = true;
      persist(BUDGETS_TABLE, input.agentId, budget);
      createAlert({
        type: 'budget_threshold',
        severity: pct >= 100 ? 'critical' : 'warning',
        agentId: input.agentId,
        message: `Agent ${budget.agentName} has consumed ${Math.round(pct)}% of its ${budget.period} budget ($${budget.spentUsd.toFixed(2)} / $${budget.allocatedUsd.toFixed(2)})`,
      });
    }
    if (pct >= 100 && !budget.overspendAlertFired) {
      budget.overspendAlertFired = true;
      persist(BUDGETS_TABLE, input.agentId, budget);
      createAlert({
        type: 'overspend',
        severity: 'critical',
        agentId: input.agentId,
        message: `Agent ${budget.agentName} has EXCEEDED its ${budget.period} budget by $${(budget.spentUsd - budget.allocatedUsd).toFixed(2)}`,
      });
    }
  }

  eventBus.emit('budget.spend.recorded', { agentId: input.agentId, costUsd: input.costUsd, tokenCount: input.tokenCount });
  return entry;
}

export function getSpendLog(options?: {
  agentId?: string;
  limit?: number;
}): SpendEntry[] {
  let list = [...spendLog];
  if (options?.agentId) list = list.filter(e => e.agentId === options.agentId);
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return list.slice(0, options?.limit ?? 100);
}

// ---------------------------------------------------------------------------
// Burn Rate Calculations
// ---------------------------------------------------------------------------

export function getBurnRate(agentId: string): BurnRate {
  const entries = spendLog.filter(e => e.agentId === agentId);
  const budget = budgets.get(agentId);
  const now = Date.now();
  const dayMs = 86_400_000;
  const weekMs = 7 * dayMs;

  // Daily average (last 7 days)
  const last7 = entries.filter(e => now - new Date(e.createdAt).getTime() < weekMs);
  const last7Total = last7.reduce((s, e) => s + e.costUsd, 0);
  const dailyAvgUsd = last7.length > 0 ? last7Total / 7 : 0;

  // Weekly average (last 30 days)
  const last30 = entries.filter(e => now - new Date(e.createdAt).getTime() < 30 * dayMs);
  const last30Total = last30.reduce((s, e) => s + e.costUsd, 0);
  const weeklyAvgUsd = last30.length > 0 ? (last30Total / 30) * 7 : 0;

  // Projected month-end spend
  const daysInMonth = 30;
  const projectedMonthEndUsd = dailyAvgUsd * daysInMonth;

  // Days until budget exhausted
  let daysUntilBudgetExhausted: number | null = null;
  if (budget && dailyAvgUsd > 0) {
    const remaining = budget.allocatedUsd - budget.spentUsd;
    daysUntilBudgetExhausted = remaining > 0 ? Math.round(remaining / dailyAvgUsd) : 0;
  }

  // Trend: compare last 3 days vs previous 3 days
  const last3 = entries.filter(e => now - new Date(e.createdAt).getTime() < 3 * dayMs);
  const prev3 = entries.filter(e => {
    const age = now - new Date(e.createdAt).getTime();
    return age >= 3 * dayMs && age < 6 * dayMs;
  });
  const last3Total = last3.reduce((s, e) => s + e.costUsd, 0);
  const prev3Total = prev3.reduce((s, e) => s + e.costUsd, 0);
  let trend: BurnRate['trend'] = 'stable';
  if (prev3Total > 0) {
    const change = (last3Total - prev3Total) / prev3Total;
    if (change > 0.15) trend = 'increasing';
    else if (change < -0.15) trend = 'decreasing';
  }

  return { agentId, dailyAvgUsd, weeklyAvgUsd, projectedMonthEndUsd, daysUntilBudgetExhausted, trend };
}

// ---------------------------------------------------------------------------
// Cost Alerts
// ---------------------------------------------------------------------------

function createAlert(input: {
  type: CostAlert['type'];
  severity: CostAlert['severity'];
  agentId: string;
  message: string;
}): CostAlert {
  const id = `alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const alert: CostAlert = { id, ...input, acknowledged: false, createdAt: new Date().toISOString() };
  alerts.push(alert);
  if (alerts.length > MAX_ALERTS) alerts.splice(0, alerts.length - MAX_ALERTS);
  persist(ALERTS_TABLE, id, alert);
  eventBus.emit('budget.alert', { alertId: id, type: input.type, severity: input.severity, agentId: input.agentId });
  return alert;
}

export function listAlerts(options?: {
  agentId?: string;
  acknowledged?: boolean;
  severity?: CostAlert['severity'];
}): CostAlert[] {
  let list = [...alerts];
  if (options?.agentId) list = list.filter(a => a.agentId === options.agentId);
  if (options?.acknowledged !== undefined) list = list.filter(a => a.acknowledged === options.acknowledged);
  if (options?.severity) list = list.filter(a => a.severity === options.severity);
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function acknowledgeAlert(id: string): boolean {
  const alert = alerts.find(a => a.id === id);
  if (!alert) return false;
  alert.acknowledged = true;
  persist(ALERTS_TABLE, id, alert);
  return true;
}

// ---------------------------------------------------------------------------
// CFO Dashboard Aggregation
// ---------------------------------------------------------------------------

export function getCFODashboard(): {
  totalBudgetUsd: number;
  totalSpentUsd: number;
  totalTokens: number;
  totalTasks: number;
  budgetUtilizationPct: number;
  byRegiment: { regiment: string; allocated: number; spent: number; agents: number }[];
  topSpenders: { agentId: string; agentName: string; spentUsd: number; pct: number }[];
  activeAlerts: number;
  costByProvider: { provider: string; totalUsd: number; tokenCount: number }[];
  costByModel: { model: string; totalUsd: number; tokenCount: number }[];
} {
  const allBudgets = [...budgets.values()];
  const totalBudgetUsd = allBudgets.reduce((s, b) => s + b.allocatedUsd, 0);
  const totalSpentUsd = allBudgets.reduce((s, b) => s + b.spentUsd, 0);
  const totalTokens = allBudgets.reduce((s, b) => s + b.tokenCount, 0);
  const totalTasks = allBudgets.reduce((s, b) => s + b.taskCount, 0);

  // By regiment
  const regimentMap = new Map<string, { allocated: number; spent: number; agents: number }>();
  for (const b of allBudgets) {
    const r = regimentMap.get(b.regiment) ?? { allocated: 0, spent: 0, agents: 0 };
    r.allocated += b.allocatedUsd;
    r.spent += b.spentUsd;
    r.agents += 1;
    regimentMap.set(b.regiment, r);
  }
  const byRegiment = [...regimentMap.entries()].map(([regiment, data]) => ({ regiment, ...data }));

  // Top spenders
  const topSpenders = allBudgets
    .sort((a, b) => b.spentUsd - a.spentUsd)
    .slice(0, 10)
    .map(b => ({
      agentId: b.agentId,
      agentName: b.agentName,
      spentUsd: b.spentUsd,
      pct: b.allocatedUsd > 0 ? Math.round((b.spentUsd / b.allocatedUsd) * 100) : 0,
    }));

  // Cost by provider
  const providerMap = new Map<string, { totalUsd: number; tokenCount: number }>();
  for (const e of spendLog) {
    const p = providerMap.get(e.provider) ?? { totalUsd: 0, tokenCount: 0 };
    p.totalUsd += e.costUsd;
    p.tokenCount += e.tokenCount;
    providerMap.set(e.provider, p);
  }
  const costByProvider = [...providerMap.entries()].map(([provider, data]) => ({ provider, ...data }));

  // Cost by model
  const modelMap = new Map<string, { totalUsd: number; tokenCount: number }>();
  for (const e of spendLog) {
    const m = modelMap.get(e.model) ?? { totalUsd: 0, tokenCount: 0 };
    m.totalUsd += e.costUsd;
    m.tokenCount += e.tokenCount;
    modelMap.set(e.model, m);
  }
  const costByModel = [...modelMap.entries()].map(([model, data]) => ({ model, ...data }));

  return {
    totalBudgetUsd,
    totalSpentUsd,
    totalTokens,
    totalTasks,
    budgetUtilizationPct: totalBudgetUsd > 0 ? Math.round((totalSpentUsd / totalBudgetUsd) * 100) : 0,
    byRegiment,
    topSpenders,
    activeAlerts: alerts.filter(a => !a.acknowledged).length,
    costByProvider,
    costByModel,
  };
}
