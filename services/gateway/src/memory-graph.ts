/**
 * AgentOS Memory Graph — Platform intelligence layer
 *
 * Stores execution history, user feedback, and powers recommendations.
 * Graph structure: users → skills → agents → tools → executions → outputs
 */

import { skillMarketplace } from './skill-marketplace.js';
import type { MarketplaceSkill } from './skill-marketplace.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionRecord {
  id: string;
  userId: string;
  userName?: string;
  skillId: string;
  skillName: string;
  personaId: string;
  success: boolean;
  runtimeSec: number;
  cost: number;
  agentsUsed: string[];
  toolsUsed: string[];
  outputs: string[];
  ts: string;
  // ── Data-moat enrichment (v2) ──────────────────────────────────
  // Populated when available; backward-compatible (all optional) so
  // existing callers keep working while new code paths fill these in.
  /**
   * Set when the run failed for an infrastructure reason (provider outage,
   * missing credential, budget cap, open circuit) rather than because the skill
   * itself performed badly.
   *
   * Such a run measures the provider, not the skill. Letting it into the
   * benchmark corpus or a skill success rate would attribute our downtime to the
   * skill's quality.
   */
  infraFailure?: boolean;
  modelProvider?: string;     // e.g. 'anthropic' | 'openai' | 'azure-openai'
  modelId?: string;           // e.g. 'claude-3-5-sonnet-20241022'
  promptTokens?: number;
  completionTokens?: number;
  /** 0..5 human/user-rated quality. Undefined = not yet rated. */
  qualityScore?: number;
  /** 'approved'|'rejected'|'auto' — outcome of gated approval step, if any. */
  approvalOutcome?: 'approved' | 'rejected' | 'auto';
  /** True if the user re-ran or edited the output. Signal of low quality. */
  reworked?: boolean;
  /** Simulation mode flag — excluded from benchmark datasets. */
  simulated?: boolean;
}

export interface SkillFeedback {
  skillId: string;
  userId: string;
  userName?: string;
  vote: 'up' | 'down';
  comment?: string;
  ts: string;
}

export interface SkillComment {
  id: string;
  skillId: string;
  userId: string;
  userName: string;
  content: string;
  ts: string;
  parentId?: string;
}

export interface Recommendation {
  skillId: string;
  skill: MarketplaceSkill;
  score: number;
  reason: 'popular' | 'persona_match' | 'recent_success' | 'high_rating';
}

// ── Enhanced Memory Types (Phase 2) ─────────────────────────────

/** Decision trace — why an agent chose X over Y */
export interface DecisionTrace {
  id: string;
  taskRef: string;        // UTCP task_id
  agentId: string;
  agentName: string;
  decision: string;       // What was decided
  alternatives: string[]; // What was considered
  rationale: string;      // Why this choice
  confidence: number;
  evidence: string[];     // Sources/data used
  outcome?: 'correct' | 'incorrect' | 'partial' | 'pending';
  humanCorrection?: string;
  ts: string;
}

/** Agent performance record */
export interface AgentPerformance {
  agentId: string;
  agentName: string;
  regiment: string;
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  avgConfidence: number;
  avgLatencyMs: number;
  avgCostUsd: number;
  totalTokens: number;
  humanOverrideRate: number;
  topSkills: { skillId: string; count: number; successRate: number }[];
  lastActive: string;
}

/** Human correction on agent output */
export interface CorrectionRecord {
  id: string;
  taskRef: string;
  agentId: string;
  stepIndex: number;
  originalOutput: string;
  correctedOutput: string;
  correctionType: 'factual' | 'tone' | 'scope' | 'format' | 'policy' | 'other';
  severity: 'minor' | 'moderate' | 'critical';
  userId: string;
  ts: string;
}

/** Prompt performance tracking */
export interface PromptPerformance {
  promptId: string;
  skillId: string;
  version: number;
  totalUses: number;
  avgConfidence: number;
  avgQualityScore: number;
  correctionRate: number;
  lastUsed: string;
}

/** Entity relationship in the organizational graph */
export interface GraphEntity {
  id: string;
  type: 'agent' | 'skill' | 'tool' | 'workflow' | 'user' | 'persona' | 'execution';
  name: string;
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  relationship: 'uses' | 'produces' | 'consumes' | 'delegates_to' | 'reviews' | 'improves' | 'depends_on' | 'collaborates_with';
  weight: number;
  lastSeen: string;
}

// ---------------------------------------------------------------------------
// In-memory store (would be Neo4j/RedisGraph in production)
// ---------------------------------------------------------------------------

const executions: ExecutionRecord[] = [];
const feedback: SkillFeedback[] = [];
const comments: SkillComment[] = [];
const decisionTraces: DecisionTrace[] = [];
const corrections: CorrectionRecord[] = [];
const agentPerf = new Map<string, AgentPerformance>();
const promptPerf = new Map<string, PromptPerformance>();
const entities = new Map<string, GraphEntity>();
const edges: GraphEdge[] = [];

// ---------------------------------------------------------------------------
// Memory Graph
// ---------------------------------------------------------------------------

export class MemoryGraph {
  recordExecution(record: Omit<ExecutionRecord, 'id' | 'ts'>): ExecutionRecord {
    const id = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const rec: ExecutionRecord = { ...record, id, ts: new Date().toISOString() };
    executions.push(rec);
    return rec;
  }

  getExecutions(userId?: string, skillId?: string, limit = 50): ExecutionRecord[] {
    let list = [...executions].reverse();
    if (userId) list = list.filter((e) => e.userId === userId);
    if (skillId) list = list.filter((e) => e.skillId === skillId);
    return list.slice(0, limit);
  }

  addFeedback(skillId: string, userId: string, vote: 'up' | 'down', userName?: string, comment?: string): SkillFeedback {
    const existing = feedback.find((f) => f.skillId === skillId && f.userId === userId);
    if (existing) {
      existing.vote = vote;
      existing.comment = comment;
      existing.ts = new Date().toISOString();
      return existing;
    }
    const f: SkillFeedback = { skillId, userId, userName, vote, comment, ts: new Date().toISOString() };
    feedback.push(f);
    return f;
  }

  getFeedback(skillId?: string): SkillFeedback[] {
    if (skillId) return feedback.filter((f) => f.skillId === skillId);
    return [...feedback];
  }

  getSkillVotes(skillId: string): { up: number; down: number } {
    const forSkill = feedback.filter((f) => f.skillId === skillId);
    return {
      up: forSkill.filter((f) => f.vote === 'up').length,
      down: forSkill.filter((f) => f.vote === 'down').length,
    };
  }

  addComment(skillId: string, userId: string, userName: string, content: string, parentId?: string): SkillComment {
    const id = `comment-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const c: SkillComment = { id, skillId, userId, userName, content, ts: new Date().toISOString(), parentId };
    comments.push(c);
    return c;
  }

  getComments(skillId: string): SkillComment[] {
    return comments.filter((c) => c.skillId === skillId).sort((a, b) => a.ts.localeCompare(b.ts));
  }

  /**
   * Recommendation engine: suggest skills based on memory graph.
   */
  getRecommendations(userId?: string, personaId?: string, limit = 6): Recommendation[] {
    const allSkills = skillMarketplace.getAllSkills(personaId);
    const scored: Array<{ skill: MarketplaceSkill; score: number; reason: Recommendation['reason'] }> = [];

    for (const skill of allSkills) {
      const votes = this.getSkillVotes(skill.id);
      const execs = executions.filter((e) => e.skillId === skill.id);
      const successRate = execs.length > 0 ? execs.filter((e) => e.success).length / execs.length : 0.5;

      let score = 0;
      let reason: Recommendation['reason'] = 'persona_match';

      if (skill.usageCount && skill.usageCount > 20) {
        score += skill.usageCount * 0.01;
        reason = 'popular';
      }
      if (votes.up > votes.down && votes.up >= 3) {
        score += (votes.up - votes.down) * 0.5;
        reason = 'high_rating';
      }
      if (execs.length > 0 && successRate > 0.8) {
        score += successRate * 2;
        reason = 'recent_success';
      }
      if (personaId && skill.personaId === personaId) {
        score += 1;
      }

      scored.push({ skill, score, reason });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => ({
      skillId: s.skill.id,
      skill: s.skill,
      score: s.score,
      reason: s.reason,
    }));
  }

  getStats(): {
    totalExecutions: number;
    totalFeedback: number;
    totalComments: number;
    successRate: number;
  } {
    const totalExecutions = executions.length;
    const successCount = executions.filter((e) => e.success).length;
    return {
      totalExecutions,
      totalFeedback: feedback.length,
      totalComments: comments.length,
      successRate: totalExecutions > 0 ? successCount / totalExecutions : 0,
    };
  }

  // -----------------------------------------------------------------------
  // Decision Traces
  // -----------------------------------------------------------------------

  recordDecision(record: Omit<DecisionTrace, 'id' | 'ts'>): DecisionTrace {
    const id = `dec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const trace: DecisionTrace = { ...record, id, ts: new Date().toISOString() };
    decisionTraces.push(trace);
    return trace;
  }

  getDecisionTraces(taskRef?: string, agentId?: string, limit = 50): DecisionTrace[] {
    let list = [...decisionTraces].reverse();
    if (taskRef) list = list.filter(d => d.taskRef === taskRef);
    if (agentId) list = list.filter(d => d.agentId === agentId);
    return list.slice(0, limit);
  }

  markDecisionOutcome(decisionId: string, outcome: DecisionTrace['outcome'], humanCorrection?: string): void {
    const trace = decisionTraces.find(d => d.id === decisionId);
    if (trace) {
      trace.outcome = outcome;
      trace.humanCorrection = humanCorrection;
    }
  }

  // -----------------------------------------------------------------------
  // Corrections
  // -----------------------------------------------------------------------

  recordCorrection(record: Omit<CorrectionRecord, 'id' | 'ts'>): CorrectionRecord {
    const id = `corr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const corr: CorrectionRecord = { ...record, id, ts: new Date().toISOString() };
    corrections.push(corr);
    // Update agent performance
    this._updateAgentCorrection(record.agentId);
    return corr;
  }

  getCorrections(agentId?: string, taskRef?: string, limit = 50): CorrectionRecord[] {
    let list = [...corrections].reverse();
    if (agentId) list = list.filter(c => c.agentId === agentId);
    if (taskRef) list = list.filter(c => c.taskRef === taskRef);
    return list.slice(0, limit);
  }

  getCorrectionRate(agentId: string): number {
    const agentExecs = executions.filter(e => e.agentsUsed.includes(agentId));
    const agentCorrs = corrections.filter(c => c.agentId === agentId);
    return agentExecs.length > 0 ? agentCorrs.length / agentExecs.length : 0;
  }

  // -----------------------------------------------------------------------
  // Agent Performance
  // -----------------------------------------------------------------------

  updateAgentPerformance(agentId: string, agentName: string, regiment: string, execution: {
    success: boolean; confidence: number; latencyMs: number; costUsd: number; tokens: number; skillId: string;
  }): AgentPerformance {
    const existing = agentPerf.get(agentId) || {
      agentId, agentName, regiment,
      totalExecutions: 0, successCount: 0, failureCount: 0,
      avgConfidence: 0, avgLatencyMs: 0, avgCostUsd: 0, totalTokens: 0,
      humanOverrideRate: 0, topSkills: [], lastActive: '',
    };

    const n = existing.totalExecutions;
    const updated: AgentPerformance = {
      ...existing,
      totalExecutions: n + 1,
      successCount: existing.successCount + (execution.success ? 1 : 0),
      failureCount: existing.failureCount + (execution.success ? 0 : 1),
      avgConfidence: (existing.avgConfidence * n + execution.confidence) / (n + 1),
      avgLatencyMs: (existing.avgLatencyMs * n + execution.latencyMs) / (n + 1),
      avgCostUsd: (existing.avgCostUsd * n + execution.costUsd) / (n + 1),
      totalTokens: existing.totalTokens + execution.tokens,
      lastActive: new Date().toISOString(),
    };

    // Update top skills
    const skillEntry = updated.topSkills.find(s => s.skillId === execution.skillId);
    if (skillEntry) {
      skillEntry.count++;
      skillEntry.successRate = (skillEntry.successRate * (skillEntry.count - 1) + (execution.success ? 1 : 0)) / skillEntry.count;
    } else {
      updated.topSkills.push({ skillId: execution.skillId, count: 1, successRate: execution.success ? 1 : 0 });
    }
    updated.topSkills.sort((a, b) => b.count - a.count);
    if (updated.topSkills.length > 10) updated.topSkills = updated.topSkills.slice(0, 10);

    agentPerf.set(agentId, updated);
    return updated;
  }

  getAgentPerformance(agentId: string): AgentPerformance | undefined {
    return agentPerf.get(agentId);
  }

  getAllAgentPerformance(): AgentPerformance[] {
    return Array.from(agentPerf.values()).sort((a, b) => b.totalExecutions - a.totalExecutions);
  }

  getTopAgents(metric: 'success' | 'speed' | 'cost' | 'volume', limit = 10): AgentPerformance[] {
    const all = this.getAllAgentPerformance();
    switch (metric) {
      case 'success': return all.sort((a, b) => (b.successCount / (b.totalExecutions || 1)) - (a.successCount / (a.totalExecutions || 1))).slice(0, limit);
      case 'speed': return all.sort((a, b) => a.avgLatencyMs - b.avgLatencyMs).slice(0, limit);
      case 'cost': return all.sort((a, b) => a.avgCostUsd - b.avgCostUsd).slice(0, limit);
      case 'volume': return all.sort((a, b) => b.totalExecutions - a.totalExecutions).slice(0, limit);
      default: return all.slice(0, limit);
    }
  }

  private _updateAgentCorrection(agentId: string): void {
    const perf = agentPerf.get(agentId);
    if (perf) {
      perf.humanOverrideRate = this.getCorrectionRate(agentId);
      agentPerf.set(agentId, perf);
    }
  }

  // -----------------------------------------------------------------------
  // Entity Graph
  // -----------------------------------------------------------------------

  addEntity(entity: GraphEntity): void { entities.set(entity.id, entity); }

  getEntity(id: string): GraphEntity | undefined { return entities.get(id); }

  addEdge(edge: GraphEdge): void {
    const existing = edges.find(e => e.source === edge.source && e.target === edge.target && e.relationship === edge.relationship);
    if (existing) {
      existing.weight += edge.weight;
      existing.lastSeen = new Date().toISOString();
    } else {
      edges.push({ ...edge, lastSeen: new Date().toISOString() });
    }
  }

  getEntityGraph(entityId: string, depth = 1): { entities: GraphEntity[]; edges: GraphEdge[] } {
    const visited = new Set<string>();
    const resultEntities: GraphEntity[] = [];
    const resultEdges: GraphEdge[] = [];

    const traverse = (id: string, currentDepth: number) => {
      if (visited.has(id) || currentDepth > depth) return;
      visited.add(id);
      const entity = entities.get(id);
      if (entity) resultEntities.push(entity);

      const connected = edges.filter(e => e.source === id || e.target === id);
      for (const edge of connected) {
        resultEdges.push(edge);
        const nextId = edge.source === id ? edge.target : edge.source;
        traverse(nextId, currentDepth + 1);
      }
    };

    traverse(entityId, 0);
    return { entities: resultEntities, edges: resultEdges };
  }

  getFullGraph(): { entities: GraphEntity[]; edges: GraphEdge[] } {
    return { entities: Array.from(entities.values()), edges: [...edges] };
  }

  /** Auto-build entity graph from execution records */
  buildGraphFromExecution(record: ExecutionRecord): void {
    // Add entities
    this.addEntity({ id: record.userId, type: 'user', name: record.userName || record.userId, metadata: {} });
    this.addEntity({ id: record.skillId, type: 'skill', name: record.skillName, metadata: { personaId: record.personaId } });
    for (const agent of record.agentsUsed) {
      this.addEntity({ id: agent, type: 'agent', name: agent, metadata: {} });
    }
    for (const tool of record.toolsUsed) {
      this.addEntity({ id: tool, type: 'tool', name: tool, metadata: {} });
    }

    // Add edges
    this.addEdge({ source: record.userId, target: record.skillId, relationship: 'uses', weight: 1, lastSeen: record.ts });
    for (const agent of record.agentsUsed) {
      this.addEdge({ source: record.skillId, target: agent, relationship: 'delegates_to', weight: 1, lastSeen: record.ts });
    }
    for (const tool of record.toolsUsed) {
      for (const agent of record.agentsUsed) {
        this.addEdge({ source: agent, target: tool, relationship: 'uses', weight: 1, lastSeen: record.ts });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Prompt Performance
  // -----------------------------------------------------------------------

  recordPromptUse(promptId: string, skillId: string, version: number, confidence: number, qualityScore: number, wasCorrected: boolean): void {
    const key = `${promptId}-v${version}`;
    const existing = promptPerf.get(key) || {
      promptId, skillId, version, totalUses: 0, avgConfidence: 0, avgQualityScore: 0, correctionRate: 0, lastUsed: '',
    };
    const n = existing.totalUses;
    promptPerf.set(key, {
      ...existing,
      totalUses: n + 1,
      avgConfidence: (existing.avgConfidence * n + confidence) / (n + 1),
      avgQualityScore: (existing.avgQualityScore * n + qualityScore) / (n + 1),
      correctionRate: (existing.correctionRate * n + (wasCorrected ? 1 : 0)) / (n + 1),
      lastUsed: new Date().toISOString(),
    });
  }

  getPromptPerformance(promptId?: string): PromptPerformance[] {
    const all = Array.from(promptPerf.values());
    return promptId ? all.filter(p => p.promptId === promptId) : all;
  }

  getBestPromptVersion(promptId: string): PromptPerformance | undefined {
    return this.getPromptPerformance(promptId)
      .sort((a, b) => (b.avgQualityScore - b.correctionRate) - (a.avgQualityScore - a.correctionRate))[0];
  }

  // -----------------------------------------------------------------------
  // Persistence hooks
  // -----------------------------------------------------------------------

  _exportData(): {
    executions: ExecutionRecord[]; feedback: SkillFeedback[]; comments: SkillComment[];
    decisionTraces: DecisionTrace[]; corrections: CorrectionRecord[];
    agentPerformance: AgentPerformance[]; promptPerformance: PromptPerformance[];
    entities: GraphEntity[]; edges: GraphEdge[];
  } {
    return {
      executions: [...executions], feedback: [...feedback], comments: [...comments],
      decisionTraces: [...decisionTraces], corrections: [...corrections],
      agentPerformance: Array.from(agentPerf.values()), promptPerformance: Array.from(promptPerf.values()),
      entities: Array.from(entities.values()), edges: [...edges],
    };
  }

  _importData(data: {
    executions?: ExecutionRecord[]; feedback?: SkillFeedback[]; comments?: SkillComment[];
    decisionTraces?: DecisionTrace[]; corrections?: CorrectionRecord[];
    agentPerformance?: AgentPerformance[]; promptPerformance?: PromptPerformance[];
    entities?: GraphEntity[]; edges?: GraphEdge[];
  }): void {
    if (data.executions) { executions.length = 0; executions.push(...data.executions); }
    if (data.feedback) { feedback.length = 0; feedback.push(...data.feedback); }
    if (data.comments) { comments.length = 0; comments.push(...data.comments); }
    if (data.decisionTraces) { decisionTraces.length = 0; decisionTraces.push(...data.decisionTraces); }
    if (data.corrections) { corrections.length = 0; corrections.push(...data.corrections); }
    if (data.agentPerformance) { agentPerf.clear(); data.agentPerformance.forEach(p => agentPerf.set(p.agentId, p)); }
    if (data.promptPerformance) { promptPerf.clear(); data.promptPerformance.forEach(p => promptPerf.set(`${p.promptId}-v${p.version}`, p)); }
    if (data.entities) { entities.clear(); data.entities.forEach(e => entities.set(e.id, e)); }
    if (data.edges) { edges.length = 0; edges.push(...data.edges); }
  }
}

export const memoryGraph = new MemoryGraph();
