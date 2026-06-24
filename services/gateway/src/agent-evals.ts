/**
 * Agent Evals — CipherClaw-inspired evaluation and guardrails engine
 *
 * Tracks agent performance via cognitive fingerprints, drift detection,
 * health scores, breakpoints, and predictive failure analysis.
 *
 * Telemetry model:
 *   • Seed data is random at boot so demos feel lived-in.
 *   • Real telemetry is aggregated from memoryGraph.getExecutions() +
 *     persona-api execution records via `refreshFromTelemetry()`. When no
 *     live executions exist for an agent, we leave the seeded fingerprint
 *     untouched — otherwise we derive accuracy/speed/cost/error from actual
 *     runs. A scheduled tick (every 30s) keeps fingerprints fresh.
 */

import { memoryGraph, type ExecutionRecord } from './memory-graph.js';
import { getAllExecutions } from './persona-api.js';

export interface CognitiveFingerprint {
  accuracy: number;
  speed: number;
  costEfficiency: number;
  toolUsage: number;
  creativity: number;
  consistency: number;
  errorRate: number;
  satisfaction: number;
}

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';
export type AlertType = 'drift' | 'cost' | 'latency' | 'error_rate' | 'token_budget';

export interface EvalAlert {
  id: string;
  agentId: string;
  agentName: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  value: number;
  threshold: number;
  ts: string;
  acknowledged: boolean;
}

export interface Breakpoint {
  type: AlertType;
  threshold: number;
  enabled: boolean;
}

export interface AgentEvalConfig {
  agentId: string;
  agentName: string;
  breakpoints: Breakpoint[];
  baselineFingerprint?: CognitiveFingerprint;
  currentFingerprint: CognitiveFingerprint;
  driftThreshold: number;
  costThreshold?: number;
  tokenThreshold?: number;
  latencyThresholdMs?: number;
  healthScore: number;
  driftScore: number;
  totalExecutions: number;
  lastEvalAt: string;
}

export interface DriftRecord {
  ts: string;
  driftScore: number;
  fingerprint: CognitiveFingerprint;
}

export interface PredictedFailure {
  type: string;
  confidence: number;
  message: string;
}

export interface EvalReport {
  agentId: string;
  healthScore: number;
  fingerprint: CognitiveFingerprint;
  driftScore: number;
  alerts: EvalAlert[];
  predictedFailures: PredictedFailure[];
}

function randomFingerprint(): CognitiveFingerprint {
  return {
    accuracy: 0.7 + Math.random() * 0.25,
    speed: 0.6 + Math.random() * 0.35,
    costEfficiency: 0.5 + Math.random() * 0.4,
    toolUsage: 0.6 + Math.random() * 0.3,
    creativity: 0.4 + Math.random() * 0.5,
    consistency: 0.7 + Math.random() * 0.25,
    errorRate: Math.random() * 0.15,
    satisfaction: 0.7 + Math.random() * 0.25,
  };
}

function computeDrift(baseline: CognitiveFingerprint, current: CognitiveFingerprint): number {
  const keys: (keyof CognitiveFingerprint)[] = ['accuracy', 'speed', 'costEfficiency', 'toolUsage', 'creativity', 'consistency', 'errorRate', 'satisfaction'];
  let sum = 0;
  for (const k of keys) {
    sum += Math.abs(baseline[k] - current[k]);
  }
  return Math.round((sum / keys.length) * 100);
}

function computeHealthScore(fp: CognitiveFingerprint): number {
  const positives = (fp.accuracy + fp.speed + fp.costEfficiency + fp.toolUsage + fp.consistency + fp.satisfaction) / 6;
  const penalty = fp.errorRate * 2;
  return Math.round(Math.max(0, Math.min(100, positives * 100 - penalty * 100)));
}

const SEED_AGENTS: Array<{ id: string; name: string }> = [
  { id: 'prd-agent', name: 'PRD Agent' },
  { id: 'research-agent', name: 'Research Agent' },
  { id: 'code-review-agent', name: 'Code Review Agent' },
  { id: 'campaign-agent', name: 'Campaign Agent' },
  { id: 'copy-agent', name: 'Copy Agent' },
  { id: 'creative-agent', name: 'Creative Agent' },
  { id: 'security-agent', name: 'Security Agent' },
  { id: 'analytics-agent', name: 'Analytics Agent' },
  { id: 'forecasting-agent', name: 'Forecasting Agent' },
  { id: 'recruitment-agent', name: 'Recruitment Agent' },
];

export class AgentEvalsStore {
  private configs = new Map<string, AgentEvalConfig>();
  private driftHistory = new Map<string, DriftRecord[]>();
  private alerts: EvalAlert[] = [];

  constructor() {
    this.seed();
  }

  private seed(): void {
    const now = new Date().toISOString();
    for (const a of SEED_AGENTS) {
      const baseline = randomFingerprint();
      const current = randomFingerprint();
      const drift = computeDrift(baseline, current);
      const health = computeHealthScore(current);
      this.configs.set(a.id, {
        agentId: a.id,
        agentName: a.name,
        breakpoints: [
          { type: 'cost', threshold: 1.0, enabled: true },
          { type: 'latency', threshold: 30000, enabled: true },
          { type: 'error_rate', threshold: 0.15, enabled: true },
          { type: 'token_budget', threshold: 50000, enabled: true },
          { type: 'drift', threshold: 20, enabled: true },
        ],
        baselineFingerprint: baseline,
        currentFingerprint: current,
        driftThreshold: 15,
        costThreshold: 1.0,
        tokenThreshold: 50000,
        latencyThresholdMs: 30000,
        healthScore: health,
        driftScore: drift,
        totalExecutions: 20 + Math.floor(Math.random() * 100),
        lastEvalAt: now,
      });

      const history: DriftRecord[] = [];
      for (let i = 10; i >= 0; i--) {
        const ts = new Date(Date.now() - i * 86400000).toISOString();
        const fp = randomFingerprint();
        history.push({ ts, driftScore: computeDrift(baseline, fp), fingerprint: fp });
      }
      this.driftHistory.set(a.id, history);

      if (drift > 15) {
        this.alerts.push({
          id: `alert-${a.id}-drift`,
          agentId: a.id,
          agentName: a.name,
          type: 'drift',
          severity: drift > 30 ? 'critical' : drift > 20 ? 'high' : 'medium',
          message: `${a.name} cognitive drift at ${drift}% (threshold: 15%)`,
          value: drift,
          threshold: 15,
          ts: now,
          acknowledged: false,
        });
      }
      if (current.errorRate > 0.1) {
        this.alerts.push({
          id: `alert-${a.id}-error`,
          agentId: a.id,
          agentName: a.name,
          type: 'error_rate',
          severity: current.errorRate > 0.12 ? 'high' : 'medium',
          message: `${a.name} error rate at ${(current.errorRate * 100).toFixed(1)}%`,
          value: current.errorRate,
          threshold: 0.1,
          ts: now,
          acknowledged: false,
        });
      }
    }
  }

  getAllConfigs(): AgentEvalConfig[] {
    return Array.from(this.configs.values());
  }

  getConfig(agentId: string): AgentEvalConfig | undefined {
    return this.configs.get(agentId);
  }

  updateConfig(agentId: string, updates: Partial<AgentEvalConfig>): AgentEvalConfig | undefined {
    const cfg = this.configs.get(agentId);
    if (!cfg) return undefined;
    const updated = { ...cfg, ...updates, lastEvalAt: new Date().toISOString() };
    this.configs.set(agentId, updated);
    return updated;
  }

  getReport(agentId: string): EvalReport | undefined {
    const cfg = this.configs.get(agentId);
    if (!cfg) return undefined;

    const agentAlerts = this.alerts.filter(a => a.agentId === agentId);
    const predictions: PredictedFailure[] = [];

    if (cfg.currentFingerprint.errorRate > 0.08) {
      predictions.push({
        type: 'error_spike',
        confidence: 0.6 + cfg.currentFingerprint.errorRate * 2,
        message: `Error rate trending up — predicted spike within 24h`,
      });
    }
    if (cfg.driftScore > cfg.driftThreshold * 0.8) {
      predictions.push({
        type: 'drift_threshold',
        confidence: 0.7,
        message: `Drift approaching threshold (${cfg.driftScore}% / ${cfg.driftThreshold}%)`,
      });
    }
    if (cfg.currentFingerprint.costEfficiency < 0.5) {
      predictions.push({
        type: 'cost_overrun',
        confidence: 0.55,
        message: 'Cost efficiency below 50% — budget exhaustion risk',
      });
    }

    return {
      agentId,
      healthScore: cfg.healthScore,
      fingerprint: cfg.currentFingerprint,
      driftScore: cfg.driftScore,
      alerts: agentAlerts,
      predictedFailures: predictions,
    };
  }

  getDriftHistory(agentId: string): DriftRecord[] {
    return this.driftHistory.get(agentId) || [];
  }

  setBaseline(agentId: string): AgentEvalConfig | undefined {
    const cfg = this.configs.get(agentId);
    if (!cfg) return undefined;
    cfg.baselineFingerprint = { ...cfg.currentFingerprint };
    cfg.driftScore = 0;
    cfg.lastEvalAt = new Date().toISOString();
    this.configs.set(agentId, cfg);
    this.alerts = this.alerts.filter(a => !(a.agentId === agentId && a.type === 'drift'));
    return cfg;
  }

  getAlerts(agentId?: string): EvalAlert[] {
    if (agentId) return this.alerts.filter(a => a.agentId === agentId);
    return [...this.alerts];
  }

  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (!alert) return false;
    alert.acknowledged = true;
    return true;
  }

  getDashboard(): {
    totalAgents: number;
    avgHealthScore: number;
    activeAlerts: number;
    driftingAgents: number;
    agents: AgentEvalConfig[];
  } {
    const agents = this.getAllConfigs();
    const avgHealth = agents.length > 0
      ? Math.round(agents.reduce((s, a) => s + a.healthScore, 0) / agents.length)
      : 0;
    return {
      totalAgents: agents.length,
      avgHealthScore: avgHealth,
      activeAlerts: this.alerts.filter(a => !a.acknowledged).length,
      driftingAgents: agents.filter(a => a.driftScore > a.driftThreshold).length,
      agents,
    };
  }

  _exportData() {
    return {
      configs: Array.from(this.configs.entries()),
      driftHistory: Array.from(this.driftHistory.entries()),
      alerts: this.alerts,
    };
  }

  _importData(data: { configs?: [string, AgentEvalConfig][]; driftHistory?: [string, DriftRecord[]][]; alerts?: EvalAlert[] }) {
    if (data.configs) { this.configs = new Map(data.configs); }
    if (data.driftHistory) { this.driftHistory = new Map(data.driftHistory); }
    if (data.alerts) { this.alerts = data.alerts; }
  }

  /**
   * Fold live execution telemetry from memoryGraph + persona-api into the
   * current fingerprints. This runs periodically and on-demand so the eval
   * dashboard reflects actual agent behavior rather than the random seed.
   *
   * Aggregation rules per agent:
   *   • accuracy   = successCount / totalExecutions
   *   • speed      = normalized inverse of mean runtime (1.0 for <10s, 0.2 for >60s)
   *   • costEff    = normalized inverse of mean cost (1.0 for <$0.05, 0.2 for >$1)
   *   • errorRate  = failureCount / totalExecutions
   *   • others     = retained from seed (creativity/consistency/satisfaction
   *                  are qualitative and need human rating, not telemetry)
   */
  refreshFromTelemetry(): void {
    const executions = memoryGraph.getExecutions(undefined, undefined, 500);
    // Pull persona execution records too (agent-level KPIs live there).
    const personaExecs = safeGetPersonaExecs();

    // Tally per-agent stats. Added fields (tools, distinct outputs, runtime
    // samples) let us derive the 4 remaining fingerprint dimensions:
    //   • toolUsage   = avg distinct tools / run (normalized)
    //   • consistency = 1 - coefficient-of-variation of runtime
    //   • satisfaction = up-votes share across skills this agent contributed to
    //   • creativity  = distinct-output ratio (unique outputs / total outputs)
    type Tally = {
      runs: number;
      successes: number;
      failures: number;
      totalRuntime: number;
      totalCost: number;
      runtimeSamples: number[];
      toolSamples: number[];
      outputSamples: string[];
      skillIds: Set<string>;
    };
    const tally = new Map<string, Tally>();

    const bump = (agentId: string, t: Partial<Tally> & { runtime?: number; tools?: number; output?: string; skillId?: string }) => {
      const prev = tally.get(agentId) ?? {
        runs: 0, successes: 0, failures: 0, totalRuntime: 0, totalCost: 0,
        runtimeSamples: [], toolSamples: [], outputSamples: [], skillIds: new Set<string>(),
      };
      if (t.runtime !== undefined) prev.runtimeSamples.push(t.runtime);
      if (t.tools !== undefined) prev.toolSamples.push(t.tools);
      if (t.output) prev.outputSamples.push(t.output);
      if (t.skillId) prev.skillIds.add(t.skillId);
      tally.set(agentId, {
        runs: prev.runs + (t.runs ?? 0),
        successes: prev.successes + (t.successes ?? 0),
        failures: prev.failures + (t.failures ?? 0),
        totalRuntime: prev.totalRuntime + (t.totalRuntime ?? 0),
        totalCost: prev.totalCost + (t.totalCost ?? 0),
        runtimeSamples: prev.runtimeSamples,
        toolSamples: prev.toolSamples,
        outputSamples: prev.outputSamples,
        skillIds: prev.skillIds,
      });
    };

    for (const e of executions) {
      const distinctTools = new Set(e.toolsUsed).size;
      for (const agent of e.agentsUsed) {
        bump(agent, {
          runs: 1,
          successes: e.success ? 1 : 0,
          failures: e.success ? 0 : 1,
          totalRuntime: e.runtimeSec,
          totalCost: e.cost,
          runtime: e.runtimeSec,
          tools: distinctTools,
          output: (e.outputs?.[0] ?? '').slice(0, 200),
          skillId: e.skillId,
        });
      }
    }

    for (const pe of personaExecs) {
      for (const step of pe.steps ?? []) {
        const agent = step.agent;
        if (!agent) continue;
        const success = step.status === 'completed';
        bump(agent, {
          runs: 1,
          successes: success ? 1 : 0,
          failures: success ? 0 : 1,
          totalRuntime: (step.latencyMs ?? 0) / 1000,
          totalCost: step.tokenCost ?? 0,
          runtime: (step.latencyMs ?? 0) / 1000,
          tools: (step as { tool?: unknown }).tool ? 1 : 0,
        });
      }
    }

    // Compute satisfaction per agent from feedback votes on skills they worked on.
    const satisfactionByAgent = computeSatisfactionByAgent(tally);

    // Update each configured agent.
    const now = new Date().toISOString();
    for (const [agentId, cfg] of this.configs) {
      const t = tally.get(agentId);
      if (!t || t.runs === 0) continue;
      const accuracy = t.successes / t.runs;
      const errorRate = t.failures / t.runs;
      const meanRuntime = t.totalRuntime / t.runs;
      const meanCost = t.totalCost / t.runs;
      const speed = normalize(60 - meanRuntime, 0, 60); // 60s+ → 0, 0s → 1
      const costEfficiency = normalize(1 - meanCost, 0, 1); // $1 → 0, $0 → 1

      // Remaining 4 dims — derived from available signal (no more random).
      const meanTools = t.toolSamples.length
        ? t.toolSamples.reduce((a, b) => a + b, 0) / t.toolSamples.length
        : 0;
      const toolUsage = normalize(meanTools, 0, 3); // 3+ tools per run → saturated

      const consistency = stabilityScore(t.runtimeSamples);
      const creativity = uniquenessScore(t.outputSamples);
      const satisfaction = satisfactionByAgent.get(agentId) ?? cfg.currentFingerprint.satisfaction;

      const derived: CognitiveFingerprint = {
        accuracy: clamp(accuracy),
        errorRate: clamp(errorRate),
        speed: clamp(speed),
        costEfficiency: clamp(costEfficiency),
        toolUsage: clamp(toolUsage),
        consistency: clamp(consistency),
        creativity: clamp(creativity),
        satisfaction: clamp(satisfaction),
      };

      const driftScore = cfg.baselineFingerprint
        ? computeDrift(cfg.baselineFingerprint, derived)
        : 0;
      const healthScore = computeHealthScore(derived);

      this.configs.set(agentId, {
        ...cfg,
        currentFingerprint: derived,
        totalExecutions: t.runs,
        driftScore,
        healthScore,
        lastEvalAt: now,
      });

      // Record drift history point (cap at 50 per agent).
      const hist = this.driftHistory.get(agentId) ?? [];
      hist.push({ ts: now, driftScore, fingerprint: derived });
      if (hist.length > 50) hist.splice(0, hist.length - 50);
      this.driftHistory.set(agentId, hist);

      // Fire alerts if thresholds crossed — de-dup by (agentId,type).
      if (driftScore > cfg.driftThreshold) {
        this.upsertAlert({
          id: `alert-${agentId}-drift`,
          agentId,
          agentName: cfg.agentName,
          type: 'drift',
          severity: driftScore > cfg.driftThreshold * 2 ? 'critical' : driftScore > cfg.driftThreshold * 1.5 ? 'high' : 'medium',
          message: `${cfg.agentName} cognitive drift at ${driftScore}% (threshold: ${cfg.driftThreshold}%)`,
          value: driftScore,
          threshold: cfg.driftThreshold,
          ts: now,
          acknowledged: false,
        });
      }
      const errorThr = cfg.breakpoints.find(b => b.type === 'error_rate')?.threshold ?? 0.15;
      if (errorRate > errorThr) {
        this.upsertAlert({
          id: `alert-${agentId}-error`,
          agentId,
          agentName: cfg.agentName,
          type: 'error_rate',
          severity: errorRate > errorThr * 1.5 ? 'high' : 'medium',
          message: `${cfg.agentName} error rate at ${(errorRate * 100).toFixed(1)}% (threshold: ${(errorThr * 100).toFixed(0)}%)`,
          value: errorRate,
          threshold: errorThr,
          ts: now,
          acknowledged: false,
        });
      }

      // Cost breakpoint — alert when mean $/run exceeds the breakpoint.
      const costBp = cfg.breakpoints.find(b => b.type === 'cost' && b.enabled);
      if (costBp && meanCost > costBp.threshold) {
        this.upsertAlert({
          id: `alert-${agentId}-cost`,
          agentId,
          agentName: cfg.agentName,
          type: 'cost',
          severity: meanCost > costBp.threshold * 2 ? 'critical' : 'high',
          message: `${cfg.agentName} avg cost $${meanCost.toFixed(2)}/run exceeds $${costBp.threshold}`,
          value: meanCost,
          threshold: costBp.threshold,
          ts: now,
          acknowledged: false,
        });
      }

      // Latency breakpoint — alert when mean latency exceeds threshold.
      const latBp = cfg.breakpoints.find(b => b.type === 'latency' && b.enabled);
      const meanLatencyMs = meanRuntime * 1000;
      if (latBp && meanLatencyMs > latBp.threshold) {
        this.upsertAlert({
          id: `alert-${agentId}-latency`,
          agentId,
          agentName: cfg.agentName,
          type: 'latency',
          severity: meanLatencyMs > latBp.threshold * 2 ? 'critical' : 'high',
          message: `${cfg.agentName} avg latency ${meanLatencyMs.toFixed(0)}ms exceeds ${latBp.threshold}ms`,
          value: meanLatencyMs,
          threshold: latBp.threshold,
          ts: now,
          acknowledged: false,
        });
      }
    }
  }

  private upsertAlert(alert: EvalAlert): void {
    const existingIdx = this.alerts.findIndex(a => a.id === alert.id);
    if (existingIdx >= 0) {
      // Preserve acknowledged state if already seen, update other fields
      const wasAck = this.alerts[existingIdx].acknowledged;
      this.alerts[existingIdx] = { ...alert, acknowledged: wasAck };
    } else {
      this.alerts.push(alert);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(x: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, x));
}

function normalize(x: number, min: number, max: number): number {
  return clamp((x - min) / (max - min));
}

/**
 * Runtime stability score — 1 - (stddev / mean), clamped to [0,1].
 * Low variance across runs → 1. High variance → closer to 0.
 * Used as "consistency" fingerprint dimension.
 */
function stabilityScore(samples: number[]): number {
  if (samples.length < 2) return 0.7; // default when insufficient signal
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  if (mean === 0) return 1;
  const variance = samples.reduce((sum, x) => sum + (x - mean) ** 2, 0) / samples.length;
  const stddev = Math.sqrt(variance);
  const cv = stddev / mean;
  return clamp(1 - cv);
}

/**
 * Output uniqueness — distinct output prefixes / total. Proxy for creativity.
 * Agents that produce the same answer every time score low; agents that vary
 * their outputs (in appropriate contexts) score higher. Crude but directional.
 */
function uniquenessScore(samples: string[]): number {
  if (samples.length < 2) return 0.5;
  const distinct = new Set(samples.map(s => s.slice(0, 80))).size;
  return clamp(distinct / samples.length);
}

/**
 * Derive per-agent satisfaction from skill-level up/down votes.
 * An agent's satisfaction = mean of (up - down) / total across skills it
 * contributed to. Falls back to 0.7 when an agent has no votes yet.
 */
function computeSatisfactionByAgent(
  tally: Map<string, { skillIds: Set<string> }>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [agentId, t] of tally) {
    if (t.skillIds.size === 0) continue;
    let cumulative = 0;
    let counted = 0;
    for (const skillId of t.skillIds) {
      const votes = memoryGraph.getSkillVotes(skillId);
      const total = votes.up + votes.down;
      if (total === 0) continue;
      const score = (votes.up - votes.down) / total; // -1..1
      cumulative += (score + 1) / 2;                 //  0..1
      counted++;
    }
    if (counted > 0) out.set(agentId, cumulative / counted);
  }
  return out;
}

/**
 * Safely fetch persona execution records. persona-api has a circular init
 * dependency risk at module load, so we defensively try/catch.
 */
function safeGetPersonaExecs(): Array<{ steps?: Array<{ agent?: string; status: string; latencyMs?: number; tokenCost?: number }> }> {
  try {
    return getAllExecutions() as unknown as Array<{ steps?: Array<{ agent?: string; status: string; latencyMs?: number; tokenCost?: number }> }>;
  } catch {
    return [];
  }
}

// Re-export types referenced by the consumer of refresh.
export type { ExecutionRecord };

export const agentEvalsStore = new AgentEvalsStore();

// Periodic telemetry refresh — every 30s. Safe no-op when no executions.
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    try {
      agentEvalsStore.refreshFromTelemetry();
    } catch (err) {
      console.warn('[agent-evals] telemetry refresh failed:', (err as Error).message);
    }
  }, 30_000);
}
