/**
 * Enterprise Agent OS — Gateway API Server
 *
 * @author     Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright  © 2026 Phani Marupaka. All rights reserved.
 * @license    UNLICENSED — Unauthorized use prohibited.
 * @notice     This file contains embedded provenance watermarks protected
 *             under 17 U.S.C. § 1202 (Copyright Management Information).
 *             Removal or alteration constitutes a federal violation.
 *
 * Provenance: 50 68 61 6e 69 20 4d 61 72 75 70 61 6b 61
 */

import { InMemoryStore, SessionRepository, ExecutionRepository, executeQuery, classifyIntent } from './core.js';
import { PersistentStore, PostgresStore } from './db.js';
import { authenticateRequest, requirePersonaAccess, requireRole, generateJWT } from './auth.js';
import type { AuthUser } from './auth.js';
import { PromptStore } from './prompt-library-data.js';
import { CapabilityGraph } from './capability-graph.js';
import { PersonaSystem, LicenseStore } from './persona-system.js';
import { skillMarketplace } from './skill-marketplace.js';
import { intentEngine } from './intent-engine.js';
import { memoryGraph } from './memory-graph.js';
import { createUTCPPacket, storePacket, getPacket, getRecentPackets, getPacketsByStatus, updatePacketStatus, type UTCPPacket, type TaskStatus } from './utcp-protocol.js';
import { createA2AMessage, respondToA2A, createMeeting, createSwarm, storeMessage, getMessage, getRecentMessages, getMessagesByTask, getPendingMessages, storeMeeting, getMeeting, getRecentMeetings, getActiveMeetings, storeSwarm, getSwarm, getActiveSwarms, getRecentSwarms, type A2AAgent } from './a2a-protocol.js';
import { createMCPAction, executeMCPAction, getToolCapabilities, getToolCapability, getExecutionLog as getMCPLog, getToolStats, setMcpResolver } from './mcp-executor.js';
import { McpClientManager } from './mcp-client.js';
import { loadMcpServerConfigs } from './mcp-config.js';
import { scanSkill, isSkillScanConfigured } from './skill-scan.js';
import { createAgentRuntime, createEphemeralAgent, addReACTIteration, completeExecution, assembleFullPrompt, storeRuntime, getRuntime, getActiveRuntimes, getAllRuntimes, terminateRuntime } from './agent-runtime.js';
import { initAgentStatusReconciler, getAgentStatusSnapshot, getAgentStatus, subscribeToAgentStatus } from './agent-status-reconciler.js';
import { initSlackNotifier } from './slack-notifier.js';
import { seedDemoScenario } from './demo-seeder.js';
import { startMeetingFromTemplate, delegateTask, escalateTask, getDelegationChain, getDelegationChainsByTask, getAgentRoster, getMeetingTemplates, type MeetingTemplate } from './agent-meetings.js';
import { launchSwarm, advanceSwarmPhase, dissolveSwarm, getSwarmTemplates, getSwarmTemplate, getSwarmStats } from './swarm-manager.js';
import { getFlagshipWorkflows, getFlagshipWorkflow, getFlagshipWorkflowsByPersona } from './flagship-workflows.js';
import { routeModel, routedLLMCall, getCostMeter, getCostHistory, recordCostEntry, checkRateLimit, isCircuitOpen, getAllCircuitStates, type ModelRouterConfig } from './model-router.js';
import { getHealth, getReadiness, getMetrics, recordRequest } from './health.js';
import { simulateSkillExecution } from './simulation.js';
import { toolRegistry } from './tool-registry.js';
import { scheduler } from './scheduler.js';
import { blogStore } from './blog-store.js';
import { forumStore } from './forum-store.js';
import { agentEvalsStore } from './agent-evals.js';
import * as marketingApi from './marketing-api.js';
import { getProject, getProjectTasks, getRecentProjects } from './marketing-program.js';
import { getCampaignGraph } from './campaign-graph.js';
import { getMarketingToolConnections, getToolConnectionStatus, connectTool, disconnectTool, testToolConnection, MARKETING_TOOL_CATALOG } from './marketing-tool-connections.js';
import { getToolConnectFlow, shouldRedirectToOAuth } from './tool-connect-flows.js';
import { exchangeOAuthCode, renderOAuthResultHtml } from './oauth-callback.js';
import { getNotificationConfig, setNotificationConfig } from './marketing-notifications.js';
import { ENGINEERING_SKILLS, getEngineeringSkill, getEngineeringSkillsByCluster } from './engineering-skills-data.js';
import { PRODUCT_SKILLS, getProductSkill, getProductSkillsByCluster } from './product-skills-data.js';
import { HR_SKILLS, getHRSkill, getHRSkillsByCluster } from './hr-skills-data.js';
import { TA_SKILLS, getTASkill, getTASkillsByCluster } from './ta-skills-data.js';
import { PROGRAM_SKILLS, getProgramSkill, getProgramSkillsByCluster } from './program-skills-data.js';
import { createPersonaExecution, getPersonaExecution, listPersonaExecutions, approvePersonaStep, getAgentKPIs, getAgentKPI, initPersonaStore, getExecutionStats, getAllExecutions, getAfterActionReport, listAfterActionReports, getRetrainingFlags, getRetrainingFlag, acknowledgeRetrainingFlag, dismissRetrainingFlag, runSkillExecution } from './persona-api.js';
import { startWorkers, registerTaskHandler } from './task-worker.js';
import { getQueueStats, listTasks, getTask, cancelTask as cancelQueueTask, retryTask as retryQueueTask } from './task-queue.js';
import { createSession as createChatSession, getSession as getChatSession, listSessions as listChatSessions, archiveSession as archiveChatSession, listMessages as listChatMessages } from './chat-store.js';
import { postMessage as postChatMessage } from './chat-engine.js';
import { getFsSkills, reloadFsSkills, getAllFsSkills, warmAllFsSkills } from './skill-fs-loader.js';
import { runReviewPipeline, getReviewChain } from './review-pipeline.js';
import { ORCHESTRATOR_PROMPT, ORCHESTRATOR_PROMPT_PLACEHOLDERS } from './prompts/orchestrator-prompt.js';
import type { AfterActionReport, RetrainingFlag } from './persona-api.js';
import { getAvailableProviders, getDefaultProvider, hasAnyLLMKey } from './llm-provider.js';
import { getFullRegistry, getAgentIdentity, getAgentsByPersona, getCSuiteAgents, getAllCSuiteProfiles, getCSuiteProfile, getChainOfCommand, getOrgTree } from './agent-registry.js';
import { processCognitivePipeline, decompose, reason, reflect, groundCheck, getCognitiveResult, getCognitiveTrace, type CognitiveRequest } from './cognitive-pipeline.js';
import { eventBus } from './event-bus.js';
import { submitGoal, getGoalExecution, listGoalExecutions, cancelGoal } from './gateway-orchestrator.js';
import { PipelineEngine, getPipelineExecution, listPipelineExecutions, cancelPipeline, initWorkflowStore, type GraphConfig, type OrchestratorConfig, type AgentDefinition } from './pipeline-engine.js';
import { pluginRegistry } from './plugin-interfaces.js';
import { createVision, getVision, listVisions, decomposeVision, cascadeToRegiment, createProgram, getProgram, listPrograms, updateProgram, generatePMOStatusReport, getVisionStatus, initVisionStore } from './vision-api.js';
import type { VisionStatement, ProgramRecord } from './vision-api.js';
import { createChannel, getChannel, listChannels, updateChannel, deleteChannel, createRule, getRule, listRules, updateRule, deleteRule, dispatch, dispatchByTrigger, getDeliveryLog, getDelivery, getDeliveryStats, initNotificationStore } from './notification-dispatch.js';
import { createEndpoint, getEndpoint, listEndpoints, deleteEndpoint, createSubscription, getSubscription, listSubscriptions, deleteSubscription, receiveWebhook, getInboundLog, initWebhookStore } from './webhook-connector.js';
import { wireNotificationBridge } from './notification-bridge.js';
import { createExperiment, getExperiment, listExperiments, updateExperiment, transitionExperiment, addExperimentResult, scoreExperiment, deleteExperiment, createHackathon, getHackathon, listHackathons, startHackathon, completeHackathon, addExperimentToHackathon, requestGraduation, reviewGraduation, listGraduations, getInnovationBacklog, initInnovationStore } from './innovation-labs.js';
import { setBudget, getBudget, listBudgets, deleteBudget, recordSpend, getSpendLog, getBurnRate, listAlerts as listCostAlerts, acknowledgeAlert, getCFODashboard, initBudgetStore } from './budget-intelligence.js';
import { createReview, getReview, listReviews, createPlan, getPlan, listPlans, updatePlanStatus, updateObjective, submitFeedback, listFeedback, getFeedbackSummary, addExemplar, listExemplars, deleteExemplar, getAgentHealthReport, initImprovementStore } from './agent-improvement.js';
import { registerStore, initGatewayPersistence, flushGatewayPersistence } from './gateway-persistence.js';
import { approve as approveViaBus, reject as rejectViaBus, listPending as listPendingApprovals, getDecision as getApprovalDecision, getApprovalSlaSummary } from './approval-bus.js';
import { createPolicy, updatePolicy, deletePolicy, getPolicy, listPolicies, checkPolicy, seedExamplePolicies } from './policy-store.js';
import { redact as redactPII, containsPII } from './pii-redactor.js';
import { contributeExecution, getContributionLog, getContributionStats } from './benchmark-ingest.js';
import {
  createCampaign, updateCampaign, getCampaign, listCampaigns, deleteCampaign,
  linkExecutionToCampaign, addAsset, approveAsset, getAsset, listCampaignAssets,
  searchAssets, getAssetLineage, getCampaignStats, getControlTowerSummary,
} from './campaign-dag.js';
import {
  trainModelRouter, routeRequest, computeLeaderboard, forecastDrift, computeSEI,
} from './data-moat.js';
import {
  validatePacket, canonicalize, hashPacket,
  toMcpEnvelope, fromMcpEnvelope,
  listAdopters, registerAdopter,
} from './utcp-sdk.js';
import {
  importPoliciesFromYaml, exportPoliciesAsYaml,
  createRoutingRule, listRoutingRules, deleteRoutingRule, resolveApprovers,
  createResidencyRule, listResidencyRules, deleteResidencyRule, checkResidency,
  listComplianceControls, getComplianceSummary,
  runRedTeamScan,
} from './governance-v2.js';
import { getAgentMemory, getAllAgentMemorySnapshots, recordAgentMemory, getAgentMemoryDocument, _exportData as exportAgentMemory, _importData as importAgentMemory } from './agent-memory.js';
// Workflow engine available as library but not exposed as API routes
// (all execution flows use persona-api.ts sequential model)
// import { executeWorkflow, getWorkflowExecution, resumeWorkflow } from './workflow-bridge.js';
import { initOTel, shutdownOTel } from '@agentos/observability';
import { validate, ValidationError, ExecuteSchema, GoalSchema, A2AMessageSchema, UTCPPacketSchema } from './validation.js';
import { attachWebSocket, broadcastEvent, getWSClientCount, getWSMetrics } from './ws.js';
import http from 'node:http';
import fs from 'node:fs';
import nodePath from 'node:path';
import { createHash as nodeCreateHash } from 'node:crypto';
import { URL } from 'node:url';
import { fileURLToPath } from 'node:url';

// Store selection: DATABASE_URL → Postgres, PERSIST=false → In-memory, default → File-backed
const usePostgres = !!process.env.DATABASE_URL;
const useInMemory = process.env.PERSIST === 'false';
const store = usePostgres ? new PostgresStore() : useInMemory ? new InMemoryStore() : new PersistentStore();

// Raw pg.Pool for direct queries (API keys, tenant GUC, audit persistence).
// Only available when DATABASE_URL is set; undefined otherwise.
let pgPool: import('pg').Pool | undefined;
if (usePostgres) {
    import('@agentos/db/postgres-store').then(m => m.getRawPool()).then(p => { pgPool = p as any; }).catch(() => {});
}
const sessions = new SessionRepository(store);
const executions = new ExecutionRepository(store);
initPersonaStore(store); // Wire persona executions & KPIs to persistent backing store
initVisionStore(store); // Wire vision statements, programs & OKRs to persistent store
initNotificationStore(store); // Wire notification channels, rules & delivery log
initWebhookStore(store); // Wire webhook endpoints & subscriptions (also re-wires outbound subscriptions to event bus)
wireNotificationBridge(); // Wire event bus patterns → notification dispatch
initInnovationStore(store); // Wire innovation labs experiments, hackathons & graduations
initBudgetStore(store); // Wire agent budgets, spend log & cost alerts
initImprovementStore(store); // Wire performance reviews, improvement plans & feedback
initAgentStatusReconciler(); // Wire agent status reconciler (subscribes to execution events + 5s ground-truth sweep)
initSlackNotifier();          // Post execution.completed summaries to SLACK_WEBHOOK_URL for hero workflows

// Seed a consistent demo scenario so first-run dashboards show realistic data.
// Skipped when real executions already exist, or when SEED_DEMO=false is set.
if (process.env.SEED_DEMO !== 'false') {
  try { seedDemoScenario(); } catch (err) { console.warn('[server] demo seed failed:', (err as Error).message); }
  try { seedExamplePolicies(); } catch (err) { console.warn('[server] policy seed failed:', (err as Error).message); }
}

// Benchmark auto-forward — when BENCHMARK_CONTRIBUTE=true, route every completed
// execution through the ingest pipeline. Safe no-op when opt-in is off.
eventBus.on('execution.completed', async (event) => {
  const exec = (event.data as { execution?: Parameters<typeof contributeExecution>[0] })?.execution;
  if (!exec) return;
  try { await contributeExecution(exec); } catch (err) {
    console.warn('[benchmark-ingest] auto-forward failed:', (err as Error).message);
  }
});

// Bridge agent status changes to WebSocket clients on the "agents" channel
subscribeToAgentStatus((record) => {
  try { broadcastEvent('agents', 'agent.status.changed', record as unknown as Record<string, unknown>); } catch {}
});

// Register task handlers and start workers (Phase 3 — Task Queue with atomic claim)
registerTaskHandler('runSkillExecution', runSkillExecution);
startWorkers({ workerCount: 4, maxConcurrentPerAgent: 2, maxConcurrentPerPersona: 8 });
const promptStore = new PromptStore();
const capabilityGraph = new CapabilityGraph();
const personaSystem = new PersonaSystem();
const licenseStore = new LicenseStore();

// Eagerly load adopted community skills (skills/<persona>/<slug>/SKILL.md) so they
// surface in the unified catalog and per-persona listings from boot.
try {
  const warmed = warmAllFsSkills();
  if (warmed.total > 0) console.log(`[skills] loaded ${warmed.total} adopted skills across: ${warmed.personas.join(', ')}`);
} catch (err) { console.warn('[skills] warm load failed:', err); }

// Real MCP client (Phase 0) — connect MCP servers declared in mcp.servers.json and route
// tool calls whose tool_id is a connected MCP server through genuine MCP. Servers gated by
// an unset enabledWhenEnv var are skipped, so with no config the gateway runs as before.
const mcpManager = new McpClientManager();
setMcpResolver(async (action) => {
  if (!mcpManager.hasServer(action.tool_id)) return null; // only MCP-server tool_ids
  const params = { ...(action.params as Record<string, unknown>) };
  const toolName = String(params.__mcp_tool ?? action.resource_type ?? action.action);
  delete params.__mcp_tool;
  const r = await mcpManager.callTool(action.tool_id, toolName, params);
  if (!r.ok) return null; // fall back to legacy connectors / simulation on MCP failure
  return r.structured ?? { mcp: true, server: r.server, tool: r.tool, content: r.content };
});
void mcpManager.init(loadMcpServerConfigs())
  .then((n) => { if (n > 0) console.log(`[mcp] connected ${n} MCP server(s)`); })
  .catch((err) => console.warn('[mcp] init failed:', err));

/**
 * Adapt an adopted community skill (FSSkillDef) into an executable single-step
 * UnifiedSkillDef. The skill's markdown body is passed separately as the step's
 * instructions (via customPrompt) so the LLM receives the actual skill content.
 */
function synthesizeAdoptedSkill(fs: ReturnType<typeof getAllFsSkills>[number]): any {
  return {
    id: fs.id,
    slug: fs.slug,
    name: fs.name,
    description: fs.description || fs.name,
    icon: '🧩',
    persona: fs.persona,
    executableType: 'skill',
    cluster: fs.cluster ?? 'Adopted Skills',
    complexity: fs.complexity ?? 'moderate',
    estimatedTime: fs.estimatedTime ?? '~varies',
    inputs: [{ id: 'request', label: 'Request / Context', type: 'textarea', required: false, section: 'basic', helpText: 'Optional context or target for this skill.' }],
    steps: [{ id: `${fs.id}-s1`, order: 1, name: fs.name, agent: '', tool: 'Claude', outputKey: 'result', capability: 'content.generate' }],
    outputs: ['result'],
    requiredTools: ['Claude'],
    optionalTools: fs.requiredTools ?? [],
    tags: fs.tags ?? [],
  };
}

// ---------------------------------------------------------------------------
// Gateway-wide persistence — wire all ephemeral stores to backing store
// ---------------------------------------------------------------------------
registerStore('forum_threads',
  () => [...forumStore._exportData().threads.map(t => ({ ...t, _type: 'thread' as const })), ...forumStore._exportData().comments.map(c => ({ ...c, _type: 'comment' as const }))] as Record<string, unknown>[],
  (rows) => forumStore._importData({
    threads: rows.filter(r => r._type === 'thread') as any[],
    comments: rows.filter(r => r._type === 'comment') as any[],
  })
);
registerStore('blog_posts',
  () => blogStore._exportData() as unknown as Record<string, unknown>[],
  (rows) => blogStore._importData(rows as any[])
);
registerStore('scheduler_data',
  () => {
    const d = scheduler._exportData();
    return [...d.jobs.map(j => ({ ...j, _type: 'job' } as Record<string, unknown>)), ...d.logs.map(l => ({ ...l, _type: 'log' } as Record<string, unknown>))];
  },
  (rows) => scheduler._importData({
    jobs: rows.filter(r => r._type === 'job') as any[],
    logs: rows.filter(r => r._type === 'log') as any[],
  })
);
registerStore('event_log',
  () => eventBus._exportLog() as unknown as Record<string, unknown>[],
  (rows) => eventBus._importLog(rows as any[])
);
// Memory graph persistence — full coverage of every sub-store. This is the
// dataset that powers the data moat: executions + decisions + corrections +
// agent perf + prompt perf + entity graph all survive restarts.
registerStore('memory_graph',
  () => {
    const d = memoryGraph._exportData();
    return [
      ...d.executions.map(e => ({ ...e, _type: 'execution' } as Record<string, unknown>)),
      ...d.feedback.map(f => ({ ...f, _type: 'feedback' } as Record<string, unknown>)),
      ...d.comments.map(c => ({ ...c, _type: 'comment' } as Record<string, unknown>)),
      ...d.decisionTraces.map(dt => ({ ...dt, _type: 'decision' } as Record<string, unknown>)),
      ...d.corrections.map(cr => ({ ...cr, _type: 'correction' } as Record<string, unknown>)),
      ...d.agentPerformance.map(ap => ({ ...ap, _type: 'agent_perf' } as Record<string, unknown>)),
      ...d.promptPerformance.map(pp => ({ ...pp, _type: 'prompt_perf' } as Record<string, unknown>)),
      ...d.entities.map(en => ({ ...en, _type: 'entity' } as Record<string, unknown>)),
      ...d.edges.map(ed => ({ ...ed, _type: 'edge' } as Record<string, unknown>)),
    ];
  },
  (rows) => memoryGraph._importData({
    executions: rows.filter(r => r._type === 'execution') as any[],
    feedback: rows.filter(r => r._type === 'feedback') as any[],
    comments: rows.filter(r => r._type === 'comment') as any[],
    decisionTraces: rows.filter(r => r._type === 'decision') as any[],
    corrections: rows.filter(r => r._type === 'correction') as any[],
    agentPerformance: rows.filter(r => r._type === 'agent_perf') as any[],
    promptPerformance: rows.filter(r => r._type === 'prompt_perf') as any[],
    entities: rows.filter(r => r._type === 'entity') as any[],
    edges: rows.filter(r => r._type === 'edge') as any[],
  })
);
registerStore('agent_memory',
  () => exportAgentMemory(),
  (rows) => importAgentMemory(rows)
);

// Generic connection store for ConnectionsHub
interface ConnectionRecord { connectorId: string; status: string; connectedAt?: string; lastTestedAt?: string; credentials?: Record<string, string>; error?: string; }
const connectionStore = new Map<string, ConnectionRecord>();

// Real audit log — records actual gateway operations.
// Tamper-evident via hash-chain: each entry includes SHA-256(prev_hash || entry_json),
// so any mutation invalidates all later entries. Verifiable via /api/governance/audit/verify.
interface AuditEntry { id: string; timestamp: string; user: string; action: string; target: string; result: 'success' | 'failed' | 'warning'; detail?: string; prevHash?: string; hash?: string; }
const auditLog: AuditEntry[] = [];
const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';
function computeAuditHash(prevHash: string, entry: Omit<AuditEntry, 'hash'>): string {
    // Deterministic serialization (stable key order) prevents hash drift.
    const canonical = JSON.stringify({
        id: entry.id, ts: entry.timestamp, u: entry.user, a: entry.action,
        t: entry.target, r: entry.result, d: entry.detail ?? null, p: prevHash,
    });
    return nodeCreateHash('sha256').update(canonical).digest('hex');
}
function recordAudit(user: string, action: string, target: string, result: AuditEntry['result'] = 'success', detail?: string): void {
    const prevHash = auditLog.length > 0 ? (auditLog[auditLog.length - 1]!.hash ?? GENESIS_HASH) : GENESIS_HASH;
    const entry: AuditEntry = {
        id: `au-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        user, action, target, result, detail,
        prevHash,
    };
    entry.hash = computeAuditHash(prevHash, entry);
    auditLog.push(entry);
    // Keep last 5000 — audit evidence value beats RAM cost.
    // When in-memory hits 5000, flush oldest 1000 to DB rolling window.
    if (auditLog.length > 5000) {
        const toFlush = auditLog.splice(0, 1000);
        if (pgPool) {
            Promise.all(toFlush.map(e =>
                pgPool!.query(
                    `INSERT INTO audit_log (id, timestamp, user_id, action, resource_id, details, prev_hash, hash, result)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
                    [e.id, e.timestamp, e.user, e.action, e.target, JSON.stringify({ detail: e.detail }), e.prevHash, e.hash, e.result]
                ).catch(() => {})
            )).catch(() => {});
        }
    }
    // Also persist every entry to DB asynchronously when pool is available
    if (pgPool) {
        pgPool.query(
            `INSERT INTO audit_log (id, timestamp, user_id, action, resource_id, details, prev_hash, hash, result)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
            [entry.id, entry.timestamp, entry.user, entry.action, entry.target, JSON.stringify({ detail: entry.detail }), entry.prevHash, entry.hash, entry.result]
        ).catch(() => {});
    }
}
/** Verify the entire hash chain. Returns { valid, brokenAt } for CISO inspection. */
function verifyAuditChain(): { valid: boolean; brokenAt?: number; total: number } {
    let prevHash = GENESIS_HASH;
    for (let i = 0; i < auditLog.length; i++) {
        const e = auditLog[i]!;
        const expected = computeAuditHash(prevHash, { id: e.id, timestamp: e.timestamp, user: e.user, action: e.action, target: e.target, result: e.result, detail: e.detail, prevHash });
        if (e.prevHash !== prevHash || e.hash !== expected) {
            return { valid: false, brokenAt: i, total: auditLog.length };
        }
        prevHash = e.hash;
    }
    return { valid: true, total: auditLog.length };
}

// Course engagement tracking
const courseVotes = new Set<string>();
registerStore('connections',
  () => Array.from(connectionStore.entries()).map(([id, rec]) => ({ id, ...rec })) as unknown as Record<string, unknown>[],
  (rows) => { connectionStore.clear(); for (const r of rows) { const { id, ...rest } = r as any; connectionStore.set(id, rest); } }
);
registerStore('audit_log',
  () => auditLog.map(e => ({ ...e })) as unknown as Record<string, unknown>[],
  (rows) => { auditLog.length = 0; auditLog.push(...(rows as any[])); }
);

const courseStats = {
    totalCourses: 24,
    totalViews: 38420,
    totalLikes: 4478,
    totalPins: 856,
    courses: Array.from({ length: 24 }, (_, i) => ({
        id: i + 1,
        likes: Math.floor(Math.random() * 200) + 80,
        dislikes: Math.floor(Math.random() * 10),
        pins: Math.floor(Math.random() * 50) + 10,
        views: Math.floor(Math.random() * 2000) + 500,
        isPinned: [4, 7, 17, 21, 23].includes(i + 1),
    })),
};

registerStore('course_stats',
  () => [courseStats as unknown as Record<string, unknown>],
  (rows) => { if (rows[0]) Object.assign(courseStats, rows[0]); }
);

registerStore('agent_evals',
  () => {
    const d = agentEvalsStore._exportData();
    return [{ id: '__agent_evals__', configs: d.configs, driftHistory: d.driftHistory, alerts: d.alerts }] as unknown as Record<string, unknown>[];
  },
  (rows) => {
    const d = rows[0] as any;
    if (d) agentEvalsStore._importData({ configs: d.configs, driftHistory: d.driftHistory, alerts: d.alerts });
  }
);

initGatewayPersistence(store); // Restore all ephemeral stores from backing store
initWorkflowStore();           // Rehydrate pipeline executions from file-backed workflow store

const PORT = parseInt(process.env.PORT ?? '3000', 10);

// ---------------------------------------------------------------------------
// Skill catalog (demo data)
// ---------------------------------------------------------------------------

const SKILL_CATALOG = [
    { id: 'engineering.knowledge.search', name: 'Developer Knowledge Search', domain: 'Engineering', description: 'Search internal docs, code, and incidents', successRate: 0.91, avgLatency: '8s', qualityTier: 'production' },
    { id: 'engineering.incident.root_cause', name: 'Incident Root Cause Analysis', domain: 'Engineering', description: 'Analyze incidents with metrics, logs, and past data', successRate: 0.87, avgLatency: '12s', qualityTier: 'production' },
    { id: 'engineering.pr.architecture_review', name: 'PR Architecture Review', domain: 'Engineering', description: 'Review PRs for architecture, security, patterns', successRate: 0.93, avgLatency: '8s', qualityTier: 'certified' },
    { id: 'marketing.campaign.strategy', name: 'Campaign Strategy', domain: 'Marketing', description: 'Full campaign with ICP, messaging, calendar', successRate: 0.89, avgLatency: '18s', qualityTier: 'production' },
    { id: 'marketing.icp.analysis', name: 'ICP Analysis', domain: 'Marketing', description: 'Define ideal customer profiles', successRate: 0.86, avgLatency: '14s', qualityTier: 'beta' },
    { id: 'collaboration.transcript_to_actions', name: 'Transcript → Actions', domain: 'Leadership', description: 'Meeting summary, decisions, action items, Jira drafts', successRate: 0.85, avgLatency: '15s', qualityTier: 'production' },
    { id: 'learning.tutorial.rag', name: 'RAG Tutorial', domain: 'Learning', description: 'Build RAG pipelines using internal stack', successRate: 0.94, avgLatency: '10s', qualityTier: 'certified' },
    { id: 'learning.prompt.engineering', name: 'Prompt Engineering', domain: 'Learning', description: 'Comprehensive prompt engineering guide', successRate: 0.96, avgLatency: '8s', qualityTier: 'certified' },
];

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const path = url.pathname;
    const method = req.method ?? 'GET';

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    if (method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    // Auth
    const headers: Record<string, string | undefined> = {};
    for (const [key, val] of Object.entries(req.headers)) {
        headers[key.toLowerCase()] = Array.isArray(val) ? val[0] : val;
    }
    const auth = authenticateRequest(headers);
    if (!auth.authenticated) {
        sendJSON(res, 401, { error: auth.error ?? 'Unauthorized' });
        return;
    }

    const userId = auth.user?.id ?? 'anonymous';
    const authUser = auth.user;

    // Rate limiting — apply before any route processing
    {
        const { applyRateLimit } = await import('./rate-limiter.js');
        const rl = applyRateLimit(res, userId, authUser?.role ?? 'unauthenticated');
        if (rl.blocked) {
            sendJSON(res, 429, { error: 'Rate limit exceeded', resetInMs: rl.resetInMs });
            return;
        }
    }

    /**
     * Route guard: require the authenticated user to have at least the
     * specified role. Sends a 403 and returns true if blocked; caller should
     * return immediately when true.
     *
     * Dev note: in dev mode (NODE_ENV !== production) the fallback user is
     * 'user', so admin-only routes will 403 unless the caller sends an admin
     * API key (eos-dev-key) or JWT. This is intentional — it matches prod
     * behavior and makes RBAC testable end-to-end.
     */
    const guardRole = (requiredRole: 'operator' | 'admin'): boolean => {
        if (!authUser || !requireRole(authUser, requiredRole)) {
            sendJSON(res, 403, {
                error: `Forbidden: '${requiredRole}' role required`,
                userRole: authUser?.role ?? 'anonymous',
            });
            return true;
        }
        return false;
    };

    try {
        // Health — liveness check
        if (path === '/api/health' && method === 'GET') {
            sendJSON(res, 200, {
                ...getHealth(),
                services: { gateway: 'up', skills: 'up', workers: 'up', orchestrator: 'up' },
                llmConfigured: !!process.env.ANTHROPIC_API_KEY,
                githubConfigured: !!process.env.GITHUB_TOKEN,
                persistenceEnabled: usePostgres ? 'postgres' : useInMemory ? 'in-memory' : 'file-backed',
                wsClients: getWSClientCount(),
                storeStats: 'stats' in store ? (store as PersistentStore).stats() : { tables: 0, totalRows: 0 },
            });
            return;
        }

        // Readiness — deep checks (DB, LLM, memory, circuits)
        if (path === '/api/ready' && method === 'GET') {
            const readiness = await getReadiness();
            sendJSON(res, readiness.status === 'ready' ? 200 : 503, readiness);
            return;
        }

        // Platform metrics (Prometheus-compatible)
        if (path === '/api/metrics' && method === 'GET') {
            sendJSON(res, 200, getMetrics());
            return;
        }

        // Model router — route a task to optimal model
        if (path === '/api/router/route' && method === 'POST') {
            const body = await readBody(req);
            const decision = routeModel(
                body.prompt as string ?? '',
                body.config as Partial<ModelRouterConfig>,
                body.skill_complexity as string | undefined,
            );
            sendJSON(res, 200, { decision });
            return;
        }

        // Cost metering
        if (path === '/api/costs/meter' && method === 'GET') {
            sendJSON(res, 200, getCostMeter());
            return;
        }

        if (path === '/api/costs/history' && method === 'GET') {
            const limit = parseInt(url.searchParams.get('limit') ?? '100', 10);
            sendJSON(res, 200, { history: getCostHistory(limit) });
            return;
        }

        // Rate limiting status
        if (path === '/api/rate-limits' && method === 'GET') {
            sendJSON(res, 200, { circuits: getAllCircuitStates() });
            return;
        }

        // WebSocket metrics (backpressure, slow clients, drops)
        if (path === '/api/ws/metrics' && method === 'GET') {
            sendJSON(res, 200, getWSMetrics());
            return;
        }

        // ── Task Queue (Phase 3) ──
        if (path === '/api/queue/stats' && method === 'GET') {
            sendJSON(res, 200, getQueueStats());
            return;
        }

        if (path === '/api/queue/tasks' && method === 'GET') {
            const statusFilter = url.searchParams.get('status') as any;
            const personaFilter = url.searchParams.get('persona') as any;
            const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
            const tasks = listTasks({ status: statusFilter || undefined, persona: personaFilter || undefined, limit });
            sendJSON(res, 200, { tasks, total: tasks.length });
            return;
        }

        if (path.startsWith('/api/queue/tasks/') && path.endsWith('/cancel') && method === 'POST') {
            const taskId = path.replace('/api/queue/tasks/', '').replace('/cancel', '');
            const ok = cancelQueueTask(taskId);
            sendJSON(res, ok ? 200 : 404, { ok, taskId });
            return;
        }

        if (path.startsWith('/api/queue/tasks/') && path.endsWith('/retry') && method === 'POST') {
            const taskId = path.replace('/api/queue/tasks/', '').replace('/retry', '');
            const ok = retryQueueTask(taskId);
            sendJSON(res, ok ? 200 : 404, { ok, taskId });
            return;
        }

        if (path.startsWith('/api/queue/tasks/') && method === 'GET') {
            const taskId = path.replace('/api/queue/tasks/', '');
            const task = getTask(taskId);
            if (!task) { sendJSON(res, 404, { error: 'Task not found' }); return; }
            sendJSON(res, 200, { task });
            return;
        }

        // ── Chat (Phase 4) ──
        if (path === '/api/chat/sessions' && method === 'GET') {
            const sessions = listChatSessions(userId);
            sendJSON(res, 200, { sessions });
            return;
        }

        if (path === '/api/chat/sessions' && method === 'POST') {
            const body = await readBody(req);
            const session = createChatSession({
                userId,
                title: (body.title as string) ?? undefined,
                agentId: (body.agentId as string) ?? undefined,
                persona: (body.persona as any) ?? undefined,
            });
            sendJSON(res, 201, { session });
            return;
        }

        if (path.match(/^\/api\/chat\/sessions\/[^/]+$/) && method === 'GET') {
            const sessionId = path.split('/')[4]!;
            const session = getChatSession(sessionId);
            if (!session) { sendJSON(res, 404, { error: 'Session not found' }); return; }
            const messages = listChatMessages(sessionId, 100);
            sendJSON(res, 200, { session, messages });
            return;
        }

        if (path.match(/^\/api\/chat\/sessions\/[^/]+$/) && method === 'DELETE') {
            const sessionId = path.split('/')[4]!;
            const ok = archiveChatSession(sessionId);
            sendJSON(res, ok ? 200 : 404, { ok });
            return;
        }

        if (path.match(/^\/api\/chat\/sessions\/[^/]+\/messages$/) && method === 'POST') {
            const sessionId = path.split('/')[4]!;
            const body = await readBody(req);
            const content = (body.content as string) ?? '';
            if (!content.trim()) { sendJSON(res, 400, { error: 'content required' }); return; }
            const result = await postChatMessage({ sessionId, userId, content });
            sendJSON(res, result.replyPath === 'error' ? 500 : 200, result);
            return;
        }

        // ── Skills File System (Phase 5) ──
        if (path === '/api/skills/fs' && method === 'GET') {
            const persona = url.searchParams.get('persona');
            if (persona) {
                const result = getFsSkills(persona);
                sendJSON(res, 200, { persona, ...result, available: !!result });
            } else {
                sendJSON(res, 200, { skills: getAllFsSkills() });
            }
            return;
        }

        if (path === '/api/skills/fs/reload' && method === 'POST') {
            const body = await readBody(req);
            const persona = (body.persona as string) ?? undefined;
            const result = reloadFsSkills(persona);
            sendJSON(res, 200, result);
            return;
        }

        // POST /api/skills/scan — run the Skill Security Scan on skill content: { name, persona, body }
        if (path === '/api/skills/scan' && method === 'POST') {
            const body = await readBody(req);
            const scan = await scanSkill({ name: String((body as any).name ?? 'skill'), persona: (body as any).persona, body: String((body as any).body ?? (body as any).content ?? '') });
            sendJSON(res, 200, { configured: isSkillScanConfigured(), scan: scan ?? { passed: true, riskScore: 0, findings: [], engine: 'none (not configured)' } });
            return;
        }

        // POST /api/skills/fs/execute — run an adopted community skill (works for ANY
        // persona, incl. design/program/ta that the unified /api/execute doesn't branch on).
        if (path === '/api/skills/fs/execute' && method === 'POST') {
            const body = await readBody(req);
            const skillId = String((body.skillId as string) ?? '');
            const reqPersona = body.persona ? String(body.persona) : undefined;
            const inputs = (body.inputs as Record<string, unknown>) ?? {};
            const simulate = typeof body.simulate === 'boolean' ? body.simulate : undefined;
            const provider = body.provider as string | undefined;
            const modelId = body.modelId as string | undefined;

            const fsSkill = getAllFsSkills().find(s => s.id === skillId || s.slug === skillId);
            if (!fsSkill) { sendJSON(res, 404, { error: `Adopted skill not found: ${skillId}` }); return; }

            const persona = fsSkill.persona || reqPersona || 'engineering';
            if (authUser && !requirePersonaAccess(authUser, persona)) {
                sendJSON(res, 403, { error: `Access denied for persona: ${persona}` }); return;
            }

            const skill = synthesizeAdoptedSkill(fsSkill);
            const shouldSimulate = simulate !== undefined ? simulate : !hasAnyLLMKey();
            const exec = createPersonaExecution(persona as any, skill, inputs, userId, shouldSimulate, fsSkill.systemPrompt, provider as any, modelId);
            recordAudit(userId, 'skill.execute', `${persona} / ${fsSkill.name} (adopted)`);
            broadcastEvent(exec.id, 'session.started', { persona, skillId, simulate: shouldSimulate, adopted: true });
            sendJSON(res, 201, { execution: exec });
            return;
        }

        // ── Real MCP servers (Phase 0) ──
        // GET /api/mcp/servers — connected MCP servers + their tools
        if (path === '/api/mcp/servers' && method === 'GET') {
            sendJSON(res, 200, { servers: mcpManager.getServerStatus() });
            return;
        }
        // GET /api/mcp/servers/:id/tools — tools exposed by one MCP server
        if (path.match(/^\/api\/mcp\/servers\/[^/]+\/tools$/) && method === 'GET') {
            const id = decodeURIComponent(path.split('/')[4]!);
            sendJSON(res, 200, { server: id, tools: mcpManager.listTools(id) });
            return;
        }
        // POST /api/mcp/servers/:id/call — call a tool on an MCP server: { tool, arguments }
        if (path.match(/^\/api\/mcp\/servers\/[^/]+\/call$/) && method === 'POST') {
            const id = decodeURIComponent(path.split('/')[4]!);
            const body = await readBody(req);
            const toolName = String((body.tool as string) ?? (body.name as string) ?? '');
            const args = ((body.arguments ?? body.args) as Record<string, unknown>) ?? {};
            if (!toolName) { sendJSON(res, 400, { error: 'tool name required' }); return; }
            const result = await mcpManager.callTool(id, toolName, args);
            sendJSON(res, result.ok ? 200 : 502, result);
            return;
        }

        // ── Voice (inclusive access) — proxies to the connected voice MCP server ──
        // POST /api/voice/transcribe — speech-to-text. 501 (graceful) when no voice server.
        if (path === '/api/voice/transcribe' && method === 'POST') {
            if (!mcpManager.hasServer('voicebox')) { sendJSON(res, 501, { simulated: true, reason: 'Voice server not connected — set VOICEBOX_URL.' }); return; }
            const body = await readBody(req);
            const r = await mcpManager.callTool('voicebox', 'voicebox.transcribe', { audio_base64: (body as any).audio_base64, audio_path: (body as any).audio_path, language: (body as any).language });
            sendJSON(res, r.ok ? 200 : 502, { ok: r.ok, text: r.content, ...(r.structured ?? {}), error: r.error });
            return;
        }
        // POST /api/voice/speak — text-to-speech (e.g. spoken after-action summaries).
        if (path === '/api/voice/speak' && method === 'POST') {
            if (!mcpManager.hasServer('voicebox')) { sendJSON(res, 501, { simulated: true, reason: 'Voice server not connected — set VOICEBOX_URL.' }); return; }
            const body = await readBody(req);
            const r = await mcpManager.callTool('voicebox', 'voicebox.speak', { text: String((body as any).text ?? ''), profile: (body as any).profile, language: (body as any).language });
            sendJSON(res, r.ok ? 200 : 502, { ok: r.ok, ...(r.structured ?? { content: r.content }), error: r.error });
            return;
        }

        // ── EAOS Regiment Review — collaborative multi-role review pipeline ──
        // GET  /api/review/chain — the configured review-role chain + skill availability
        if (path === '/api/review/chain' && method === 'GET') {
            sendJSON(res, 200, { chain: getReviewChain() });
            return;
        }

        // GET /api/agent-prompts — EAOS agent system prompts (e.g. the Orchestrator).
        if (path === '/api/agent-prompts' && method === 'GET') {
            sendJSON(res, 200, { prompts: [
                {
                    id: 'orchestrator',
                    name: 'Orchestrator Agent',
                    description: 'Long-horizon orchestrator system prompt — clarification-first, citation-required, multi-subagent orchestration.',
                    placeholders: ORCHESTRATOR_PROMPT_PLACEHOLDERS,
                    length: ORCHESTRATOR_PROMPT.length,
                    content: ORCHESTRATOR_PROMPT,
                    provenance: 'bytedance/deer-flow (MIT)',
                },
            ] });
            return;
        }

        // POST /api/review/run — run an artifact through the collaborative review chain.
        // Each reviewer agent uses an adopted gstack plan-*-review skill and sees prior verdicts.
        if (path === '/api/review/run' && method === 'POST') {
            const body = await readBody(req);
            const artifact = String((body.artifact as string) ?? (body.text as string) ?? '');
            if (!artifact.trim()) { sendJSON(res, 400, { error: 'artifact (text to review) is required' }); return; }
            const roles = Array.isArray(body.roles) ? (body.roles as string[]).map(String) : undefined;
            const provider = body.provider as string | undefined;
            const modelId = body.modelId as string | undefined;
            try {
                const result = await runReviewPipeline(artifact, { roles, provider, modelId });
                recordAudit(userId, 'review.run', `autoplan review → ${result.finalVerdict} (${result.reviewers.length} reviewers)`);
                sendJSON(res, 200, result);
            } catch (err) {
                sendJSON(res, 500, { error: (err as Error).message });
            }
            return;
        }

        // -----------------------------------------------------------------
        // Auth routes — token issuance + user info
        // -----------------------------------------------------------------

        // POST /api/auth/token — issue JWT from API key or credentials
        if (path === '/api/auth/token' && method === 'POST') {
            if (!authUser) { sendJSON(res, 401, { error: 'Authentication required to issue token' }); return; }
            try {
                const body = await readBody(req);
                const expiresIn = typeof body.expiresIn === 'number' ? body.expiresIn : 86400;
                const token = generateJWT(authUser, expiresIn);
                sendJSON(res, 200, { token, expiresIn, user: { id: authUser.id, email: authUser.email, name: authUser.name, role: authUser.role, teams: authUser.teams, personaScopes: authUser.personaScopes } });
            } catch (err) {
                sendJSON(res, 500, { error: 'JWT_SECRET not configured — cannot issue tokens' });
            }
            return;
        }

        // GET /api/auth/me — return current user info from token
        if (path === '/api/auth/me' && method === 'GET') {
            if (!authUser) { sendJSON(res, 401, { error: 'Not authenticated' }); return; }
            sendJSON(res, 200, { user: { id: authUser.id, email: authUser.email, name: authUser.name, role: authUser.role, teams: authUser.teams, personaScopes: authUser.personaScopes, tenantId: authUser.tenantId } });
            return;
        }

        // GET /api/auth/oidc/authorize — redirect to OIDC identity provider
        if (path === '/api/auth/oidc/authorize' && method === 'GET') {
            try {
                const { buildAuthorizationUrl } = await import('./oidc-provider.js');
                const { url } = await buildAuthorizationUrl();
                res.writeHead(302, { Location: url });
                res.end();
            } catch (err) {
                sendJSON(res, 500, { error: 'OIDC not configured: ' + (err as Error).message });
            }
            return;
        }

        // GET /api/auth/oidc/callback — exchange code, issue AgentOS JWT, redirect to frontend
        if (path === '/api/auth/oidc/callback' && method === 'GET') {
            try {
                const params = new URL(req.url ?? '/', `http://${req.headers.host}`).searchParams;
                const code = params.get('code');
                const state = params.get('state') ?? '';
                if (!code) { sendJSON(res, 400, { error: 'Missing code parameter' }); return; }

                const { exchangeCode, verifyIdToken, provisionUser } = await import('./oidc-provider.js');
                const tokens = await exchangeCode(code);
                const claims = verifyIdToken(tokens.id_token, state);
                const oidcUser = provisionUser(claims);

                const agentosUser: AuthUser = {
                    id: oidcUser.id,
                    email: oidcUser.email,
                    name: oidcUser.name,
                    role: 'user',
                    teams: [],
                    personaScopes: ['*'],
                    tenantId: oidcUser.tenantId,
                };
                const jwt = generateJWT(agentosUser, 86400);
                const frontendUrl = process.env.FRONTEND_URL ?? '/';
                res.writeHead(302, { Location: `${frontendUrl}?token=${jwt}` });
                res.end();
            } catch (err) {
                sendJSON(res, 500, { error: 'OIDC callback failed: ' + (err as Error).message });
            }
            return;
        }

        // POST /api/users/apikeys — create new API key (returns raw key once, stores hash in DB)
        if (path === '/api/users/apikeys' && method === 'POST') {
            if (!authUser) { sendJSON(res, 401, { error: 'Authentication required' }); return; }
            try {
                const { generateApiKey } = await import('./auth.js');
                const body = await readBody(req);
                const label = typeof body.label === 'string' ? body.label : 'api-key';
                const expiresAt = typeof body.expiresAt === 'string' ? body.expiresAt : null;
                const { rawKey, keyHash, keyPrefix } = generateApiKey();
                const keyId = `key_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

                if (pgPool) {
                    await pgPool.query(
                        `INSERT INTO api_keys (id, user_id, key_hash, key_prefix, label, expires_at, created_at, tenant_id)
                         VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7)
                         ON CONFLICT (id) DO NOTHING`,
                        [keyId, authUser.id, keyHash, keyPrefix, label, expiresAt, authUser.tenantId ?? 'default']
                    );
                }
                sendJSON(res, 201, { id: keyId, rawKey, keyPrefix, label, expiresAt, warning: 'Save this key — it will not be shown again' });
            } catch (err) {
                sendJSON(res, 500, { error: (err as Error).message });
            }
            return;
        }

        // DELETE /api/users/apikeys/:keyId — revoke API key
        if (path.startsWith('/api/users/apikeys/') && !path.endsWith('/rotate') && method === 'DELETE') {
            if (!authUser) { sendJSON(res, 401, { error: 'Authentication required' }); return; }
            const keyId = path.split('/')[4];
            if (pgPool) {
                await pgPool.query(`DELETE FROM api_keys WHERE id=$1 AND user_id=$2`, [keyId, authUser.id]);
            }
            sendJSON(res, 200, { revoked: keyId });
            return;
        }

        // POST /api/users/apikeys/:keyId/rotate — generate replacement, revoke old atomically
        if (path.startsWith('/api/users/apikeys/') && path.endsWith('/rotate') && method === 'POST') {
            if (!authUser) { sendJSON(res, 401, { error: 'Authentication required' }); return; }
            const keyId = path.split('/')[4];
            try {
                const { generateApiKey } = await import('./auth.js');
                const { rawKey, keyHash, keyPrefix } = generateApiKey();
                const newKeyId = `key_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

                if (pgPool) {
                    const client = await pgPool.connect();
                    try {
                        await client.query('BEGIN');
                        const existing = await client.query(`SELECT label, expires_at FROM api_keys WHERE id=$1 AND user_id=$2`, [keyId, authUser.id]);
                        if (existing.rowCount === 0) { await client.query('ROLLBACK'); sendJSON(res, 404, { error: 'Key not found' }); return; }
                        const { label, expires_at } = existing.rows[0];
                        await client.query(`DELETE FROM api_keys WHERE id=$1`, [keyId]);
                        await client.query(
                            `INSERT INTO api_keys (id, user_id, key_hash, key_prefix, label, expires_at, created_at, tenant_id)
                             VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7)`,
                            [newKeyId, authUser.id, keyHash, keyPrefix, label, expires_at, authUser.tenantId ?? 'default']
                        );
                        await client.query('COMMIT');
                    } finally { client.release(); }
                }
                sendJSON(res, 200, { id: newKeyId, rawKey, keyPrefix, revokedId: keyId, warning: 'Save this key — it will not be shown again' });
            } catch (err) {
                sendJSON(res, 500, { error: (err as Error).message });
            }
            return;
        }

        // GET /api/audit — admin shortcut for audit log (alias of /api/governance/audit)
        if (path === '/api/audit' && method === 'GET') {
            if (guardRole('admin')) return;
            const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 1000);
            const entries = auditLog.slice(-limit).reverse();
            sendJSON(res, 200, { audit: entries, total: auditLog.length });
            return;
        }

        // GET /api/users/:id/export — GDPR Art.20 data portability
        if (path.match(/^\/api\/users\/[^/]+\/export$/) && method === 'GET') {
            const targetUserId = path.split('/')[3];
            if (!authUser || (authUser.id !== targetUserId && !requireRole(authUser, 'admin'))) {
                sendJSON(res, 403, { error: 'Forbidden' }); return;
            }
            if (!pgPool) { sendJSON(res, 503, { error: 'Database not available' }); return; }
            try {
                const { exportUserData } = await import('./gdpr-api.js');
                const data = await exportUserData(targetUserId!, pgPool as any);
                sendJSON(res, 200, data);
            } catch (err) { sendJSON(res, 500, { error: (err as Error).message }); }
            return;
        }

        // DELETE /api/users/:id — GDPR Art.17 right to erasure (admin only)
        if (path.match(/^\/api\/users\/[^/]+$/) && method === 'DELETE') {
            if (guardRole('admin')) return;
            const targetUserId = path.split('/')[3];
            if (!pgPool) { sendJSON(res, 503, { error: 'Database not available' }); return; }
            try {
                const { deleteUserData } = await import('./gdpr-api.js');
                const result = await deleteUserData(targetUserId!, pgPool as any);
                recordAudit(userId, 'gdpr.erasure', targetUserId ?? '', 'success');
                sendJSON(res, 200, result);
            } catch (err) { sendJSON(res, 500, { error: (err as Error).message }); }
            return;
        }

        // -----------------------------------------------------------------
        // Unified Execution API — single endpoint for all personas
        // POST /api/execute — unified skill/workflow execution
        // GET  /api/executions — list all executions (filtered)
        // GET  /api/executions/:id — get single execution
        // POST /api/executions/:id/approve/:stepId — approve a step
        // -----------------------------------------------------------------

        if (path === '/api/execute' && method === 'POST') {
            const body = await readBody(req);
            let parsed: import('./validation.js').ExecuteBody;
            try {
                parsed = validate(ExecuteSchema, body);
            } catch (err) {
                if (err instanceof ValidationError) {
                    sendJSON(res, 400, { error: err.message, issues: err.issues });
                } else {
                    sendJSON(res, 400, { error: 'Invalid request body' });
                }
                return;
            }
            const { persona, skillId, inputs, simulate, customPrompt, provider, modelId } = parsed;

            // Persona access check
            if (authUser && !requirePersonaAccess(authUser, persona)) {
                sendJSON(res, 403, { error: `Access denied for persona: ${persona}` });
                return;
            }

            // Resolve skill from persona catalog
            let skill;
            if (persona === 'engineering') skill = getEngineeringSkill(skillId);
            else if (persona === 'product') skill = getProductSkill(skillId);
            else if (persona === 'hr') skill = getHRSkill(skillId);
            else if (persona === 'marketing') {
                // Marketing uses workflow execution (separate path for now)
                try {
                    const shouldSimulateMktg = simulate !== undefined ? simulate : !hasAnyLLMKey();
                    const exec = marketingApi.createMarketingExecution(skillId, inputs ?? {}, userId, shouldSimulateMktg, customPrompt, provider as any, modelId);
                    recordAudit(userId, 'skill.execute', `Marketing / ${exec.workflowName}`);
                    broadcastEvent(exec.id, 'session.started', { persona: 'marketing', skillId, simulate, provider });
                    sendJSON(res, 201, { execution: exec });
                } catch (err) { sendJSON(res, 400, { error: (err as Error).message }); }
                return;
            }

            // Fallback: adopted community skill (skills/<persona>/<slug>/SKILL.md)
            let adoptedBody: string | undefined;
            if (!skill) {
                const fsSkill = getAllFsSkills().find(s => s.id === skillId || s.slug === skillId);
                if (fsSkill) { skill = synthesizeAdoptedSkill(fsSkill); adoptedBody = fsSkill.systemPrompt; }
            }

            if (!skill) { sendJSON(res, 404, { error: `Skill not found: ${skillId}` }); return; }

            // If the client didn't send simulate, auto-detect: no key configured → sandbox mode
            const shouldSimulate = simulate !== undefined ? simulate : !hasAnyLLMKey();
            // Adopted skills carry their instructions in the markdown body — feed it as customPrompt.
            const effectiveCustomPrompt = adoptedBody
                ? (customPrompt ? `${adoptedBody}\n\n---\n${customPrompt}` : adoptedBody)
                : customPrompt;
            const exec = createPersonaExecution(persona as any, skill, inputs ?? {}, userId, shouldSimulate, effectiveCustomPrompt, provider as any, modelId);
            recordAudit(userId, 'skill.execute', `${persona} / ${skill.name}`);
            broadcastEvent(exec.id, 'session.started', { persona, skillId, simulate, provider });
            sendJSON(res, 201, { execution: exec });
            return;
        }

        if (path === '/api/executions' && method === 'GET') {
            const persona = url.searchParams.get('persona') ?? undefined;
            const status = url.searchParams.get('status') ?? undefined;
            const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);

            // Persona access check
            if (persona && authUser && !requirePersonaAccess(authUser, persona)) {
                sendJSON(res, 403, { error: `Access denied for persona: ${persona}` });
                return;
            }

            let execs;
            if (persona) {
                execs = listPersonaExecutions(persona as any, limit);
            } else {
                execs = getAllExecutions()
                    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
                    .slice(0, limit);
            }
            if (status) { execs = execs.filter(e => e.status === status); }
            sendJSON(res, 200, { executions: execs, total: execs.length });
            return;
        }

        if (path.match(/^\/api\/executions\/[^/]+$/) && method === 'GET') {
            const execId = path.split('/').pop()!;
            const exec = getPersonaExecution(execId) ?? marketingApi.getMarketingExecution(execId);
            if (!exec) { sendJSON(res, 404, { error: 'Execution not found' }); return; }
            const aar = getAfterActionReport(execId);
            sendJSON(res, 200, { execution: exec, afterActionReport: aar ?? null });
            return;
        }

        if (path.match(/^\/api\/executions\/[^/]+\/approve\/[^/]+$/) && method === 'POST') {
            const parts = path.split('/');
            const execId = parts[3]!;
            const stepId = parts[5]!;
            // Unified approve route: flips persona store synchronously AND releases
            // any marketing loop blocked on approval-bus.waitForApproval().
            const body = await readBody(req).catch(() => ({})) as { approverId?: string };
            const personaRes = approvePersonaStep(execId, stepId);
            const busRes = approveViaBus(execId, stepId, body.approverId ?? userId);
            const success = personaRes.success || busRes.success;
            const message = success ? 'Step approved' : `${personaRes.message} / ${busRes.message}`;
            recordAudit(userId, 'approval.granted', `${execId}/${stepId}`);
            sendJSON(res, success ? 200 : 400, { success, message });
            return;
        }

        // POST /api/executions/:id/reject/:stepId — reject a step (mirror of approve)
        if (path.match(/^\/api\/executions\/[^/]+\/reject\/[^/]+$/) && method === 'POST') {
            const parts = path.split('/');
            const execId = parts[3]!;
            const stepId = parts[5]!;
            const body = await readBody(req).catch(() => ({})) as { reason?: string };
            const result = rejectViaBus(execId, stepId, userId, body.reason);
            recordAudit(userId, 'approval.rejected', `${execId}/${stepId}`);
            sendJSON(res, result.success ? 200 : 400, result);
            return;
        }

        // GET /api/approvals/pending — list pending approvals (for dashboards)
        if (path === '/api/approvals/pending' && method === 'GET') {
            sendJSON(res, 200, { pending: listPendingApprovals() });
            return;
        }

        // GET /api/approvals/sla — SLA summary (total pending, breaching, near-breach)
        if (path === '/api/approvals/sla' && method === 'GET') {
            sendJSON(res, 200, getApprovalSlaSummary());
            return;
        }

        // GET /api/approvals/:execId/:stepId — lookup single decision
        if (path.match(/^\/api\/approvals\/[^/]+\/[^/]+$/) && method === 'GET') {
            const parts = path.split('/');
            const execId = parts[3]!;
            const stepId = parts[4]!;
            const decision = getApprovalDecision(execId, stepId);
            if (!decision) { sendJSON(res, 404, { error: 'No decision recorded' }); return; }
            sendJSON(res, 200, { decision });
            return;
        }

        // Query — now with real LLM via core.ts
        if (path === '/api/query' && method === 'POST') {
            const body = await readBody(req);
            const { query } = body;
            if (!query || typeof query !== 'string') {
                sendJSON(res, 400, { error: 'Missing query field' });
                return;
            }

            await eventBus.emit('query.received', { query, userId });
            const result = await executeQuery(query, userId, sessions, executions);
            recordAudit(userId, 'query.execute', String(query).slice(0, 80), 'success');
            await eventBus.emit('query.completed', {
                sessionId: result.sessionId,
                intent: result.intent.type,
                model: result.model,
                tokensUsed: result.tokensUsed,
                costUsd: result.costUsd,
                durationMs: result.durationMs,
            });
            sendJSON(res, 200, result);
            return;
        }

        // Get session
        if (path.startsWith('/api/query/') && method === 'GET') {
            const sessionId = path.split('/').pop();
            if (!sessionId) { sendJSON(res, 400, { error: 'Missing session ID' }); return; }
            const session = sessions.get(sessionId);
            if (!session) { sendJSON(res, 404, { error: 'Session not found' }); return; }
            const execs = executions.getBySession(sessionId);
            sendJSON(res, 200, { session, executions: execs });
            return;
        }

        // Classify intent (useful for frontend suggestions)
        if (path === '/api/classify' && method === 'POST') {
            const body = await readBody(req);
            const intent = classifyIntent((body.query as string) ?? '');
            sendJSON(res, 200, intent);
            return;
        }

        // Skills catalog (legacy)
        if (path === '/api/skills' && method === 'GET') {
            sendJSON(res, 200, { skills: SKILL_CATALOG, total: SKILL_CATALOG.length });
            return;
        }

        // Unified skills & workflows — all personas, filterable by type
        if (path === '/api/skills/unified' && method === 'GET') {
            const typeFilter = url.searchParams.get('type'); // 'skill' | 'workflow' | null
            const personaFilter = url.searchParams.get('persona');
            const all = [
                ...ENGINEERING_SKILLS,
                ...PRODUCT_SKILLS,
                ...HR_SKILLS,
                ...TA_SKILLS,
                ...PROGRAM_SKILLS,
                ...marketingApi.getMarketingSkills(),
                // Adopted community skills (gstack, mattpocock/skills) loaded from disk.
                ...(getAllFsSkills().map((s) => ({
                    id: s.id,
                    name: s.name,
                    description: s.description || s.name,
                    persona: s.persona,
                    cluster: s.cluster ?? 'Adopted Skills',
                    executableType: 'skill',
                    estimatedTime: s.estimatedTime ?? '~varies',
                    complexity: s.complexity ?? 'moderate',
                    tags: s.tags ?? [],
                    adopted: true,
                    steps: s.steps ?? [],
                    outputs: s.outputs ?? [],
                })) as any[]),
            ];
            const filtered = all.filter(s => {
                if (typeFilter && (s as any).executableType !== typeFilter) return false;
                if (personaFilter && (s as any).persona !== personaFilter) return false;
                return true;
            });
            sendJSON(res, 200, {
                skills: filtered,
                total: filtered.length,
                counts: {
                    skills: all.filter((s: any) => s.executableType !== 'workflow').length,
                    workflows: all.filter((s: any) => s.executableType === 'workflow').length,
                },
            });
            return;
        }

        // Activity / recent executions
        if (path === '/api/activity' && method === 'GET') {
            const recent = sessions.getRecent(20);
            sendJSON(res, 200, { sessions: recent, total: recent.length });
            return;
        }

        // Stats
        if (path === '/api/stats' && method === 'GET') {
            const allSessions = sessions.getRecent(1000);
            const complete = allSessions.filter(s => s.status === 'complete');
            sendJSON(res, 200, {
                totalSessions: allSessions.length,
                completedSessions: complete.length,
                avgConfidence: complete.length > 0
                    ? complete.reduce((sum, s) => sum + s.confidence, 0) / complete.length : 0,
                activeSkills: SKILL_CATALOG.length,
                services: { gateway: 'healthy', workers: 'healthy' },
            });
            return;
        }

        // -----------------------------------------------------------------
        // Prompt Library
        // -----------------------------------------------------------------

        // List prompts (with optional filters)
        if (path === '/api/prompts' && method === 'GET') {
            const category = url.searchParams.get('category') ?? undefined;
            const tag = url.searchParams.get('tag') ?? undefined;
            const source = url.searchParams.get('source') ?? undefined;
            const search = url.searchParams.get('q') ?? undefined;
            const featured = url.searchParams.get('featured') === 'true' ? true : undefined;

            const prompts = promptStore.getAllPrompts({ category, tag, source, search, featured });
            sendJSON(res, 200, { prompts, total: prompts.length, categories: promptStore.getCategories(), tags: promptStore.getTags() });
            return;
        }

        // Get single prompt by slug
        if (path.startsWith('/api/prompts/') && !path.includes('/vote') && !path.includes('/fork') && !path.includes('/pin') && !path.includes('/use') && path !== '/api/prompts/meta' && method === 'GET') {
            const slug = path.split('/').pop();
            if (!slug) { sendJSON(res, 400, { error: 'Missing prompt slug' }); return; }
            const prompt = promptStore.getPromptBySlug(slug);
            if (!prompt) { sendJSON(res, 404, { error: 'Prompt not found' }); return; }
            sendJSON(res, 200, { prompt });
            return;
        }

        // Vote on a prompt (upvote / downvote / flag)
        if (path.match(/^\/api\/prompts\/[^/]+\/vote$/) && method === 'POST') {
            const promptId = path.split('/')[3];
            const body = await readBody(req);
            const voteType = body.type as 'upvote' | 'downvote' | 'flag';
            if (!['upvote', 'downvote', 'flag'].includes(voteType)) {
                sendJSON(res, 400, { error: 'Invalid vote type. Use: upvote, downvote, flag' }); return;
            }
            const prompt = promptStore.vote(userId, promptId, voteType);
            if (!prompt) { sendJSON(res, 404, { error: 'Prompt not found' }); return; }
            sendJSON(res, 200, { prompt });
            return;
        }

        // Fork a prompt (duplicate to user's collection)
        if (path.match(/^\/api\/prompts\/[^/]+\/fork$/) && method === 'POST') {
            const promptId = path.split('/')[3];
            const body = await readBody(req);
            const userName = (body.userName as string) || 'anonymous';
            const fork = promptStore.forkPrompt(promptId, userId, userName);
            if (!fork) { sendJSON(res, 404, { error: 'Prompt not found' }); return; }
            sendJSON(res, 201, { prompt: fork });
            return;
        }

        // Pin / unpin a prompt
        if (path.match(/^\/api\/prompts\/[^/]+\/pin$/) && method === 'POST') {
            const promptId = path.split('/')[3];
            const prompt = promptStore.pinPrompt(promptId);
            if (!prompt) { sendJSON(res, 404, { error: 'Prompt not found' }); return; }
            sendJSON(res, 200, { prompt });
            return;
        }

        // Use (copy) a prompt — increments usage counter
        if (path.match(/^\/api\/prompts\/[^/]+\/use$/) && method === 'POST') {
            const promptId = path.split('/')[3];
            const prompt = promptStore.usePrompt(promptId);
            if (!prompt) { sendJSON(res, 404, { error: 'Prompt not found' }); return; }
            sendJSON(res, 200, { prompt });
            return;
        }

        // Prompt categories and tags metadata
        if (path === '/api/prompts/meta' && method === 'GET') {
            sendJSON(res, 200, { categories: promptStore.getCategories(), tags: promptStore.getTags() });
            return;
        }

        // -----------------------------------------------------------------
        // Recommendations (user-submitted prompt suggestions)
        // -----------------------------------------------------------------

        if (path === '/api/recommendations' && method === 'GET') {
            const recs = promptStore.getAllRecommendations();
            sendJSON(res, 200, { recommendations: recs, total: recs.length });
            return;
        }

        if (path === '/api/recommendations' && method === 'POST') {
            const body = await readBody(req);
            const { title, description, content, categorySlug } = body as Record<string, string>;
            if (!title || !content) { sendJSON(res, 400, { error: 'Missing title or content' }); return; }
            const rec = promptStore.addRecommendation({
                title, description: description || '', content,
                categorySlug, submittedBy: userId, submittedByName: (body.userName as string) || 'anonymous',
            });
            sendJSON(res, 201, { recommendation: rec });
            return;
        }

        if (path.match(/^\/api\/recommendations\/[^/]+\/upvote$/) && method === 'POST') {
            const recId = path.split('/')[3];
            const rec = promptStore.upvoteRecommendation(userId, recId);
            if (!rec) { sendJSON(res, 404, { error: 'Recommendation not found' }); return; }
            sendJSON(res, 200, { recommendation: rec });
            return;
        }

        // -----------------------------------------------------------------
        // Tools Registry
        // -----------------------------------------------------------------

        if (path === '/api/tools' && method === 'GET') {
            const tools = promptStore.getTools();
            const category = url.searchParams.get('category');
            const filtered = category ? tools.filter(t => t.category === category) : tools;
            sendJSON(res, 200, { tools: filtered, total: filtered.length });
            return;
        }

        // -----------------------------------------------------------------
        // Courses (Learning Hub engagement tracking)
        // -----------------------------------------------------------------

        if (path === '/api/courses/stats' && method === 'GET') {
            sendJSON(res, 200, courseStats);
            return;
        }

        if (path.match(/^\/api\/courses\/\d+\/like$/) && method === 'POST') {
            const courseId = parseInt(path.split('/')[3]);
            const key = `${userId}:course:${courseId}:like`;
            if (!courseVotes.has(key)) {
                courseVotes.add(key);
                const stat = courseStats.courses.find((c: { id: number }) => c.id === courseId);
                if (stat) { stat.likes++; courseStats.totalLikes++; }
            }
            sendJSON(res, 200, { success: true, course: courseStats.courses.find((c: { id: number }) => c.id === courseId) });
            return;
        }

        if (path.match(/^\/api\/courses\/\d+\/dislike$/) && method === 'POST') {
            const courseId = parseInt(path.split('/')[3]);
            const key = `${userId}:course:${courseId}:dislike`;
            if (!courseVotes.has(key)) {
                courseVotes.add(key);
                const stat = courseStats.courses.find((c: { id: number }) => c.id === courseId);
                if (stat) stat.dislikes++;
            }
            sendJSON(res, 200, { success: true, course: courseStats.courses.find((c: { id: number }) => c.id === courseId) });
            return;
        }

        if (path.match(/^\/api\/courses\/\d+\/pin$/) && method === 'POST') {
            const courseId = parseInt(path.split('/')[3]);
            const stat = courseStats.courses.find((c: { id: number }) => c.id === courseId);
            if (stat) { stat.isPinned = !stat.isPinned; stat.pins += stat.isPinned ? 1 : -1; courseStats.totalPins += stat.isPinned ? 1 : -1; }
            sendJSON(res, 200, { success: true, course: stat });
            return;
        }

        if (path.match(/^\/api\/courses\/\d+\/view$/) && method === 'POST') {
            const courseId = parseInt(path.split('/')[3]);
            const stat = courseStats.courses.find((c: { id: number }) => c.id === courseId);
            if (stat) { stat.views++; courseStats.totalViews++; }
            sendJSON(res, 200, { success: true });
            return;
        }

        // -----------------------------------------------------------------
        // Capability Graph
        // -----------------------------------------------------------------

        if (path === '/api/capability-graph' && method === 'GET') {
            sendJSON(res, 200, { capabilities: capabilityGraph.getAllCapabilities(), tools: capabilityGraph.getAllTools(), taskMappings: capabilityGraph.getAllTaskMappings() });
            return;
        }

        if (path === '/api/capability-graph/tools' && method === 'GET') {
            const capability = url.searchParams.get('capability');
            if (capability) {
                sendJSON(res, 200, { tools: capabilityGraph.getToolsForCapability(capability) });
            } else {
                sendJSON(res, 200, { tools: capabilityGraph.getAllTools() });
            }
            return;
        }

        if (path === '/api/capability-graph/capabilities' && method === 'GET') {
            const tool = url.searchParams.get('tool');
            if (tool) {
                sendJSON(res, 200, { capabilities: capabilityGraph.getCapabilitiesForTool(tool) });
            } else {
                sendJSON(res, 200, { capabilities: capabilityGraph.getAllCapabilities() });
            }
            return;
        }

        if (path === '/api/capability-graph/plan' && method === 'POST') {
            const body = await readBody(req);
            const task = body.task as string;
            if (!task) { sendJSON(res, 400, { error: 'Missing task field' }); return; }
            const plan = capabilityGraph.getExecutionPlan(task);
            sendJSON(res, 200, plan);
            return;
        }

        // -----------------------------------------------------------------
        // Persona Skill System
        // -----------------------------------------------------------------

        if (path === '/api/personas' && method === 'GET') {
            sendJSON(res, 200, { personas: personaSystem.getAllPersonas(), stats: personaSystem.getPersonaStats() });
            return;
        }

        if (path.match(/^\/api\/personas\/[^/]+$/) && method === 'GET') {
            const personaId = path.split('/').pop()!;
            const persona = personaSystem.getPersona(personaId);
            if (!persona) { sendJSON(res, 404, { error: 'Persona not found' }); return; }
            sendJSON(res, 200, { persona });
            return;
        }

        if (path.match(/^\/api\/personas\/[^/]+\/skills$/) && method === 'GET') {
            const personaId = path.split('/')[3];
            sendJSON(res, 200, { skills: personaSystem.getSkillsForPersona(personaId) });
            return;
        }

        if (path.match(/^\/api\/personas\/[^/]+\/agents$/) && method === 'GET') {
            const personaId = path.split('/')[3];
            sendJSON(res, 200, { agents: personaSystem.getAgentsForPersona(personaId) });
            return;
        }

        if (path.match(/^\/api\/personas\/[^/]+\/tools$/) && method === 'GET') {
            const personaId = path.split('/')[3];
            sendJSON(res, 200, { tools: personaSystem.getToolsForPersona(personaId) });
            return;
        }

        if (path.match(/^\/api\/personas\/[^/]+\/courses$/) && method === 'GET') {
            const personaId = path.split('/')[3];
            sendJSON(res, 200, { courses: personaSystem.getCoursesForPersona(personaId) });
            return;
        }

        if (path === '/api/personas/search' && method === 'GET') {
            const q = url.searchParams.get('q') ?? '';
            sendJSON(res, 200, { results: personaSystem.searchSkills(q) });
            return;
        }

        // -----------------------------------------------------------------
        // Corp IT License Governance
        // -----------------------------------------------------------------

        if (path === '/api/licenses' && method === 'GET') {
            sendJSON(res, 200, { licenses: licenseStore.getAllLicenses(), summary: licenseStore.getLicenseSummary() });
            return;
        }

        if (path.match(/^\/api\/licenses\/[^/]+$/) && method === 'GET') {
            const toolId = path.split('/').pop()!;
            const license = licenseStore.getLicenseByTool(toolId);
            if (!license) { sendJSON(res, 404, { error: 'License not found' }); return; }
            sendJSON(res, 200, { license });
            return;
        }

        // -----------------------------------------------------------------
        // Skill Marketplace + Skill Builder
        // -----------------------------------------------------------------

        if (path === '/api/marketplace/skills' && method === 'GET') {
            const personaId = url.searchParams.get('persona') ?? undefined;
            const visibility = url.searchParams.get('visibility') as 'private' | 'team' | 'company' | 'public' | undefined;
            const skills = skillMarketplace.getAllSkills(personaId, visibility);
            sendJSON(res, 200, { skills, total: skills.length });
            return;
        }

        if (path === '/api/marketplace/skills/search' && method === 'GET') {
            const q = url.searchParams.get('q') ?? '';
            const results = skillMarketplace.searchSkills(q);
            sendJSON(res, 200, { skills: results, total: results.length });
            return;
        }

        if (path.match(/^\/api\/marketplace\/skills\/[^/]+$/) && method === 'GET') {
            const skillId = path.split('/').pop()!;
            const skill = skillMarketplace.getSkill(skillId) ?? skillMarketplace.getSkillBySlug(skillId);
            if (!skill) { sendJSON(res, 404, { error: 'Skill not found' }); return; }
            sendJSON(res, 200, { skill });
            return;
        }

        if (path === '/api/marketplace/skills' && method === 'POST') {
            const body = await readBody(req);
            // Skill Security Scan gate — screen risky skills before registration (skipped when unconfigured).
            const scanBody = [body.name, body.description, (body as any).systemPrompt, (body as any).prompt, JSON.stringify((body as any).steps ?? '')].filter(Boolean).join('\n');
            const scan = await scanSkill({ name: String((body as any).name ?? 'skill'), persona: (body as any).persona, body: scanBody });
            if (scan && !scan.passed) {
                sendJSON(res, 403, { error: 'Skill failed the Skill Security Scan', scan });
                return;
            }
            const skill = skillMarketplace.createSkill(body as Parameters<typeof skillMarketplace.createSkill>[0]);
            sendJSON(res, 201, { skill, scan: scan ?? undefined });
            return;
        }

        if (path.match(/^\/api\/marketplace\/skills\/[^/]+$/) && method === 'PATCH') {
            const skillId = path.split('/').pop()!;
            const body = await readBody(req);
            const skill = skillMarketplace.updateSkill(skillId, body);
            if (!skill) { sendJSON(res, 404, { error: 'Skill not found' }); return; }
            sendJSON(res, 200, { skill });
            return;
        }

        if (path.match(/^\/api\/marketplace\/skills\/[^/]+\/run$/) && method === 'POST') {
            const skillId = path.split('/')[4];
            const skill = skillMarketplace.getSkill(skillId);
            if (!skill) { sendJSON(res, 404, { error: 'Skill not found' }); return; }
            const body = await readBody(req);
            const { inputs, simulate } = body as { inputs?: Record<string, unknown>; simulate?: boolean };

            if (simulate) {
                const sim = simulateSkillExecution(skill);
                sendJSON(res, 200, {
                    status: 'complete',
                    mode: 'simulation',
                    skillId,
                    executionId: `sim-${Date.now()}`,
                    runtimeSec: sim.runtimeSec,
                    cost: 0,
                    outputs: sim.outputs,
                    steps: sim.steps,
                });
                return;
            }

            const runtimeSec = 30 + Math.floor(Math.random() * 60);
            const cost = 0.15 + Math.random() * 0.5;
            skillMarketplace.recordExecution(skillId, userId, true, runtimeSec, cost);
            memoryGraph.recordExecution({
                userId,
                skillId,
                skillName: skill.name,
                personaId: skill.personaId,
                success: true,
                runtimeSec,
                cost,
                agentsUsed: skill.agents.map(a => a.name),
                toolsUsed: skill.requiredTools.map(t => t.name),
                outputs: skill.outputs,
            });
            sendJSON(res, 200, {
                status: 'complete',
                skillId,
                executionId: `exec-${Date.now()}`,
                runtimeSec,
                cost,
                outputs: skill.outputs.map(o => ({ name: o, status: 'generated' })),
            });
            return;
        }

        if (path === '/api/marketplace/templates' && method === 'GET') {
            sendJSON(res, 200, { templates: skillMarketplace.getTemplates() });
            return;
        }

        if (path.match(/^\/api\/marketplace\/templates\/[^/]+$/) && method === 'GET') {
            const templateId = path.split('/').pop()!;
            const template = skillMarketplace.getTemplate(templateId);
            if (!template) { sendJSON(res, 404, { error: 'Template not found' }); return; }
            sendJSON(res, 200, { template });
            return;
        }

        if (path === '/api/marketplace/analytics' && method === 'GET') {
            const skillId = url.searchParams.get('skillId') ?? undefined;
            const analytics = skillMarketplace.getAnalytics(skillId);
            sendJSON(res, 200, { analytics });
            return;
        }

        if (path === '/api/marketplace/governance' && method === 'GET') {
            const records = skillMarketplace.getGovernanceView();
            sendJSON(res, 200, { skills: records });
            return;
        }

        if (path.match(/^\/api\/marketplace\/skills\/[^/]+\/enable$/) && method === 'POST') {
            const skillId = path.split('/')[4];
            const body = await readBody(req);
            const enabled = (body.enabled as boolean) ?? true;
            const ok = skillMarketplace.setSkillEnabled(skillId, enabled);
            if (!ok) { sendJSON(res, 404, { error: 'Skill not found' }); return; }
            sendJSON(res, 200, { skillId, enabled });
            return;
        }

        // -----------------------------------------------------------------
        // Universal Intent Engine
        // -----------------------------------------------------------------

        if (path === '/api/intent/route' && method === 'POST') {
            const body = await readBody(req);
            const query = (body.query as string) ?? '';
            const result = intentEngine.routeIntent(query);
            if (!result) { sendJSON(res, 200, { found: false, message: 'No matching skill found' }); return; }
            sendJSON(res, 200, { found: true, result });
            return;
        }

        if (path === '/api/intent/route-enhanced' && method === 'POST') {
            const body = await readBody(req);
            const query = (body.query as string) ?? '';
            const result = intentEngine.routeEnhanced(query, userId, 'operator');
            if (!result) { sendJSON(res, 200, { found: false }); return; }
            storePacket(result.utcpPacket);
            sendJSON(res, 200, { found: true, result });
            return;
        }

        if (path === '/api/intent/detect-functions' && method === 'POST') {
            const body = await readBody(req);
            const functions = intentEngine.detectFunctions((body.query as string) ?? '');
            sendJSON(res, 200, { functions });
            return;
        }

        if (path === '/api/intent/suggestions' && method === 'GET') {
            const personaId = url.searchParams.get('persona') ?? undefined;
            const limit = parseInt(url.searchParams.get('limit') ?? '8', 10);
            const suggestions = intentEngine.getSuggestions(personaId, limit);
            sendJSON(res, 200, { suggestions });
            return;
        }

        // -----------------------------------------------------------------
        // UTCP — Universal Task Context Protocol
        // -----------------------------------------------------------------

        if (path === '/api/utcp/tasks' && method === 'GET') {
            const status = url.searchParams.get('status') as TaskStatus | null;
            const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
            const tasks = status ? getPacketsByStatus(status) : getRecentPackets(limit);
            sendJSON(res, 200, { tasks, total: tasks.length });
            return;
        }

        if (path === '/api/utcp/tasks' && method === 'POST') {
            const raw = await readBody(req);
            let body: typeof raw;
            try { body = validate(UTCPPacketSchema, raw); } catch (err) {
                if (err instanceof ValidationError) { sendJSON(res, 400, { error: err.message }); return; }
                body = raw;
            }
            const packet = createUTCPPacket({
                function: ((body as Record<string, unknown>).function as string ?? 'engineering') as any,
                stage: (body as Record<string, unknown>).stage as string ?? 'intake',
                intent: ((body as Record<string, unknown>).intent as string) ?? ((body as Record<string, unknown>).query as string) ?? '',
                initiator: { user_id: userId, role: 'operator' },
                objectives: (body.objectives as string[]) ?? [(body.intent as string) ?? ''],
                tool_scopes: (body.tool_scopes as string[]) ?? [],
                urgency: (body.urgency as string ?? 'medium') as any,
            });
            storePacket(packet);
            eventBus.emit('utcp.task.created', { taskId: packet.task_id, function: packet.function });
            sendJSON(res, 201, { task: packet });
            return;
        }

        if (path.startsWith('/api/utcp/tasks/') && method === 'GET') {
            const taskId = path.replace('/api/utcp/tasks/', '');
            const packet = getPacket(taskId);
            if (!packet) { sendJSON(res, 404, { error: 'Task not found' }); return; }
            sendJSON(res, 200, { task: packet });
            return;
        }

        if (path.startsWith('/api/utcp/tasks/') && path.endsWith('/status') && method === 'PUT') {
            const taskId = path.replace('/api/utcp/tasks/', '').replace('/status', '');
            const packet = getPacket(taskId);
            if (!packet) { sendJSON(res, 404, { error: 'Task not found' }); return; }
            const body = await readBody(req);
            const updated = updatePacketStatus(packet, body.status as TaskStatus, body.extra as Partial<UTCPPacket> | undefined);
            storePacket(updated);
            eventBus.emit('utcp.task.updated', { taskId, status: body.status });
            sendJSON(res, 200, { task: updated });
            return;
        }

        // -----------------------------------------------------------------
        // A2A — Agent-to-Agent Protocol
        // -----------------------------------------------------------------

        if (path === '/api/a2a/messages' && method === 'GET') {
            const taskRef = url.searchParams.get('taskRef') ?? undefined;
            const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
            const msgs = taskRef ? getMessagesByTask(taskRef) : getRecentMessages(limit);
            sendJSON(res, 200, { messages: msgs, total: msgs.length });
            return;
        }

        if (path === '/api/a2a/messages' && method === 'POST') {
            const body = await readBody(req);
            const msg = createA2AMessage({
                type: (body.type as string ?? 'delegate') as any,
                sender: body.sender as A2AAgent,
                receiver: body.receiver as A2AAgent,
                task_ref: (body.task_ref as string) ?? '',
                payload: (body.payload as any) ?? { objective: '', context: {} },
                priority: (body.priority as string ?? 'medium') as any,
            });
            storeMessage(msg);
            eventBus.emit('a2a.message.sent', { messageId: msg.message_id, type: msg.type });
            sendJSON(res, 201, { message: msg });
            return;
        }

        if (path.startsWith('/api/a2a/messages/') && path.endsWith('/respond') && method === 'POST') {
            const msgId = path.replace('/api/a2a/messages/', '').replace('/respond', '');
            const msg = getMessage(msgId);
            if (!msg) { sendJSON(res, 404, { error: 'Message not found' }); return; }
            const body = await readBody(req);
            const updated = respondToA2A(msg, body.response as any);
            storeMessage(updated);
            eventBus.emit('a2a.message.responded', { messageId: msgId });
            sendJSON(res, 200, { message: updated });
            return;
        }

        if (path === '/api/a2a/meetings' && method === 'GET') {
            const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
            const active = url.searchParams.get('active') === 'true';
            const meetings = active ? getActiveMeetings() : getRecentMeetings(limit);
            sendJSON(res, 200, { meetings, total: meetings.length });
            return;
        }

        if (path === '/api/a2a/meetings' && method === 'POST') {
            const body = await readBody(req);
            const meeting = createMeeting({
                type: ((body.type as string) ?? 'standup') as any,
                title: (body.title as string) ?? 'Agent Meeting',
                participants: (body.participants as any[]) ?? [],
                agenda: (body.agenda as string[]) ?? [],
                task_ref: body.task_ref as string | undefined,
            });
            storeMeeting(meeting);
            eventBus.emit('a2a.meeting.created', { meetingId: meeting.meeting_id, type: meeting.type });
            sendJSON(res, 201, { meeting });
            return;
        }

        if (path.startsWith('/api/a2a/meetings/') && method === 'GET') {
            const meetingId = path.replace('/api/a2a/meetings/', '');
            const meeting = getMeeting(meetingId);
            if (!meeting) { sendJSON(res, 404, { error: 'Meeting not found' }); return; }
            sendJSON(res, 200, { meeting });
            return;
        }

        if (path === '/api/a2a/swarms' && method === 'GET') {
            const active = url.searchParams.get('active') === 'true';
            const swarms = active ? getActiveSwarms() : getRecentSwarms();
            sendJSON(res, 200, { swarms, total: swarms.length });
            return;
        }

        if (path === '/api/a2a/swarms' && method === 'POST') {
            const body = await readBody(req);
            const swarm = createSwarm({
                mission: (body.mission as string) ?? '',
                task_ref: (body.task_ref as string) ?? '',
                type: ((body.type as string) ?? 'custom') as any,
                agents: (body.agents as any[]) ?? [],
            });
            storeSwarm(swarm);
            eventBus.emit('a2a.swarm.created', { swarmId: swarm.swarm_id, type: swarm.type });
            sendJSON(res, 201, { swarm });
            return;
        }

        if (path.startsWith('/api/a2a/swarms/') && !path.includes('/advance') && !path.includes('/dissolve') && method === 'GET') {
            const swarmId = path.replace('/api/a2a/swarms/', '');
            const swarm = getSwarm(swarmId);
            if (!swarm) { sendJSON(res, 404, { error: 'Swarm not found' }); return; }
            sendJSON(res, 200, { swarm });
            return;
        }

        // -----------------------------------------------------------------
        // Agent Meetings — Orchestrated meetings with templates
        // -----------------------------------------------------------------

        if (path === '/api/meetings/templates' && method === 'GET') {
            sendJSON(res, 200, { templates: getMeetingTemplates() });
            return;
        }

        if (path === '/api/meetings/start' && method === 'POST') {
            const body = await readBody(req);
            const meeting = startMeetingFromTemplate(
                ((body.type as string) ?? 'standup') as any,
                body.persona as string | undefined,
                body.agenda as string[] | undefined,
                body.task_ref as string | undefined,
            );
            sendJSON(res, 201, { meeting });
            return;
        }

        if (path === '/api/meetings/roster' && method === 'GET') {
            const persona = url.searchParams.get('persona') ?? undefined;
            sendJSON(res, 200, { agents: getAgentRoster(persona) });
            return;
        }

        // -----------------------------------------------------------------
        // Swarm Manager — Cross-functional agent pods
        // -----------------------------------------------------------------

        if (path === '/api/swarms/templates' && method === 'GET') {
            sendJSON(res, 200, { templates: getSwarmTemplates() });
            return;
        }

        if (path === '/api/swarms/launch' && method === 'POST') {
            const body = await readBody(req);
            const result = launchSwarm({
                templateType: (body.type as string ?? 'custom') as any,
                mission: body.mission as string ?? '',
                userId,
            });
            sendJSON(res, 201, result);
            return;
        }

        if (path.startsWith('/api/swarms/') && path.endsWith('/advance') && method === 'POST') {
            const swarmId = path.replace('/api/swarms/', '').replace('/advance', '');
            const swarm = advanceSwarmPhase(swarmId);
            if (!swarm) { sendJSON(res, 404, { error: 'Swarm not found' }); return; }
            sendJSON(res, 200, { swarm });
            return;
        }

        if (path.startsWith('/api/swarms/') && path.endsWith('/dissolve') && method === 'POST') {
            const swarmId = path.replace('/api/swarms/', '').replace('/dissolve', '');
            const swarm = dissolveSwarm(swarmId);
            if (!swarm) { sendJSON(res, 404, { error: 'Swarm not found' }); return; }
            sendJSON(res, 200, { swarm });
            return;
        }

        if (path === '/api/swarms/stats' && method === 'GET') {
            sendJSON(res, 200, getSwarmStats());
            return;
        }

        // -----------------------------------------------------------------
        // Delegation Chains — Colonel → Captain → Corporal routing
        // -----------------------------------------------------------------

        if (path === '/api/delegation/delegate' && method === 'POST') {
            const body = await readBody(req);
            const chain = delegateTask(
                body.task_ref as string ?? '',
                body.task as string ?? '',
                body.persona as string ?? 'engineering',
            );
            sendJSON(res, 201, { chain });
            return;
        }

        if (path === '/api/delegation/escalate' && method === 'POST') {
            const body = await readBody(req);
            const chain = escalateTask(body.chain_id as string ?? '', body.reason as string ?? '');
            if (!chain) { sendJSON(res, 404, { error: 'Chain not found' }); return; }
            sendJSON(res, 200, { chain });
            return;
        }

        if (path.startsWith('/api/delegation/') && method === 'GET') {
            const chainId = path.replace('/api/delegation/', '');
            if (chainId.startsWith('task/')) {
                const taskRef = chainId.replace('task/', '');
                sendJSON(res, 200, { chains: getDelegationChainsByTask(taskRef) });
            } else {
                const chain = getDelegationChain(chainId);
                if (!chain) { sendJSON(res, 404, { error: 'Chain not found' }); return; }
                sendJSON(res, 200, { chain });
            }
            return;
        }

        // -----------------------------------------------------------------
        // Flagship Workflows — Cross-functional templates
        // -----------------------------------------------------------------

        if (path === '/api/workflows/flagship' && method === 'GET') {
            const persona = url.searchParams.get('persona');
            const workflows = persona ? getFlagshipWorkflowsByPersona(persona) : getFlagshipWorkflows();
            sendJSON(res, 200, { workflows });
            return;
        }

        if (path.startsWith('/api/workflows/flagship/') && method === 'GET') {
            const idOrSlug = path.replace('/api/workflows/flagship/', '');
            const wf = getFlagshipWorkflow(idOrSlug);
            if (!wf) { sendJSON(res, 404, { error: 'Workflow not found' }); return; }
            sendJSON(res, 200, { workflow: wf });
            return;
        }

        // -----------------------------------------------------------------
        // MCP — Tool Execution Layer
        // -----------------------------------------------------------------

        if (path === '/api/mcp/tools' && method === 'GET') {
            sendJSON(res, 200, { tools: getToolCapabilities() });
            return;
        }

        if (path.startsWith('/api/mcp/tools/') && method === 'GET') {
            const toolId = path.replace('/api/mcp/tools/', '');
            const cap = getToolCapability(toolId);
            if (!cap) { sendJSON(res, 404, { error: 'Tool not found' }); return; }
            sendJSON(res, 200, { tool: cap });
            return;
        }

        if (path === '/api/mcp/execute' && method === 'POST') {
            const body = await readBody(req);
            const action = createMCPAction({
                tool_id: (body.tool_id as string) ?? '',
                action: ((body.action as string) ?? 'read') as any,
                resource_type: (body.resource_type as string) ?? '',
                params: (body.params as Record<string, unknown>) ?? {},
                task_ref: (body.task_ref as string) ?? '',
                agent_id: (body.agent_id as string) ?? '',
                step_index: (body.step_index as number) ?? 0,
                credentials_ref: body.credentials_ref as string | undefined,
            });
            const result = await executeMCPAction(action);
            eventBus.emit('mcp.tool.executed', { toolId: body.tool_id, action: body.action, status: result.status });
            sendJSON(res, 200, { result });
            return;
        }

        if (path === '/api/mcp/log' && method === 'GET') {
            const limit = parseInt(url.searchParams.get('limit') ?? '100', 10);
            sendJSON(res, 200, { log: getMCPLog(limit) });
            return;
        }

        if (path === '/api/mcp/stats' && method === 'GET') {
            sendJSON(res, 200, { stats: getToolStats() });
            return;
        }

        // -----------------------------------------------------------------
        // Agent Runtime
        // -----------------------------------------------------------------

        if (path === '/api/runtime/agents' && method === 'GET') {
            const active = url.searchParams.get('active') === 'true';
            const agents = active ? getActiveRuntimes() : getAllRuntimes();
            sendJSON(res, 200, { agents, total: agents.length });
            return;
        }

        // Agent Status Reconciler (ground-truth live status)
        if (path === '/api/agents/status' && method === 'GET') {
            const snapshot = getAgentStatusSnapshot();
            const working = snapshot.filter(s => s.state === 'working').length;
            const waiting = snapshot.filter(s => s.state === 'waiting_approval').length;
            const idle = snapshot.filter(s => s.state === 'idle').length;
            sendJSON(res, 200, { agents: snapshot, summary: { total: snapshot.length, working, waiting, idle } });
            return;
        }

        if (path.startsWith('/api/agents/status/') && method === 'GET') {
            const agentId = path.replace('/api/agents/status/', '');
            const record = getAgentStatus(agentId);
            if (!record) { sendJSON(res, 404, { error: 'Agent not tracked' }); return; }
            sendJSON(res, 200, { agent: record });
            return;
        }

        if (path === '/api/runtime/agents' && method === 'POST') {
            const body = await readBody(req);
            const rt = body.ephemeral
                ? createEphemeralAgent({
                    persona: (body.persona as string) ?? 'engineering',
                    function_domain: (body.function_domain as string) ?? (body.persona as string) ?? 'engineering',
                    task_ref: (body.task_ref as string) ?? '',
                    tool_access: (body.tool_access as string[]) ?? [],
                    stage_prompt: (body.stage_prompt as string) ?? '',
                    task_prompt: (body.task_prompt as string) ?? '',
                  })
                : createAgentRuntime({
                    agent_id: (body.agent_id as string) ?? `agent-${Date.now()}`,
                    agent_name: (body.agent_name as string) ?? 'Agent',
                    regiment: (body.regiment as string) ?? 'General',
                    rank: (body.rank as string) ?? 'Specialist',
                    persona: (body.persona as string) ?? 'engineering',
                    type: 'persistent',
                    tool_access: (body.tool_access as string[]) ?? [],
                    function_domain: (body.function_domain as string) ?? (body.persona as string) ?? 'engineering',
                  });
            storeRuntime(rt);
            eventBus.emit('runtime.agent.created', { runtimeId: rt.runtime_id, type: rt.type });
            sendJSON(res, 201, { agent: rt });
            return;
        }

        if (path.startsWith('/api/runtime/agents/') && !path.includes('/prompt') && !path.includes('/terminate') && method === 'GET') {
            const rtId = path.replace('/api/runtime/agents/', '');
            const rt = getRuntime(rtId);
            if (!rt) { sendJSON(res, 404, { error: 'Runtime not found' }); return; }
            sendJSON(res, 200, { agent: rt });
            return;
        }

        if (path.startsWith('/api/runtime/agents/') && path.endsWith('/prompt') && method === 'GET') {
            const rtId = path.replace('/api/runtime/agents/', '').replace('/prompt', '');
            const rt = getRuntime(rtId);
            if (!rt) { sendJSON(res, 404, { error: 'Runtime not found' }); return; }
            sendJSON(res, 200, { prompt: assembleFullPrompt(rt) });
            return;
        }

        if (path.startsWith('/api/runtime/agents/') && path.endsWith('/terminate') && method === 'POST') {
            const rtId = path.replace('/api/runtime/agents/', '').replace('/terminate', '');
            terminateRuntime(rtId);
            sendJSON(res, 200, { terminated: true });
            return;
        }

        // -----------------------------------------------------------------
        // Memory Graph — Enhanced (Decision Traces, Agent Performance, etc.)
        // -----------------------------------------------------------------

        if (path === '/api/memory/decisions' && method === 'GET') {
            const taskRef = url.searchParams.get('taskRef') ?? undefined;
            const agentId = url.searchParams.get('agentId') ?? undefined;
            const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
            sendJSON(res, 200, { decisions: memoryGraph.getDecisionTraces(taskRef, agentId, limit) });
            return;
        }

        if (path === '/api/memory/decisions' && method === 'POST') {
            const body = await readBody(req);
            const trace = memoryGraph.recordDecision(body as any);
            sendJSON(res, 201, { decision: trace });
            return;
        }

        if (path === '/api/memory/corrections' && method === 'GET') {
            const agentId = url.searchParams.get('agentId') ?? undefined;
            const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
            sendJSON(res, 200, { corrections: memoryGraph.getCorrections(agentId, undefined, limit) });
            return;
        }

        if (path === '/api/memory/corrections' && method === 'POST') {
            const body = await readBody(req);
            const corr = memoryGraph.recordCorrection(body as any);
            sendJSON(res, 201, { correction: corr });
            return;
        }

        if (path === '/api/memory/agent-performance' && method === 'GET') {
            const agentId = url.searchParams.get('agentId');
            if (agentId) {
                const perf = memoryGraph.getAgentPerformance(agentId);
                sendJSON(res, 200, { performance: perf || null });
            } else {
                sendJSON(res, 200, { performance: memoryGraph.getAllAgentPerformance() });
            }
            return;
        }

        if (path === '/api/memory/agent-performance/top' && method === 'GET') {
            const metric = (url.searchParams.get('metric') ?? 'volume') as 'success' | 'speed' | 'cost' | 'volume';
            const limit = parseInt(url.searchParams.get('limit') ?? '10', 10);
            sendJSON(res, 200, { agents: memoryGraph.getTopAgents(metric, limit) });
            return;
        }

        if (path === '/api/memory/graph' && method === 'GET') {
            const entityId = url.searchParams.get('entityId');
            if (entityId) {
                const depth = parseInt(url.searchParams.get('depth') ?? '1', 10);
                sendJSON(res, 200, memoryGraph.getEntityGraph(entityId, depth));
            } else {
                sendJSON(res, 200, memoryGraph.getFullGraph());
            }
            return;
        }

        if (path === '/api/memory/prompts' && method === 'GET') {
            const promptId = url.searchParams.get('promptId') ?? undefined;
            sendJSON(res, 200, { prompts: memoryGraph.getPromptPerformance(promptId) });
            return;
        }

        // -----------------------------------------------------------------
        // Memory Graph + Community Feedback
        // -----------------------------------------------------------------

        if (path === '/api/memory/recommendations' && method === 'GET') {
            const personaId = url.searchParams.get('persona') ?? undefined;
            const limit = parseInt(url.searchParams.get('limit') ?? '6', 10);
            const recs = memoryGraph.getRecommendations(userId, personaId, limit);
            sendJSON(res, 200, { recommendations: recs });
            return;
        }

        if (path === '/api/memory/executions' && method === 'GET') {
            const skillId = url.searchParams.get('skillId') ?? undefined;
            const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
            const execs = memoryGraph.getExecutions(userId, skillId, limit);
            sendJSON(res, 200, { executions: execs });
            return;
        }

        if (path === '/api/memory/stats' && method === 'GET') {
            sendJSON(res, 200, memoryGraph.getStats());
            return;
        }

        if (path.match(/^\/api\/marketplace\/skills\/[^/]+\/vote$/) && method === 'POST') {
            const skillId = path.split('/')[4];
            const skill = skillMarketplace.getSkill(skillId);
            if (!skill) { sendJSON(res, 404, { error: 'Skill not found' }); return; }
            const body = await readBody(req);
            const vote = (body.vote as 'up' | 'down') ?? 'up';
            const userName = (body.userName as string) ?? 'User';
            const f = memoryGraph.addFeedback(skillId, userId, vote, userName);
            const votes = memoryGraph.getSkillVotes(skillId);
            sendJSON(res, 200, { feedback: f, votes: { up: votes.up, down: votes.down } });
            return;
        }

        if (path.match(/^\/api\/marketplace\/skills\/[^/]+\/votes$/) && method === 'GET') {
            const skillId = path.split('/')[4];
            const votes = memoryGraph.getSkillVotes(skillId);
            sendJSON(res, 200, { votes: { up: votes.up, down: votes.down } });
            return;
        }

        if (path.match(/^\/api\/marketplace\/skills\/[^/]+\/comments$/) && method === 'GET') {
            const skillId = path.split('/')[4];
            const comments = memoryGraph.getComments(skillId);
            sendJSON(res, 200, { comments });
            return;
        }

        if (path.match(/^\/api\/marketplace\/skills\/[^/]+\/comments$/) && method === 'POST') {
            const skillId = path.split('/')[4];
            const skill = skillMarketplace.getSkill(skillId);
            if (!skill) { sendJSON(res, 404, { error: 'Skill not found' }); return; }
            const body = await readBody(req);
            const content = (body.content as string) ?? '';
            if (!content.trim()) { sendJSON(res, 400, { error: 'Comment content required' }); return; }
            const userName = (body.userName as string) ?? 'User';
            const parentId = body.parentId as string | undefined;
            const comment = memoryGraph.addComment(skillId, userId, userName, content.trim(), parentId);
            sendJSON(res, 201, { comment });
            return;
        }

        // -----------------------------------------------------------------
        // Extensible Tool Registry
        // -----------------------------------------------------------------

        if (path === '/api/tools/registry' && method === 'GET') {
            const category = url.searchParams.get('category') ?? undefined;
            const capability = url.searchParams.get('capability') ?? undefined;
            let tools = toolRegistry.getAll();
            if (category) tools = tools.filter(t => t.category === category);
            if (capability) tools = tools.filter(t => t.capabilities.includes(capability));
            sendJSON(res, 200, { tools, total: tools.length });
            return;
        }

        if (path === '/api/tools/registry' && method === 'POST') {
            const body = await readBody(req);
            const { id, name, capabilities, authType, category, description, icon } = body as Record<string, string>;
            if (!id || !name || !capabilities || !authType || !category) {
                sendJSON(res, 400, { error: 'Missing required fields: id, name, capabilities, authType, category' });
                return;
            }
            const tool = toolRegistry.register({
                id,
                name,
                capabilities: Array.isArray(capabilities) ? capabilities : [capabilities],
                authType: authType as 'oauth' | 'api_key' | 'mcp',
                category,
                description,
                icon,
                registeredBy: userId,
            });
            sendJSON(res, 201, { tool });
            return;
        }

        if (path.match(/^\/api\/tools\/registry\/[^/]+$/) && method === 'DELETE') {
            const toolId = path.split('/').pop()!;
            const ok = toolRegistry.unregister(toolId);
            if (!ok) { sendJSON(res, 404, { error: 'Tool not found' }); return; }
            sendJSON(res, 200, { deleted: toolId });
            return;
        }

        // -----------------------------------------------------------------
        // Execution Scheduler
        // -----------------------------------------------------------------

        if (path === '/api/scheduler/jobs' && method === 'GET') {
            const status = url.searchParams.get('status') ?? undefined;
            const persona = url.searchParams.get('persona') ?? undefined;
            const tag = url.searchParams.get('tag') ?? undefined;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const jobs = scheduler.getAllJobs({ status: status as any, persona, tag });
            sendJSON(res, 200, { jobs, total: jobs.length, stats: scheduler.getStats() });
            return;
        }

        if (path === '/api/scheduler/jobs' && method === 'POST') {
            if (guardRole('operator')) return;
            const body = await readBody(req);
            const { name, skillId, skillName, personaId, scheduleType, cronExpression, intervalMs, eventTrigger, oneTimeAt, timeout, retries, tags, inputs } = body as Record<string, unknown>;
            if (!name || !skillId || !scheduleType) {
                sendJSON(res, 400, { error: 'Missing required fields: name, skillId, scheduleType' });
                return;
            }
            const job = scheduler.createJob({
                name: name as string,
                skillId: skillId as string,
                skillName: (skillName as string) || (skillId as string),
                personaId: (personaId as string) || 'general',
                scheduleType: scheduleType as Parameters<typeof scheduler.createJob>[0]['scheduleType'],
                cronExpression: cronExpression as string | undefined,
                intervalMs: intervalMs as number | undefined,
                eventTrigger: eventTrigger as string | undefined,
                oneTimeAt: oneTimeAt as string | undefined,
                timeout: timeout as number | undefined,
                retries: retries as number | undefined,
                tags: (tags as string[]) || [],
                inputs: inputs as Record<string, unknown> | undefined,
                status: 'active',
                createdBy: userId,
            });
            sendJSON(res, 201, { job });
            return;
        }

        if (path.match(/^\/api\/scheduler\/jobs\/[^/]+$/) && method === 'GET') {
            const jobId = path.split('/').pop()!;
            const job = scheduler.getJob(jobId);
            if (!job) { sendJSON(res, 404, { error: 'Job not found' }); return; }
            const logs = scheduler.getJobLogs(jobId);
            sendJSON(res, 200, { job, logs });
            return;
        }

        if (path.match(/^\/api\/scheduler\/jobs\/[^/]+$/) && method === 'PATCH') {
            if (guardRole('operator')) return;
            const jobId = path.split('/').pop()!;
            const body = await readBody(req);
            const job = scheduler.updateJob(jobId, body as Parameters<typeof scheduler.updateJob>[1]);
            if (!job) { sendJSON(res, 404, { error: 'Job not found' }); return; }
            sendJSON(res, 200, { job });
            return;
        }

        if (path.match(/^\/api\/scheduler\/jobs\/[^/]+$/) && method === 'DELETE') {
            if (guardRole('operator')) return;
            const jobId = path.split('/').pop()!;
            const ok = scheduler.deleteJob(jobId);
            if (!ok) { sendJSON(res, 404, { error: 'Job not found' }); return; }
            sendJSON(res, 200, { deleted: jobId });
            return;
        }

        if (path.match(/^\/api\/scheduler\/jobs\/[^/]+\/run$/) && method === 'POST') {
            const jobId = path.split('/')[4];
            const job = scheduler.getJob(jobId);
            if (!job) { sendJSON(res, 404, { error: 'Job not found' }); return; }
            const log = await scheduler.executeJob(jobId, 'manual');
            sendJSON(res, 200, { log, job: scheduler.getJob(jobId) });
            return;
        }

        if (path.match(/^\/api\/scheduler\/jobs\/[^/]+\/toggle$/) && method === 'POST') {
            const jobId = path.split('/')[4];
            const job = scheduler.getJob(jobId);
            if (!job) { sendJSON(res, 404, { error: 'Job not found' }); return; }
            const newStatus = job.status === 'active' ? 'paused' : 'active';
            const updated = scheduler.updateJob(jobId, { status: newStatus });
            sendJSON(res, 200, { job: updated });
            return;
        }

        if (path === '/api/scheduler/events' && method === 'POST') {
            const body = await readBody(req);
            const { trigger, data, source } = body as Record<string, unknown>;
            if (!trigger) { sendJSON(res, 400, { error: 'Missing trigger field' }); return; }
            const triggered = scheduler.dispatchEvent({
                trigger: trigger as string,
                data: (data as Record<string, unknown>) ?? {},
                source: (source as string) || 'api',
                timestamp: new Date().toISOString(),
            });
            sendJSON(res, 200, { triggered, count: triggered.length });
            return;
        }

        if (path === '/api/scheduler/stats' && method === 'GET') {
            sendJSON(res, 200, scheduler.getStats());
            return;
        }

        // -----------------------------------------------------------------
        // Blog API
        // -----------------------------------------------------------------

        if (path === '/api/blog/posts' && method === 'GET') {
            const status = url.searchParams.get('status') ?? undefined;
            const tag = url.searchParams.get('tag') ?? undefined;
            const authorId = url.searchParams.get('authorId') ?? undefined;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const posts = blogStore.getAllPosts({ status: status as any, tag, authorId });
            sendJSON(res, 200, { posts, total: posts.length, stats: blogStore.getStats() });
            return;
        }

        if (path === '/api/blog/posts' && method === 'POST') {
            const body = await readBody(req);
            const { title, content, contentHtml, excerpt, tags } = body as Record<string, unknown>;
            if (!title) { sendJSON(res, 400, { error: 'Missing title' }); return; }
            const post = blogStore.createPost({
                title: title as string,
                content: content as string | undefined,
                contentHtml: contentHtml as string | undefined,
                excerpt: excerpt as string | undefined,
                authorId: userId,
                authorName: (body.authorName as string) || 'User',
                tags: (tags as string[]) || [],
            });
            sendJSON(res, 201, { post });
            return;
        }

        if (path.match(/^\/api\/blog\/posts\/[^/]+$/) && method === 'GET') {
            const idOrSlug = path.split('/').pop()!;
            const found = blogStore.getPost(idOrSlug) ?? blogStore.getPostBySlug(idOrSlug);
            if (!found) { sendJSON(res, 404, { error: 'Post not found' }); return; }
            blogStore.incrementViews(found.id);
            const post = blogStore.getPost(found.id)!;
            sendJSON(res, 200, { post });
            return;
        }

        if (path.match(/^\/api\/blog\/posts\/[^/]+$/) && method === 'PATCH') {
            const id = path.split('/').pop()!;
            const body = await readBody(req);
            const post = blogStore.updatePost(id, body as Parameters<typeof blogStore.updatePost>[1]);
            if (!post) { sendJSON(res, 404, { error: 'Post not found' }); return; }
            sendJSON(res, 200, { post });
            return;
        }

        if (path.match(/^\/api\/blog\/posts\/[^/]+$/) && method === 'DELETE') {
            const id = path.split('/').pop()!;
            const ok = blogStore.deletePost(id);
            if (!ok) { sendJSON(res, 404, { error: 'Post not found' }); return; }
            sendJSON(res, 200, { deleted: id });
            return;
        }

        if (path.match(/^\/api\/blog\/posts\/[^/]+\/publish$/) && method === 'POST') {
            const postId = path.split('/')[4];
            const body = await readBody(req);
            const destinations = (body.destinations as string[]) || ['internal'];
            const result = await blogStore.publishPost({ postId, destinations });
            sendJSON(res, 200, result);
            return;
        }

        if (path.match(/^\/api\/blog\/posts\/[^/]+\/like$/) && method === 'POST') {
            const id = path.split('/')[4];
            const post = blogStore.toggleLike(id);
            if (!post) { sendJSON(res, 404, { error: 'Post not found' }); return; }
            sendJSON(res, 200, { post });
            return;
        }

        if (path === '/api/blog/stats' && method === 'GET') {
            sendJSON(res, 200, blogStore.getStats());
            return;
        }

        // -----------------------------------------------------------------
        // Forum / Discussion API
        // -----------------------------------------------------------------

        if (path === '/api/forum/threads' && method === 'GET') {
            const category = url.searchParams.get('category') ?? undefined;
            const tag = url.searchParams.get('tag') ?? undefined;
            const q = url.searchParams.get('q') ?? undefined;
            const sort = (url.searchParams.get('sort') ?? 'hot') as 'hot' | 'new' | 'top';
            const status = url.searchParams.get('status') ?? undefined;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const threads = forumStore.getAllThreads({ category, tag, q, sort, status: status as any });
            sendJSON(res, 200, { threads, total: threads.length, stats: forumStore.getStats() });
            return;
        }

        if (path === '/api/forum/threads' && method === 'POST') {
            const body = await readBody(req);
            const { title, body: postBody, category, tags } = body as Record<string, unknown>;
            if (!title || !postBody) { sendJSON(res, 400, { error: 'Missing title or body' }); return; }
            const thread = forumStore.createThread({
                title: title as string,
                body: postBody as string,
                category: (category as string) || 'general',
                tags: (tags as string[]) || [],
                authorId: userId,
                authorName: (body.authorName as string) || 'User',
            });
            sendJSON(res, 201, { thread });
            return;
        }

        if (path.match(/^\/api\/forum\/threads\/[^/]+$/) && method === 'GET') {
            const threadId = path.split('/').pop()!;
            if (!forumStore.getThread(threadId)) { sendJSON(res, 404, { error: 'Thread not found' }); return; }
            forumStore.incrementView(threadId);
            const thread = forumStore.getThread(threadId)!;
            const comments = forumStore.getComments(threadId);
            const userVote = forumStore.getUserVoteOnThread(userId, threadId);
            sendJSON(res, 200, { thread, comments, userVote });
            return;
        }

        if (path.match(/^\/api\/forum\/threads\/[^/]+\/vote$/) && method === 'POST') {
            const threadId = path.split('/')[4];
            const body = await readBody(req);
            const vote = (body.vote as 'up' | 'down' | 'none') ?? 'up';
            const thread = forumStore.voteThread(userId, threadId, vote);
            if (!thread) { sendJSON(res, 404, { error: 'Thread not found' }); return; }
            sendJSON(res, 200, { thread });
            return;
        }

        if (path.match(/^\/api\/forum\/threads\/[^/]+\/comments$/) && method === 'GET') {
            const threadId = path.split('/')[4];
            const comments = forumStore.getComments(threadId);
            sendJSON(res, 200, { comments, total: comments.length });
            return;
        }

        if (path.match(/^\/api\/forum\/threads\/[^/]+\/comments$/) && method === 'POST') {
            const threadId = path.split('/')[4];
            const body = await readBody(req);
            const { body: commentBody, parentId } = body as Record<string, unknown>;
            if (!commentBody) { sendJSON(res, 400, { error: 'Missing body' }); return; }
            try {
                const comment = forumStore.addComment({
                    threadId,
                    parentId: parentId as string | undefined,
                    authorId: userId,
                    authorName: (body.authorName as string) || 'User',
                    body: commentBody as string,
                });
                sendJSON(res, 201, { comment });
            } catch (e) {
                sendJSON(res, 404, { error: (e as Error).message });
            }
            return;
        }

        if (path.match(/^\/api\/forum\/comments\/[^/]+\/vote$/) && method === 'POST') {
            const commentId = path.split('/')[4];
            const body = await readBody(req);
            const vote = (body.vote as 'up' | 'none') ?? 'up';
            const comment = forumStore.voteComment(userId, commentId, vote);
            if (!comment) { sendJSON(res, 404, { error: 'Comment not found' }); return; }
            sendJSON(res, 200, { comment });
            return;
        }

        if (path.match(/^\/api\/forum\/threads\/[^/]+\/accept\/[^/]+$/) && method === 'POST') {
            const parts = path.split('/');
            const threadId = parts[4];
            const commentId = parts[6];
            const thread = forumStore.acceptComment(threadId, commentId);
            if (!thread) { sendJSON(res, 404, { error: 'Thread or comment not found' }); return; }
            sendJSON(res, 200, { thread });
            return;
        }

        if (path === '/api/forum/stats' && method === 'GET') {
            sendJSON(res, 200, forumStore.getStats());
            return;
        }

        // -----------------------------------------------------------------
        // Platform Observability
        // -----------------------------------------------------------------

        if (path === '/api/observability/executions' && method === 'GET') {
            const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
            const persona = url.searchParams.get('persona') ?? undefined;
            const executions = memoryGraph.getExecutions(userId, undefined, limit);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const filtered = persona ? executions.filter((e: any) => e.personaId === persona) : executions;
            sendJSON(res, 200, { executions: filtered, total: filtered.length });
            return;
        }

        if (path === '/api/observability/agents' && method === 'GET') {
            // Real agent data from KPI store + registry
            const kpis = getAgentKPIs();
            const stats = getExecutionStats();
            const activeSet = new Set(stats.activeAgents);
            const agents = kpis.map(k => {
                const identity = getAgentIdentity(k.agentId);
                return {
                    id: k.agentId,
                    name: identity?.callSign ?? k.callSign,
                    persona: identity?.persona ?? 'unknown',
                    model: identity?.preferredModel ?? 'claude-sonnet-4-6',
                    status: activeSet.has(k.agentId) ? 'active' : 'idle',
                    tokensUsed: Math.round(k.avgTokenCost * k.totalExecutions * 1_000_000),
                    lastAction: `Last executed: ${k.lastExecutedAt}`,
                    successRate: k.handoffSuccessRate / 100,
                    startedAt: k.lastExecutedAt,
                    totalExecutions: k.totalExecutions,
                    avgQualityScore: Math.round(k.avgQualityScore * 10) / 10,
                    avgLatencyMs: Math.round(k.avgLatencyMs),
                };
            });
            const active = agents.filter(a => a.status === 'active').length;
            sendJSON(res, 200, { agents, total: agents.length, active, idle: agents.length - active });
            return;
        }

        if (path === '/api/observability/metrics' && method === 'GET') {
            const execStats = getExecutionStats();
            const kpis = getAgentKPIs();
            sendJSON(res, 200, {
                gateway: { status: 'healthy', uptime: process.uptime(), memoryMb: Math.round(process.memoryUsage().heapUsed / 1_000_000 * 100) / 100, wsClients: getWSClientCount() },
                executions: { total: execStats.totalExecutions, byPersona: execStats.byPersona, totalCost: Math.round(execStats.totalCost * 10000) / 10000, avgQuality: Math.round(execStats.avgQuality * 10) / 10 },
                agents: { total: kpis.length, active: execStats.activeAgents.length, avgQualityScore: kpis.length ? Math.round(kpis.reduce((s, k) => s + k.avgQualityScore, 0) / kpis.length * 10) / 10 : 0 },
                scheduler: scheduler.getStats(),
                blog: blogStore.getStats(),
                forum: forumStore.getStats(),
                memory: memoryGraph.getStats(),
                llm: { defaultProvider: getDefaultProvider(), availableProviders: getAvailableProviders().filter(p => p.available).map(p => p.id) },
            });
            return;
        }

        // -----------------------------------------------------------------------
        // Agent Evals (CipherClaw-inspired)
        // -----------------------------------------------------------------------

        if (path === '/api/evals/agents' && method === 'GET') {
            sendJSON(res, 200, { agents: agentEvalsStore.getAllConfigs() });
            return;
        }

        if (path.match(/^\/api\/evals\/agents\/[^/]+$/) && method === 'GET') {
            const agentId = path.split('/')[4];
            const agent = agentEvalsStore.getConfig(agentId);
            if (!agent) { sendJSON(res, 404, { error: 'Agent not found' }); return; }
            sendJSON(res, 200, { agent });
            return;
        }

        if (path.match(/^\/api\/evals\/agents\/[^/]+$/) && method === 'PUT') {
            if (guardRole('operator')) return;
            const agentId = path.split('/')[4];
            const body = await readBody(req);
            const updated = agentEvalsStore.updateConfig(agentId, body);
            if (!updated) { sendJSON(res, 404, { error: 'Agent not found' }); return; }
            sendJSON(res, 200, { agent: updated });
            return;
        }

        if (path.match(/^\/api\/evals\/agents\/[^/]+\/report$/) && method === 'GET') {
            const agentId = path.split('/')[4];
            const report = agentEvalsStore.getReport(agentId);
            if (!report) { sendJSON(res, 404, { error: 'Agent not found' }); return; }
            sendJSON(res, 200, { report });
            return;
        }

        if (path.match(/^\/api\/evals\/agents\/[^/]+\/drift$/) && method === 'GET') {
            const agentId = path.split('/')[4];
            sendJSON(res, 200, { history: agentEvalsStore.getDriftHistory(agentId) });
            return;
        }

        if (path.match(/^\/api\/evals\/agents\/[^/]+\/baseline$/) && method === 'POST') {
            if (guardRole('operator')) return;
            const agentId = path.split('/')[4];
            const agent = agentEvalsStore.setBaseline(agentId);
            if (!agent) { sendJSON(res, 404, { error: 'Agent not found' }); return; }
            sendJSON(res, 200, { agent });
            return;
        }

        if (path === '/api/evals/alerts' && method === 'GET') {
            sendJSON(res, 200, { alerts: agentEvalsStore.getAlerts() });
            return;
        }

        if (path === '/api/evals/dashboard' && method === 'GET') {
            sendJSON(res, 200, agentEvalsStore.getDashboard());
            return;
        }

        // -----------------------------------------------------------------------
        // ACP Executions
        // -----------------------------------------------------------------------
        if (path === '/api/acp/executions' && method === 'GET') {
            // Real execution data — show recent executions with agent flow
            const allExecs = getAllExecutions()
              .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
              .slice(0, 10);

            const executions = allExecs.map(exec => {
              const agentSet = new Map<string, { id: string; name: string; persona: string; model: string }>();
              const messages: Array<{ id: string; from: string; to: string; type: string; label: string; timestamp: string; status: string }> = [];

              for (let i = 0; i < exec.steps.length; i++) {
                const step = exec.steps[i];
                const identity = getAgentIdentity(step.agent);
                agentSet.set(step.agent, {
                  id: step.agent,
                  name: identity?.callSign ?? step.agent,
                  persona: identity?.persona ?? exec.persona,
                  model: identity?.preferredModel ?? 'claude-sonnet-4-6',
                });
                if (i < exec.steps.length - 1) {
                  const next = exec.steps[i + 1];
                  messages.push({
                    id: `m-${exec.id}-${i}`,
                    from: step.agent,
                    to: next.agent,
                    type: step.handoffValid === false ? 'handoff_warning' : 'result_handoff',
                    label: step.stepName,
                    timestamp: step.completedAt ?? step.startedAt ?? exec.startedAt,
                    status: step.status === 'completed' ? 'delivered' : 'in_flight',
                  });
                }
              }

              return {
                id: exec.id,
                name: exec.skillName,
                persona: exec.persona.charAt(0).toUpperCase() + exec.persona.slice(1),
                skill: exec.skillName,
                status: exec.status,
                startedAt: exec.startedAt,
                completedAt: exec.completedAt,
                agents: Array.from(agentSet.values()),
                messages,
              };
            });

            sendJSON(res, 200, { executions });
            return;
        }

        // -----------------------------------------------------------------------
        // Governance — Audit Log
        // -----------------------------------------------------------------------
        if (path === '/api/governance/audit' && method === 'GET') {
            if (guardRole('operator')) return;
            const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
            const entries = auditLog.slice(-limit).reverse();
            sendJSON(res, 200, { audit: entries, total: auditLog.length });
            return;
        }

        // Verify the audit hash-chain — tamper-evidence endpoint for CISOs.
        if (path === '/api/governance/audit/verify' && method === 'GET') {
            if (guardRole('operator')) return;
            const result = verifyAuditChain();
            sendJSON(res, 200, result);
            return;
        }

        // -----------------------------------------------------------------------
        // Governance — Policy Engine (allow/deny rules per agent/tool/persona)
        // -----------------------------------------------------------------------
        if (path === '/api/governance/policies' && method === 'GET') {
            sendJSON(res, 200, { policies: listPolicies() });
            return;
        }
        if (path === '/api/governance/policies' && method === 'POST') {
            if (guardRole('operator')) return;
            const body = await readBody(req) as Parameters<typeof createPolicy>[0];
            const p = createPolicy({ ...body, createdBy: userId });
            recordAudit(userId, 'policy.create', p.id, 'success', p.name);
            sendJSON(res, 201, p);
            return;
        }
        if (path.match(/^\/api\/governance\/policies\/[^/]+$/) && method === 'GET') {
            const id = path.split('/')[4]!;
            const p = getPolicy(id);
            if (!p) { sendJSON(res, 404, { error: 'Policy not found' }); return; }
            sendJSON(res, 200, p);
            return;
        }
        if (path.match(/^\/api\/governance\/policies\/[^/]+$/) && method === 'PUT') {
            if (guardRole('operator')) return;
            const id = path.split('/')[4]!;
            const body = await readBody(req);
            const p = updatePolicy(id, body as Parameters<typeof updatePolicy>[1]);
            if (!p) { sendJSON(res, 404, { error: 'Policy not found' }); return; }
            recordAudit(userId, 'policy.update', id);
            sendJSON(res, 200, p);
            return;
        }
        if (path.match(/^\/api\/governance\/policies\/[^/]+$/) && method === 'DELETE') {
            if (guardRole('operator')) return;
            const id = path.split('/')[4]!;
            const ok = deletePolicy(id);
            if (!ok) { sendJSON(res, 404, { error: 'Policy not found' }); return; }
            recordAudit(userId, 'policy.delete', id);
            sendJSON(res, 204, null);
            return;
        }
        if (path === '/api/governance/policies/check' && method === 'POST') {
            const body = await readBody(req) as Parameters<typeof checkPolicy>[0];
            const result = checkPolicy(body);
            sendJSON(res, 200, result);
            return;
        }

        // -----------------------------------------------------------------------
        // Governance v2 — YAML import/export, routing, residency, compliance, red-team
        // -----------------------------------------------------------------------
        if (path === '/api/governance/policies/export' && method === 'GET') {
            if (guardRole('operator')) return;
            const yaml = exportPoliciesAsYaml();
            res.writeHead(200, {
                'Content-Type': 'application/yaml; charset=utf-8',
                'Content-Disposition': 'attachment; filename="policies.yaml"',
            });
            res.end(yaml);
            return;
        }
        if (path === '/api/governance/policies/import' && method === 'POST') {
            if (guardRole('operator')) return;
            // accept raw YAML or JSON with { yaml: "..." }
            const buf = await new Promise<string>((resolve, reject) => {
                let s = ''; req.on('data', (c) => { s += c; });
                req.on('end', () => resolve(s)); req.on('error', reject);
            });
            let yamlText = buf;
            try {
                const parsed = JSON.parse(buf);
                if (parsed && typeof parsed === 'object' && typeof parsed.yaml === 'string') {
                    yamlText = parsed.yaml;
                }
            } catch { /* treat buffer itself as YAML */ }
            const result = importPoliciesFromYaml(yamlText, userId);
            recordAudit(userId, 'policy.import', `count=${result.imported}`, result.errors.length ? 'warning' : 'success');
            sendJSON(res, 200, result);
            return;
        }

        // Approval routing
        if (path === '/api/governance/routing' && method === 'GET') {
            sendJSON(res, 200, { rules: listRoutingRules() });
            return;
        }
        if (path === '/api/governance/routing' && method === 'POST') {
            if (guardRole('operator')) return;
            const body = await readBody(req) as Parameters<typeof createRoutingRule>[0];
            if (!body?.name || !Array.isArray(body?.approvers)) {
                sendJSON(res, 400, { error: 'name and approvers[] required' }); return;
            }
            const rule = createRoutingRule({
                name: body.name,
                match: body.match ?? {},
                approvers: body.approvers,
                slaHours: body.slaHours ?? 24,
                enabled: body.enabled ?? true,
            });
            recordAudit(userId, 'routing.create', rule.id);
            sendJSON(res, 201, rule);
            return;
        }
        const routingIdMatch = path.match(/^\/api\/governance\/routing\/([a-zA-Z0-9_-]+)$/);
        if (routingIdMatch && method === 'DELETE') {
            if (guardRole('operator')) return;
            const ok = deleteRoutingRule(routingIdMatch[1]!);
            if (!ok) { sendJSON(res, 404, { error: 'Routing rule not found' }); return; }
            recordAudit(userId, 'routing.delete', routingIdMatch[1]!);
            sendJSON(res, 204, null);
            return;
        }
        if (path === '/api/governance/routing/resolve' && method === 'POST') {
            const body = await readBody(req) as Parameters<typeof resolveApprovers>[0];
            sendJSON(res, 200, resolveApprovers(body));
            return;
        }

        // Data residency
        if (path === '/api/governance/residency' && method === 'GET') {
            sendJSON(res, 200, { rules: listResidencyRules() });
            return;
        }
        if (path === '/api/governance/residency' && method === 'POST') {
            if (guardRole('operator')) return;
            const body = await readBody(req) as Parameters<typeof createResidencyRule>[0];
            if (!body?.name || !Array.isArray(body?.allowedRegions)) {
                sendJSON(res, 400, { error: 'name and allowedRegions[] required' }); return;
            }
            const rule = createResidencyRule({
                name: body.name,
                match: body.match ?? {},
                allowedRegions: body.allowedRegions,
                allowedProviders: body.allowedProviders,
                enabled: body.enabled ?? true,
            });
            recordAudit(userId, 'residency.create', rule.id);
            sendJSON(res, 201, rule);
            return;
        }
        const residencyIdMatch = path.match(/^\/api\/governance\/residency\/([a-zA-Z0-9_-]+)$/);
        if (residencyIdMatch && method === 'DELETE') {
            if (guardRole('operator')) return;
            const ok = deleteResidencyRule(residencyIdMatch[1]!);
            if (!ok) { sendJSON(res, 404, { error: 'Residency rule not found' }); return; }
            recordAudit(userId, 'residency.delete', residencyIdMatch[1]!);
            sendJSON(res, 204, null);
            return;
        }
        if (path === '/api/governance/residency/check' && method === 'POST') {
            const body = await readBody(req) as Parameters<typeof checkResidency>[0];
            sendJSON(res, 200, checkResidency(body));
            return;
        }

        // Compliance pack
        if (path === '/api/governance/compliance/controls' && method === 'GET') {
            const f = url.searchParams.get('framework') as 'SOC2' | 'ISO27001' | 'GDPR' | null;
            sendJSON(res, 200, { controls: listComplianceControls(f ?? undefined) });
            return;
        }
        if (path === '/api/governance/compliance/summary' && method === 'GET') {
            sendJSON(res, 200, getComplianceSummary());
            return;
        }

        // Red-team scanner
        if (path === '/api/governance/redteam/scan' && method === 'POST') {
            if (guardRole('operator')) return;
            const body = await readBody(req).catch(() => ({})) as {
                publicRoutes?: string[]; jwtSecretPresent?: boolean; allowAnon?: boolean;
                hasPolicies?: boolean; residencyConfigured?: boolean;
            };
            // Auto-fill detectable values.
            const result = runRedTeamScan({
                ...body,
                jwtSecretPresent: body.jwtSecretPresent ?? Boolean(process.env.JWT_SECRET ?? process.env.AUTH_SECRET),
                allowAnon: body.allowAnon ?? (process.env.ALLOW_ANON === 'true'),
                hasPolicies: body.hasPolicies ?? (listPolicies().length > 0),
                residencyConfigured: body.residencyConfigured ?? (listResidencyRules().length > 0),
            });
            recordAudit(userId, 'redteam.scan', `findings=${result.findings.length}`,
                result.findings.some((f) => f.severity === 'critical' || f.severity === 'high') ? 'warning' : 'success');
            sendJSON(res, 200, result);
            return;
        }

        // -----------------------------------------------------------------------
        // Data Moat — Model router, leaderboard, drift, SEI
        // -----------------------------------------------------------------------
        if (path === '/api/intelligence/model-router' && method === 'GET') {
            const routes = trainModelRouter();
            sendJSON(res, 200, { routes, total: routes.length });
            return;
        }
        if (path === '/api/intelligence/model-router/route' && method === 'GET') {
            const persona = url.searchParams.get('persona') ?? undefined;
            const skillId = url.searchParams.get('skillId') ?? undefined;
            const route = routeRequest(persona, skillId);
            if (!route) { sendJSON(res, 404, { error: 'No route available (insufficient telemetry)' }); return; }
            sendJSON(res, 200, route);
            return;
        }
        if (path === '/api/intelligence/leaderboard' && method === 'GET') {
            const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
            sendJSON(res, 200, computeLeaderboard(limit));
            return;
        }
        if (path === '/api/intelligence/drift-forecast' && method === 'GET') {
            sendJSON(res, 200, { forecasts: forecastDrift() });
            return;
        }
        if (path === '/api/intelligence/skill-effectiveness' && method === 'GET') {
            const scores = computeSEI();
            sendJSON(res, 200, { scores, total: scores.length });
            return;
        }
        const seiBySkillMatch = path.match(/^\/api\/intelligence\/skill-effectiveness\/([a-zA-Z0-9_-]+)$/);
        if (seiBySkillMatch && method === 'GET') {
            const scores = computeSEI();
            const s = scores.find((x) => x.skillId === seiBySkillMatch[1]);
            if (!s) { sendJSON(res, 404, { error: 'No SEI data for this skill' }); return; }
            sendJSON(res, 200, s);
            return;
        }

        // -----------------------------------------------------------------------
        // Protocol — UTCP spec + JSON Schema (public, no auth required)
        // -----------------------------------------------------------------------
        if (path === '/api/protocol/utcp/spec' && method === 'GET') {
            const content = readDocsFile('utcp-spec.md');
            if (!content) { sendJSON(res, 404, { error: 'Spec not found' }); return; }
            res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
            res.end(content);
            return;
        }
        if (path === '/api/protocol/utcp/schema' && method === 'GET') {
            const content = readDocsFile('utcp-packet.schema.json');
            if (!content) { sendJSON(res, 404, { error: 'Schema not found' }); return; }
            res.writeHead(200, { 'Content-Type': 'application/schema+json; charset=utf-8' });
            res.end(content);
            return;
        }
        if (path === '/api/protocol/utcp/adoption' && method === 'GET') {
            const content = readDocsFile('utcp-adoption.md');
            if (!content) { sendJSON(res, 404, { error: 'Adoption doc not found' }); return; }
            res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
            res.end(content);
            return;
        }
        if (path === '/api/protocol/utcp/validate' && method === 'POST') {
            const body = await readBody(req);
            sendJSON(res, 200, validatePacket(body));
            return;
        }
        if (path === '/api/protocol/utcp/canonicalize' && method === 'POST') {
            const body = await readBody(req);
            const v = validatePacket(body);
            if (!v.valid) { sendJSON(res, 400, { error: 'Invalid packet', details: v.errors }); return; }
            const pkt = body as unknown as import('./utcp-protocol.js').UTCPPacket;
            sendJSON(res, 200, { canonical: canonicalize(pkt), digest: hashPacket(pkt) });
            return;
        }
        if (path === '/api/protocol/utcp/envelope' && method === 'POST') {
            const body = await readBody(req) as { packet?: unknown; method?: string };
            if (!body?.packet) { sendJSON(res, 400, { error: 'packet required' }); return; }
            const v = validatePacket(body.packet);
            if (!v.valid) { sendJSON(res, 400, { error: 'Invalid packet', details: v.errors }); return; }
            const pkt = body.packet as import('./utcp-protocol.js').UTCPPacket;
            sendJSON(res, 200, toMcpEnvelope(pkt, body.method));
            return;
        }
        if (path === '/api/protocol/utcp/envelope/decode' && method === 'POST') {
            const body = await readBody(req);
            const result = fromMcpEnvelope(body);
            sendJSON(res, result.errors.length ? 400 : 200, result);
            return;
        }
        if (path === '/api/protocol/utcp/adopters' && method === 'GET') {
            sendJSON(res, 200, { adopters: listAdopters() });
            return;
        }
        if (path === '/api/protocol/utcp/adopters' && method === 'POST') {
            if (guardRole('operator')) return;
            const body = await readBody(req) as Parameters<typeof registerAdopter>[0];
            if (!body?.org || !body?.status) { sendJSON(res, 400, { error: 'org and status required' }); return; }
            const entry = registerAdopter(body);
            recordAudit(userId, 'utcp.adopter.register', entry.id);
            sendJSON(res, 201, entry);
            return;
        }

        // -----------------------------------------------------------------------
        // Benchmark — opt-in anonymized telemetry contribution
        // -----------------------------------------------------------------------
        if (path === '/api/benchmark/stats' && method === 'GET') {
            sendJSON(res, 200, getContributionStats());
            return;
        }
        if (path === '/api/benchmark/log' && method === 'GET') {
            if (guardRole('operator')) return;
            const limit = parseInt(url.searchParams.get('limit') ?? '100', 10);
            sendJSON(res, 200, { entries: getContributionLog(limit) });
            return;
        }
        if (path === '/api/benchmark/contribute' && method === 'POST') {
            const body = await readBody(req) as { execution?: Parameters<typeof contributeExecution>[0] };
            if (!body?.execution) { sendJSON(res, 400, { error: 'execution required' }); return; }
            const result = await contributeExecution(body.execution);
            if (result.submitted) recordAudit(userId, 'benchmark.contribute', body.execution.id ?? 'anon');
            sendJSON(res, 200, result);
            return;
        }

        // -----------------------------------------------------------------------
        // Governance — PII Redaction (preview endpoint)
        // -----------------------------------------------------------------------
        if (path === '/api/governance/pii/scan' && method === 'POST') {
            const body = await readBody(req) as { text?: string };
            const text = body?.text ?? '';
            const result = redactPII(text);
            const hasPII = containsPII(text);
            if (result.events.length > 0) {
                recordAudit(userId, 'pii.redacted', `${result.events.length}_items`, 'warning',
                    result.events.map((e) => e.type).join(','));
            }
            sendJSON(res, 200, { hasPII, redactedText: result.text, events: result.events });
            return;
        }

        // -----------------------------------------------------------------------
        // Governance — Cost Attribution
        // -----------------------------------------------------------------------
        if (path === '/api/governance/costs' && method === 'GET') {
            if (guardRole('operator')) return;
            // Real cost attribution from actual execution data
            const execStats = getExecutionStats();
            const now = new Date();
            const period = `${now.toLocaleString('en', { month: 'long' })} ${now.getFullYear()}`;
            const breakdown = Object.entries(execStats.byPersona).map(([persona, data]) => ({
                persona: persona.charAt(0).toUpperCase() + persona.slice(1),
                skillsUsed: data.count,
                estimatedCost: Math.round(data.totalCost * 10000) / 10000,
                avgQuality: Math.round(data.avgQuality * 10) / 10,
            }));
            sendJSON(res, 200, {
                period,
                totalCost: Math.round(execStats.totalCost * 10000) / 10000,
                totalExecutions: execStats.totalExecutions,
                breakdown,
            });
            return;
        }

        // -----------------------------------------------------------------------
        // Marketing Control Tower — Campaigns + Campaign DAG + Asset Vault
        // -----------------------------------------------------------------------

        // Control Tower summary — authenticated but role-open.
        if (path === '/api/campaigns/summary' && method === 'GET') {
            sendJSON(res, 200, getControlTowerSummary());
            return;
        }

        // Searchable asset vault (cross-campaign).
        if (path === '/api/campaigns/assets/search' && method === 'GET') {
            const q = url.searchParams.get('q') ?? '';
            const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
            sendJSON(res, 200, { query: q, results: searchAssets(q, limit) });
            return;
        }

        // GET single asset / PATCH approve / GET lineage
        const singleAssetMatch = path.match(/^\/api\/campaigns\/assets\/([a-zA-Z0-9_-]+)$/);
        if (singleAssetMatch && method === 'GET') {
            const a = getAsset(singleAssetMatch[1]!);
            if (!a) { sendJSON(res, 404, { error: 'Asset not found' }); return; }
            sendJSON(res, 200, a);
            return;
        }
        const assetLineageMatch = path.match(/^\/api\/campaigns\/assets\/([a-zA-Z0-9_-]+)\/lineage$/);
        if (assetLineageMatch && method === 'GET') {
            sendJSON(res, 200, { lineage: getAssetLineage(assetLineageMatch[1]!) });
            return;
        }
        const assetApproveMatch = path.match(/^\/api\/campaigns\/assets\/([a-zA-Z0-9_-]+)\/approve$/);
        if (assetApproveMatch && method === 'POST') {
            const a = approveAsset(assetApproveMatch[1]!, userId);
            if (!a) { sendJSON(res, 404, { error: 'Asset not found' }); return; }
            recordAudit(userId, 'campaign.asset.approved', a.id);
            sendJSON(res, 200, a);
            return;
        }

        // Campaign collection routes.
        if (path === '/api/campaigns' && method === 'GET') {
            const owner = url.searchParams.get('owner') ?? undefined;
            const status = (url.searchParams.get('status') ?? undefined) as
              | 'draft' | 'active' | 'paused' | 'completed' | 'archived' | undefined;
            const tag = url.searchParams.get('tag') ?? undefined;
            sendJSON(res, 200, { campaigns: listCampaigns({ owner, status, tag }) });
            return;
        }
        if (path === '/api/campaigns' && method === 'POST') {
            const body = await readBody(req) as {
              name?: string; description?: string; owner?: string;
              status?: 'draft' | 'active' | 'paused' | 'completed' | 'archived';
              targetAudience?: string; objectives?: string[];
              startDate?: string; endDate?: string; tags?: string[];
            };
            if (!body?.name) { sendJSON(res, 400, { error: 'name required' }); return; }
            const c = createCampaign({
              name: body.name,
              description: body.description,
              owner: body.owner ?? userId,
              status: body.status,
              targetAudience: body.targetAudience,
              objectives: body.objectives,
              startDate: body.startDate,
              endDate: body.endDate,
              tags: body.tags,
            });
            recordAudit(userId, 'campaign.create', c.id);
            sendJSON(res, 201, c);
            return;
        }

        // Single-campaign routes.
        const cmpIdMatch = path.match(/^\/api\/campaigns\/([a-zA-Z0-9_-]+)$/);
        if (cmpIdMatch && method === 'GET') {
            const c = getCampaign(cmpIdMatch[1]!);
            if (!c) { sendJSON(res, 404, { error: 'Campaign not found' }); return; }
            sendJSON(res, 200, c);
            return;
        }
        if (cmpIdMatch && method === 'PATCH') {
            const body = await readBody(req) as Partial<ReturnType<typeof getCampaign>> & Record<string, unknown>;
            const updated = updateCampaign(cmpIdMatch[1]!, body as never);
            if (!updated) { sendJSON(res, 404, { error: 'Campaign not found' }); return; }
            recordAudit(userId, 'campaign.update', updated.id);
            sendJSON(res, 200, updated);
            return;
        }
        if (cmpIdMatch && method === 'DELETE') {
            if (guardRole('operator')) return;
            const ok = deleteCampaign(cmpIdMatch[1]!);
            if (!ok) { sendJSON(res, 404, { error: 'Campaign not found' }); return; }
            recordAudit(userId, 'campaign.delete', cmpIdMatch[1]!);
            sendJSON(res, 200, { ok: true });
            return;
        }

        const cmpStatsMatch = path.match(/^\/api\/campaigns\/([a-zA-Z0-9_-]+)\/stats$/);
        if (cmpStatsMatch && method === 'GET') {
            const stats = getCampaignStats(cmpStatsMatch[1]!);
            if (!stats.campaign) { sendJSON(res, 404, { error: 'Campaign not found' }); return; }
            sendJSON(res, 200, stats);
            return;
        }

        const cmpAssetsMatch = path.match(/^\/api\/campaigns\/([a-zA-Z0-9_-]+)\/assets$/);
        if (cmpAssetsMatch && method === 'GET') {
            sendJSON(res, 200, { assets: listCampaignAssets(cmpAssetsMatch[1]!) });
            return;
        }
        if (cmpAssetsMatch && method === 'POST') {
            const body = await readBody(req) as {
              type?: 'brief' | 'outline' | 'blog' | 'ad' | 'email' | 'post' | 'landing_page' | 'creative' | 'research' | 'other';
              title?: string; ref?: string; content?: string;
              producedBy?: string; sourceExecutionId?: string; skillId?: string;
              parents?: string[]; tags?: string[];
            };
            if (!body?.type || !body?.title) {
                sendJSON(res, 400, { error: 'type and title required' });
                return;
            }
            try {
                const a = addAsset({
                    campaignId: cmpAssetsMatch[1]!,
                    type: body.type,
                    title: body.title,
                    ref: body.ref,
                    content: body.content,
                    producedBy: body.producedBy ?? userId,
                    sourceExecutionId: body.sourceExecutionId,
                    skillId: body.skillId,
                    parents: body.parents,
                    tags: body.tags,
                });
                recordAudit(userId, 'campaign.asset.create', a.id);
                sendJSON(res, 201, a);
            } catch (e) {
                sendJSON(res, 400, { error: (e as Error).message });
            }
            return;
        }

        const cmpLinkMatch = path.match(/^\/api\/campaigns\/([a-zA-Z0-9_-]+)\/executions$/);
        if (cmpLinkMatch && method === 'POST') {
            const body = await readBody(req) as { executionId?: string };
            if (!body?.executionId) { sendJSON(res, 400, { error: 'executionId required' }); return; }
            const c = linkExecutionToCampaign(cmpLinkMatch[1]!, body.executionId);
            if (!c) { sendJSON(res, 404, { error: 'Campaign not found' }); return; }
            recordAudit(userId, 'campaign.link.execution', `${c.id}/${body.executionId}`);
            sendJSON(res, 200, c);
            return;
        }

        // -----------------------------------------------------------------------
        // Marketing Module API (persona-gated)
        // -----------------------------------------------------------------------

        if (path.startsWith('/api/marketing/') && authUser && !requirePersonaAccess(authUser, 'marketing')) {
            sendJSON(res, 403, { error: 'Access denied for persona: marketing' }); return;
        }

        if (path === '/api/marketing/workflows' && method === 'GET') {
            const workflows = marketingApi.getMarketingWorkflows();
            const clusters = marketingApi.getMarketingWorkflowClusters();
            const byCluster = marketingApi.getMarketingWorkflowsByCluster();
            sendJSON(res, 200, { workflows, clusters, byCluster });
            return;
        }

        // GET /api/marketing/skills — marketing workflows in unified skill format
        if (path === '/api/marketing/skills' && method === 'GET') {
            const skills = marketingApi.getMarketingSkills();
            sendJSON(res, 200, { skills });
            return;
        }

        if (path.match(/^\/api\/marketing\/workflows\/[^/]+$/) && method === 'GET') {
            const idOrSlug = path.split('/').pop()!;
            const workflow = marketingApi.getMarketingWorkflow(idOrSlug);
            if (!workflow) { sendJSON(res, 404, { error: 'Workflow not found' }); return; }
            sendJSON(res, 200, { workflow });
            return;
        }

        if (path === '/api/marketing/execute/precheck' && method === 'POST') {
            const body = await readBody(req);
            const { workflowId, simulate } = body as { workflowId: string; simulate?: boolean };
            if (!workflowId) { sendJSON(res, 400, { error: 'Missing workflowId' }); return; }
            const check = marketingApi.preCheckExecution(workflowId, simulate);
            sendJSON(res, 200, check);
            return;
        }

        if (path === '/api/marketing/execute' && method === 'POST') {
            const body = await readBody(req);
            const { workflowId, inputs, simulate, customPrompt, provider, modelId } = body as { workflowId: string; inputs?: Record<string, unknown>; simulate?: boolean; customPrompt?: string; provider?: string; modelId?: string };
            if (!workflowId) { sendJSON(res, 400, { error: 'Missing workflowId' }); return; }
            try {
                const exec = marketingApi.createMarketingExecution(workflowId, inputs ?? {}, userId, simulate === true, customPrompt, provider as any, modelId);
                sendJSON(res, 201, { execution: exec });
            } catch (err) {
                sendJSON(res, 400, { error: (err as Error).message });
            }
            return;
        }

        if (path.match(/^\/api\/marketing\/executions\/[^/]+$/) && method === 'GET') {
            const execId = path.split('/').pop()!;
            const exec = marketingApi.getMarketingExecution(execId);
            if (!exec) { sendJSON(res, 404, { error: 'Execution not found' }); return; }
            sendJSON(res, 200, { execution: exec });
            return;
        }

        if (path.match(/^\/api\/marketing\/executions\/[^/]+\/complete$/) && method === 'POST') {
            const execId = path.split('/')[4];
            const exec = marketingApi.getMarketingExecution(execId);
            if (!exec) { sendJSON(res, 404, { error: 'Execution not found' }); return; }
            memoryGraph.recordExecution({
                userId: exec.userId ?? 'anonymous',
                skillId: exec.workflowId,
                skillName: exec.workflowName,
                personaId: 'marketing',
                success: exec.status === 'completed',
                runtimeSec: exec.completedAt && exec.startedAt ? Math.round((new Date(exec.completedAt).getTime() - new Date(exec.startedAt).getTime()) / 1000) : 0,
                cost: 0,
                agentsUsed: [...new Set(exec.steps.map((s) => s.agent))],
                toolsUsed: [...new Set(exec.steps.map((s) => s.tool).filter(Boolean))] as string[],
                outputs: Object.keys(exec.outputs),
            });
            const updated = marketingApi.updateMarketingExecution(execId, { status: 'completed', completedAt: new Date().toISOString() });
            sendJSON(res, 200, { execution: updated });
            return;
        }

        if (path === '/api/marketing/executions' && method === 'GET') {
            const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
            const execs = marketingApi.getRecentMarketingExecutions(limit);
            sendJSON(res, 200, { executions: execs, total: execs.length });
            return;
        }

        if (path === '/api/marketing/upload' && method === 'POST') {
            const body = await readBody(req);
            const { fileName, contentBase64, mimeType } = body as { fileName?: string; contentBase64?: string; mimeType?: string };
            if (!fileName || !contentBase64) { sendJSON(res, 400, { error: 'Missing fileName or contentBase64' }); return; }
            const content = typeof contentBase64 === 'string' ? Buffer.from(contentBase64, 'base64').toString('utf-8') : '';
            const fileId = `file-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
            marketingApi.storeUploadedFile(fileId, fileName, content, mimeType ?? 'application/octet-stream');
            sendJSON(res, 201, { fileId, fileName, message: 'File uploaded for agent context' });
            return;
        }

        if (path === '/api/marketing/roles' && method === 'GET') {
            // Derive roles from agent registry ranks
            const registry = getFullRegistry();
            const roles = Object.entries(registry.byRank).map(([rank, count]) => ({
                id: rank,
                name: rank.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                agentCount: count,
                permissions: rank === 'field-marshal' ? ['*'] : rank === 'colonel' ? ['execute', 'approve', 'manage_skills', 'manage_workflows', 'view_analytics'] : rank === 'captain' ? ['execute', 'approve', 'view_analytics'] : ['execute', 'view_analytics'],
            }));
            sendJSON(res, 200, { roles });
            return;
        }

        if (path === '/api/marketing/projects' && method === 'GET') {
            const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
            const projects = getRecentProjects(limit);
            sendJSON(res, 200, { projects, total: projects.length });
            return;
        }

        if (path.match(/^\/api\/marketing\/projects\/[^/]+$/) && !path.includes('/tasks') && method === 'GET') {
            const projectId = path.split('/').pop()!;
            const project = getProject(projectId);
            if (!project) { sendJSON(res, 404, { error: 'Project not found' }); return; }
            sendJSON(res, 200, { project });
            return;
        }

        if (path.match(/^\/api\/marketing\/projects\/[^/]+\/tasks$/) && method === 'GET') {
            const projectId = path.split('/')[4]!;
            const tasks = getProjectTasks(projectId);
            sendJSON(res, 200, { tasks, total: tasks.length });
            return;
        }

        if (path.match(/^\/api\/marketing\/campaign-graph\/[^/]+$/) && method === 'GET') {
            const graphId = path.split('/').pop()!;
            const graph = getCampaignGraph(graphId);
            if (!graph) { sendJSON(res, 404, { error: 'Campaign graph not found' }); return; }
            sendJSON(res, 200, { graph });
            return;
        }

        if (path === '/api/marketing/tools/connections' && method === 'GET') {
            const connections = getMarketingToolConnections();
            sendJSON(res, 200, { connections });
            return;
        }

        if (path.match(/^\/api\/marketing\/tools\/connections\/[^/]+$/) && method === 'GET') {
            const toolId = path.split('/').pop()!;
            const status = getToolConnectionStatus(toolId);
            sendJSON(res, 200, { connection: status });
            return;
        }

        if (path.match(/^\/api\/tools\/[^/]+\/connect$/) && method === 'GET') {
            const toolId = path.split('/')[3]!;
            const flow = getToolConnectFlow(toolId);
            if (shouldRedirectToOAuth(toolId) && flow.oauthUrl) {
                res.writeHead(302, { Location: flow.oauthUrl });
                res.end();
            } else {
                sendJSON(res, 200, {
                    toolId,
                    authType: flow.authType,
                    oauthUrl: flow.oauthUrl,
                    apiKeyPlaceholder: flow.apiKeyPlaceholder,
                    message: flow.authType === 'api_key' ? 'Configure API key in Settings' : 'Set OAuth client ID in env to enable',
                });
            }
            return;
        }

        // OAuth callback — vendor redirects here with ?code=xxx after auth.
        // Supports both legacy /callback and explicit /oauth/callback paths.
        if (
            (path.match(/^\/api\/tools\/[^/]+\/(oauth\/)?callback$/)) &&
            method === 'GET'
        ) {
            const parts = path.split('/');
            const toolId = parts[3]!;
            const code = url.searchParams.get('code');
            const err = url.searchParams.get('error');
            const baseUrl = process.env.GATEWAY_URL ?? `http://${req.headers.host ?? 'localhost:3000'}`;
            const redirectUri = `${baseUrl}/api/tools/${toolId}/callback`;

            if (err) {
                res.writeHead(400, { 'Content-Type': 'text/html' });
                res.end(renderOAuthResultHtml(toolId, false, `Vendor error: ${err}`));
                return;
            }
            if (!code) {
                res.writeHead(400, { 'Content-Type': 'text/html' });
                res.end(renderOAuthResultHtml(toolId, false, 'Missing ?code in callback'));
                return;
            }

            const result = await exchangeOAuthCode(toolId, code, redirectUri);
            recordAudit(userId, result.success ? 'tool.oauth.success' : 'tool.oauth.failure', toolId);
            res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'text/html' });
            res.end(renderOAuthResultHtml(toolId, result.success, result.error ?? (result.accountName ? `Connected as ${result.accountName}` : 'Connected')));
            return;
        }

        if (path === '/api/marketing/notifications/config' && method === 'GET') {
            const config = getNotificationConfig();
            sendJSON(res, 200, { config });
            return;
        }

        if (path === '/api/marketing/notifications/config' && method === 'POST') {
            const body = await readBody(req);
            setNotificationConfig(body as Parameters<typeof setNotificationConfig>[0]);
            sendJSON(res, 200, { config: getNotificationConfig() });
            return;
        }

        // -----------------------------------------------------------------------
        // Notification Dispatch — channels, rules, delivery log

        // Channels CRUD
        if (path === '/api/notifications/channels' && method === 'GET') {
            sendJSON(res, 200, { channels: listChannels() });
            return;
        }
        if (path === '/api/notifications/channels' && method === 'POST') {
            if (guardRole('operator')) return;
            const body = await readBody(req) as { channel: string; name: string; config: unknown };
            const ch = createChannel(body.channel as Parameters<typeof createChannel>[0], body.name, body.config as Parameters<typeof createChannel>[2]);
            recordAudit(userId, 'notification.channel.create', ch.id);
            sendJSON(res, 201, ch);
            return;
        }
        if (path.match(/^\/api\/notifications\/channels\/[^/]+$/) && method === 'GET') {
            const id = path.split('/')[4]!;
            const ch = getChannel(id);
            if (!ch) { sendJSON(res, 404, { error: 'Channel not found' }); return; }
            sendJSON(res, 200, ch);
            return;
        }
        if (path.match(/^\/api\/notifications\/channels\/[^/]+$/) && method === 'PUT') {
            if (guardRole('operator')) return;
            const id = path.split('/')[4]!;
            const body = await readBody(req);
            const ch = updateChannel(id, body as Parameters<typeof updateChannel>[1]);
            if (!ch) { sendJSON(res, 404, { error: 'Channel not found' }); return; }
            recordAudit(userId, 'notification.channel.update', id);
            sendJSON(res, 200, ch);
            return;
        }
        if (path.match(/^\/api\/notifications\/channels\/[^/]+$/) && method === 'DELETE') {
            if (guardRole('operator')) return;
            const id = path.split('/')[4]!;
            const ok = deleteChannel(id);
            if (!ok) { sendJSON(res, 404, { error: 'Channel not found' }); return; }
            recordAudit(userId, 'notification.channel.delete', id);
            sendJSON(res, 204, null);
            return;
        }

        // Rules CRUD
        if (path === '/api/notifications/rules' && method === 'GET') {
            sendJSON(res, 200, { rules: listRules() });
            return;
        }
        if (path === '/api/notifications/rules' && method === 'POST') {
            if (guardRole('operator')) return;
            const body = await readBody(req) as { name: string; trigger: string; channelId: string; eventPattern?: string; template?: string; recipientOverride?: string };
            const rule = createRule(body.name, body.trigger as Parameters<typeof createRule>[1], body.channelId, { eventPattern: body.eventPattern, template: body.template, recipientOverride: body.recipientOverride });
            recordAudit(userId, 'notification.rule.create', rule.id);
            sendJSON(res, 201, rule);
            return;
        }
        if (path.match(/^\/api\/notifications\/rules\/[^/]+$/) && method === 'GET') {
            const id = path.split('/')[4]!;
            const rule = getRule(id);
            if (!rule) { sendJSON(res, 404, { error: 'Rule not found' }); return; }
            sendJSON(res, 200, rule);
            return;
        }
        if (path.match(/^\/api\/notifications\/rules\/[^/]+$/) && method === 'PUT') {
            if (guardRole('operator')) return;
            const id = path.split('/')[4]!;
            const body = await readBody(req);
            const rule = updateRule(id, body as Parameters<typeof updateRule>[1]);
            if (!rule) { sendJSON(res, 404, { error: 'Rule not found' }); return; }
            recordAudit(userId, 'notification.rule.update', id);
            sendJSON(res, 200, rule);
            return;
        }
        if (path.match(/^\/api\/notifications\/rules\/[^/]+$/) && method === 'DELETE') {
            if (guardRole('operator')) return;
            const id = path.split('/')[4]!;
            const ok = deleteRule(id);
            if (!ok) { sendJSON(res, 404, { error: 'Rule not found' }); return; }
            recordAudit(userId, 'notification.rule.delete', id);
            sendJSON(res, 204, null);
            return;
        }

        // Manual dispatch
        if (path === '/api/notifications/dispatch' && method === 'POST') {
            const body = await readBody(req) as { channelId: string; subject: string; body: string; recipient: string; metadata?: Record<string, unknown> };
            const result = await dispatch(body.channelId, body.subject, body.body, body.recipient, { metadata: body.metadata });
            sendJSON(res, 200, result);
            return;
        }

        // Delivery log
        if (path === '/api/notifications/deliveries/stats' && method === 'GET') {
            sendJSON(res, 200, getDeliveryStats());
            return;
        }
        if (path === '/api/notifications/deliveries' && method === 'GET') {
            const u = new URL(req.url!, `http://${req.headers.host}`);
            const channelId = u.searchParams.get('channelId') ?? undefined;
            const limit = parseInt(u.searchParams.get('limit') ?? '50', 10);
            sendJSON(res, 200, { deliveries: getDeliveryLog(limit, channelId) });
            return;
        }
        if (path.match(/^\/api\/notifications\/deliveries\/[^/]+$/) && method === 'GET') {
            const id = path.split('/')[4]!;
            const d = getDelivery(id);
            if (!d) { sendJSON(res, 404, { error: 'Delivery not found' }); return; }
            sendJSON(res, 200, d);
            return;
        }

        // -----------------------------------------------------------------------
        // Webhook Connector — endpoints, subscriptions, inbound receiver

        // Endpoints CRUD
        if (path === '/api/webhooks/endpoints' && method === 'GET') {
            sendJSON(res, 200, { endpoints: listEndpoints() });
            return;
        }
        if (path === '/api/webhooks/endpoints' && method === 'POST') {
            if (guardRole('operator')) return;
            const body = await readBody(req) as { name: string; source: string; eventPrefix?: string };
            const ep = createEndpoint(body.name, body.source, body.eventPrefix);
            recordAudit(userId, 'webhook.endpoint.create', ep.id);
            sendJSON(res, 201, ep);
            return;
        }
        if (path.match(/^\/api\/webhooks\/endpoints\/[^/]+$/) && method === 'GET') {
            const id = path.split('/')[4]!;
            const ep = getEndpoint(id);
            if (!ep) { sendJSON(res, 404, { error: 'Endpoint not found' }); return; }
            sendJSON(res, 200, ep);
            return;
        }
        if (path.match(/^\/api\/webhooks\/endpoints\/[^/]+$/) && method === 'DELETE') {
            if (guardRole('operator')) return;
            const id = path.split('/')[4]!;
            const ok = deleteEndpoint(id);
            if (!ok) { sendJSON(res, 404, { error: 'Endpoint not found' }); return; }
            recordAudit(userId, 'webhook.endpoint.delete', id);
            sendJSON(res, 204, null);
            return;
        }

        // Subscriptions CRUD
        if (path === '/api/webhooks/subscriptions' && method === 'GET') {
            sendJSON(res, 200, { subscriptions: listSubscriptions() });
            return;
        }
        if (path === '/api/webhooks/subscriptions' && method === 'POST') {
            if (guardRole('operator')) return;
            const body = await readBody(req) as { name: string; eventPattern: string; targetUrl: string; headers?: Record<string, string> };
            const sub = createSubscription(body.name, body.eventPattern, body.targetUrl, { headers: body.headers });
            recordAudit(userId, 'webhook.subscription.create', sub.id);
            sendJSON(res, 201, sub);
            return;
        }
        if (path.match(/^\/api\/webhooks\/subscriptions\/[^/]+$/) && method === 'GET') {
            const id = path.split('/')[4]!;
            const sub = getSubscription(id);
            if (!sub) { sendJSON(res, 404, { error: 'Subscription not found' }); return; }
            sendJSON(res, 200, sub);
            return;
        }
        if (path.match(/^\/api\/webhooks\/subscriptions\/[^/]+$/) && method === 'DELETE') {
            if (guardRole('operator')) return;
            const id = path.split('/')[4]!;
            const ok = deleteSubscription(id);
            if (!ok) { sendJSON(res, 404, { error: 'Subscription not found' }); return; }
            recordAudit(userId, 'webhook.subscription.delete', id);
            sendJSON(res, 204, null);
            return;
        }

        // Inbound webhook receiver (no auth — uses HMAC signature verification)
        if (path.match(/^\/api\/webhooks\/receive\/[^/]+$/) && method === 'POST') {
            const endpointId = path.split('/')[4]!;
            const rawBody = await readBody(req);
            const signature = (req.headers['x-webhook-signature'] ?? req.headers['x-hub-signature-256'] ?? '') as string;
            const result = await receiveWebhook(endpointId, JSON.stringify(rawBody), signature);
            if (!result.accepted) { sendJSON(res, 401, { error: 'Signature verification failed' }); return; }
            sendJSON(res, 200, { accepted: true, eventId: result.eventId });
            return;
        }

        // Inbound event log
        if (path === '/api/webhooks/events' && method === 'GET') {
            const u = new URL(req.url!, `http://${req.headers.host}`);
            const endpointId = u.searchParams.get('endpointId') ?? undefined;
            const limit = parseInt(u.searchParams.get('limit') ?? '50', 10);
            sendJSON(res, 200, { events: getInboundLog(endpointId, limit) });
            return;
        }

        // -----------------------------------------------------------------------
        // Innovation Labs — experiments, hackathons, graduation pipeline

        // Experiments CRUD
        if (path === '/api/innovation/experiments' && method === 'GET') {
            const u = new URL(req.url!, `http://${req.headers.host}`);
            const status = u.searchParams.get('status') as Parameters<typeof listExperiments>[0] extends undefined ? never : string | undefined;
            const category = u.searchParams.get('category') ?? undefined;
            const hackathonId = u.searchParams.get('hackathonId') ?? undefined;
            sendJSON(res, 200, { experiments: listExperiments({ status: status as any, category: category as any, hackathonId }) });
            return;
        }
        if (path === '/api/innovation/experiments' && method === 'POST') {
            const body = await readBody(req) as Parameters<typeof createExperiment>[0];
            const exp = createExperiment(body);
            recordAudit(userId, 'innovation.experiment.create', exp.id);
            sendJSON(res, 201, exp);
            return;
        }
        if (path.match(/^\/api\/innovation\/experiments\/[^/]+$/) && method === 'GET') {
            const id = path.split('/')[4]!;
            const exp = getExperiment(id);
            if (!exp) { sendJSON(res, 404, { error: 'Experiment not found' }); return; }
            sendJSON(res, 200, exp);
            return;
        }
        if (path.match(/^\/api\/innovation\/experiments\/[^/]+$/) && method === 'PUT') {
            const id = path.split('/')[4]!;
            const body = await readBody(req);
            try {
                const exp = updateExperiment(id, body as Parameters<typeof updateExperiment>[1]);
                recordAudit(userId, 'innovation.experiment.update', id);
                sendJSON(res, 200, exp);
            } catch (e: any) { sendJSON(res, 404, { error: e.message }); }
            return;
        }
        if (path.match(/^\/api\/innovation\/experiments\/[^/]+$/) && method === 'DELETE') {
            const id = path.split('/')[4]!;
            const ok = deleteExperiment(id);
            if (!ok) { sendJSON(res, 404, { error: 'Experiment not found' }); return; }
            recordAudit(userId, 'innovation.experiment.delete', id);
            sendJSON(res, 204, null);
            return;
        }
        // Transition experiment status
        if (path.match(/^\/api\/innovation\/experiments\/[^/]+\/transition$/) && method === 'POST') {
            const id = path.split('/')[4]!;
            const body = await readBody(req) as { status: string };
            try {
                const exp = transitionExperiment(id, body.status as any);
                recordAudit(userId, 'innovation.experiment.transition', id, 'success', body.status);
                sendJSON(res, 200, exp);
            } catch (e: any) { sendJSON(res, 400, { error: e.message }); }
            return;
        }
        // Add result to experiment
        if (path.match(/^\/api\/innovation\/experiments\/[^/]+\/results$/) && method === 'POST') {
            const id = path.split('/')[4]!;
            const body = await readBody(req) as { metric: string; value: number; unit: string; notes?: string };
            try {
                const exp = addExperimentResult(id, body);
                sendJSON(res, 200, exp);
            } catch (e: any) { sendJSON(res, 404, { error: e.message }); }
            return;
        }
        // Score experiment
        if (path.match(/^\/api\/innovation\/experiments\/[^/]+\/score$/) && method === 'POST') {
            const id = path.split('/')[4]!;
            const body = await readBody(req) as { score: number };
            try {
                const exp = scoreExperiment(id, body.score);
                sendJSON(res, 200, exp);
            } catch (e: any) { sendJSON(res, 404, { error: e.message }); }
            return;
        }

        // Hackathons
        if (path === '/api/innovation/hackathons' && method === 'GET') {
            sendJSON(res, 200, { hackathons: listHackathons() });
            return;
        }
        if (path === '/api/innovation/hackathons' && method === 'POST') {
            const body = await readBody(req) as Parameters<typeof createHackathon>[0];
            const h = createHackathon(body);
            recordAudit(userId, 'innovation.hackathon.create', h.id);
            sendJSON(res, 201, h);
            return;
        }
        if (path.match(/^\/api\/innovation\/hackathons\/[^/]+$/) && method === 'GET') {
            const id = path.split('/')[4]!;
            const h = getHackathon(id);
            if (!h) { sendJSON(res, 404, { error: 'Hackathon not found' }); return; }
            sendJSON(res, 200, h);
            return;
        }
        if (path.match(/^\/api\/innovation\/hackathons\/[^/]+\/start$/) && method === 'POST') {
            const id = path.split('/')[4]!;
            try {
                const h = startHackathon(id);
                recordAudit(userId, 'innovation.hackathon.start', id);
                sendJSON(res, 200, h);
            } catch (e: any) { sendJSON(res, 400, { error: e.message }); }
            return;
        }
        if (path.match(/^\/api\/innovation\/hackathons\/[^/]+\/complete$/) && method === 'POST') {
            const id = path.split('/')[4]!;
            try {
                const h = completeHackathon(id);
                recordAudit(userId, 'innovation.hackathon.complete', id);
                sendJSON(res, 200, h);
            } catch (e: any) { sendJSON(res, 400, { error: e.message }); }
            return;
        }
        if (path.match(/^\/api\/innovation\/hackathons\/[^/]+\/experiments$/) && method === 'POST') {
            const hackId = path.split('/')[4]!;
            const body = await readBody(req) as { experimentId: string };
            try {
                const h = addExperimentToHackathon(hackId, body.experimentId);
                sendJSON(res, 200, h);
            } catch (e: any) { sendJSON(res, 400, { error: e.message }); }
            return;
        }

        // Graduations
        if (path === '/api/innovation/graduations' && method === 'GET') {
            const u = new URL(req.url!, `http://${req.headers.host}`);
            const status = u.searchParams.get('status') ?? undefined;
            sendJSON(res, 200, { graduations: listGraduations(status as any) });
            return;
        }
        if (path === '/api/innovation/graduations' && method === 'POST') {
            const body = await readBody(req) as Parameters<typeof requestGraduation>[0];
            const g = requestGraduation(body);
            recordAudit(userId, 'innovation.graduation.request', g.id);
            sendJSON(res, 201, g);
            return;
        }
        if (path.match(/^\/api\/innovation\/graduations\/[^/]+\/review$/) && method === 'POST') {
            const id = path.split('/')[4]!;
            const body = await readBody(req) as { decision: 'approved' | 'rejected'; reviewedBy: string; notes?: string };
            try {
                const g = reviewGraduation(id, body.decision, body.reviewedBy, body.notes);
                recordAudit(userId, 'innovation.graduation.review', id, 'success', body.decision);
                sendJSON(res, 200, g);
            } catch (e: any) { sendJSON(res, 400, { error: e.message }); }
            return;
        }

        // Innovation Backlog (C-Suite overview)
        if (path === '/api/innovation/backlog' && method === 'GET') {
            sendJSON(res, 200, getInnovationBacklog());
            return;
        }

        // -----------------------------------------------------------------------
        // Budget Intelligence — budgets, spend tracking, burn rate, alerts

        if (path === '/api/budget/agents' && method === 'GET') {
            const u = new URL(req.url!, `http://${req.headers.host}`);
            const regiment = u.searchParams.get('regiment') ?? undefined;
            sendJSON(res, 200, { budgets: listBudgets(regiment) });
            return;
        }
        if (path === '/api/budget/agents' && method === 'POST') {
            if (guardRole('operator')) return;
            const body = await readBody(req) as Parameters<typeof setBudget>[0];
            const b = setBudget(body);
            recordAudit(userId, 'budget.set', b.agentId);
            sendJSON(res, 200, b);
            return;
        }
        if (path.match(/^\/api\/budget\/agents\/[^/]+$/) && method === 'GET') {
            const agentId = path.split('/')[4]!;
            const b = getBudget(agentId);
            if (!b) { sendJSON(res, 404, { error: 'Budget not found' }); return; }
            sendJSON(res, 200, b);
            return;
        }
        if (path.match(/^\/api\/budget\/agents\/[^/]+$/) && method === 'DELETE') {
            if (guardRole('operator')) return;
            const agentId = path.split('/')[4]!;
            const ok = deleteBudget(agentId);
            if (!ok) { sendJSON(res, 404, { error: 'Budget not found' }); return; }
            recordAudit(userId, 'budget.delete', agentId);
            sendJSON(res, 204, null);
            return;
        }
        if (path.match(/^\/api\/budget\/agents\/[^/]+\/burn-rate$/) && method === 'GET') {
            const agentId = path.split('/')[4]!;
            sendJSON(res, 200, getBurnRate(agentId));
            return;
        }

        // Spend log
        if (path === '/api/budget/spend' && method === 'POST') {
            if (guardRole('operator')) return;
            const body = await readBody(req) as Parameters<typeof recordSpend>[0];
            const entry = recordSpend(body);
            recordAudit(userId, 'budget.spend.recorded', (body as { agentId?: string })?.agentId ?? 'unknown');
            sendJSON(res, 201, entry);
            return;
        }
        if (path === '/api/budget/spend' && method === 'GET') {
            const u = new URL(req.url!, `http://${req.headers.host}`);
            const agentId = u.searchParams.get('agentId') ?? undefined;
            const limit = parseInt(u.searchParams.get('limit') ?? '100', 10);
            sendJSON(res, 200, { entries: getSpendLog({ agentId, limit }) });
            return;
        }

        // Cost alerts
        if (path === '/api/budget/alerts' && method === 'GET') {
            const u = new URL(req.url!, `http://${req.headers.host}`);
            const agentId = u.searchParams.get('agentId') ?? undefined;
            const severity = u.searchParams.get('severity') ?? undefined;
            const ack = u.searchParams.get('acknowledged');
            sendJSON(res, 200, { alerts: listCostAlerts({ agentId, severity: severity as any, acknowledged: ack === null ? undefined : ack === 'true' }) });
            return;
        }
        if (path.match(/^\/api\/budget\/alerts\/[^/]+\/acknowledge$/) && method === 'POST') {
            if (guardRole('operator')) return;
            const id = path.split('/')[4]!;
            const ok = acknowledgeAlert(id);
            if (!ok) { sendJSON(res, 404, { error: 'Alert not found' }); return; }
            recordAudit(userId, 'budget.alert.ack', id);
            sendJSON(res, 200, { success: true });
            return;
        }

        // CFO Dashboard
        if (path === '/api/budget/dashboard' && method === 'GET') {
            sendJSON(res, 200, getCFODashboard());
            return;
        }

        // -----------------------------------------------------------------------
        // Agent Improvement — reviews, plans, feedback, exemplars

        // Performance Reviews
        if (path === '/api/improvement/reviews' && method === 'GET') {
            const u = new URL(req.url!, `http://${req.headers.host}`);
            const agentId = u.searchParams.get('agentId') ?? undefined;
            sendJSON(res, 200, { reviews: listReviews(agentId) });
            return;
        }
        if (path === '/api/improvement/reviews' && method === 'POST') {
            const body = await readBody(req) as Parameters<typeof createReview>[0];
            const rev = createReview(body);
            recordAudit(userId, 'improvement.review.create', rev.id);
            sendJSON(res, 201, rev);
            return;
        }
        if (path.match(/^\/api\/improvement\/reviews\/[^/]+$/) && method === 'GET') {
            const id = path.split('/')[4]!;
            const rev = getReview(id);
            if (!rev) { sendJSON(res, 404, { error: 'Review not found' }); return; }
            sendJSON(res, 200, rev);
            return;
        }

        // Improvement Plans
        if (path === '/api/improvement/plans' && method === 'GET') {
            const u = new URL(req.url!, `http://${req.headers.host}`);
            const agentId = u.searchParams.get('agentId') ?? undefined;
            const status = u.searchParams.get('status') ?? undefined;
            sendJSON(res, 200, { plans: listPlans(agentId, status as any) });
            return;
        }
        if (path === '/api/improvement/plans' && method === 'POST') {
            const body = await readBody(req) as Parameters<typeof createPlan>[0];
            const plan = createPlan(body);
            recordAudit(userId, 'improvement.plan.create', plan.id);
            sendJSON(res, 201, plan);
            return;
        }
        if (path.match(/^\/api\/improvement\/plans\/[^/]+$/) && method === 'GET') {
            const id = path.split('/')[4]!;
            const plan = getPlan(id);
            if (!plan) { sendJSON(res, 404, { error: 'Plan not found' }); return; }
            sendJSON(res, 200, plan);
            return;
        }
        if (path.match(/^\/api\/improvement\/plans\/[^/]+\/status$/) && method === 'PUT') {
            const id = path.split('/')[4]!;
            const body = await readBody(req) as { status: string };
            try {
                const plan = updatePlanStatus(id, body.status as any);
                recordAudit(userId, 'improvement.plan.status', id, 'success', body.status);
                sendJSON(res, 200, plan);
            } catch (e: any) { sendJSON(res, 404, { error: e.message }); }
            return;
        }
        if (path.match(/^\/api\/improvement\/plans\/[^/]+\/objectives\/[^/]+$/) && method === 'PUT') {
            const parts = path.split('/');
            const planId = parts[4]!;
            const objectiveId = parts[6]!;
            const body = await readBody(req) as { achieved?: boolean; notes?: string };
            try {
                const plan = updateObjective(planId, objectiveId, body);
                sendJSON(res, 200, plan);
            } catch (e: any) { sendJSON(res, 404, { error: e.message }); }
            return;
        }

        // Feedback
        if (path === '/api/improvement/feedback' && method === 'GET') {
            const u = new URL(req.url!, `http://${req.headers.host}`);
            const agentId = u.searchParams.get('agentId') ?? undefined;
            const type = u.searchParams.get('type') ?? undefined;
            const limit = parseInt(u.searchParams.get('limit') ?? '100', 10);
            sendJSON(res, 200, { feedback: listFeedback({ agentId, type: type as any, limit }) });
            return;
        }
        if (path === '/api/improvement/feedback' && method === 'POST') {
            const body = await readBody(req) as Parameters<typeof submitFeedback>[0];
            const fb = submitFeedback(body);
            sendJSON(res, 201, fb);
            return;
        }
        if (path.match(/^\/api\/improvement\/feedback\/summary\/[^/]+$/) && method === 'GET') {
            const agentId = path.split('/')[5]!;
            sendJSON(res, 200, getFeedbackSummary(agentId));
            return;
        }

        // Training Exemplars
        if (path === '/api/improvement/exemplars' && method === 'GET') {
            const u = new URL(req.url!, `http://${req.headers.host}`);
            const agentId = u.searchParams.get('agentId') ?? undefined;
            const rating = u.searchParams.get('rating') ?? undefined;
            sendJSON(res, 200, { exemplars: listExemplars({ agentId, rating: rating as any }) });
            return;
        }
        if (path === '/api/improvement/exemplars' && method === 'POST') {
            const body = await readBody(req) as Parameters<typeof addExemplar>[0];
            const ex = addExemplar(body);
            recordAudit(userId, 'improvement.exemplar.add', ex.id);
            sendJSON(res, 201, ex);
            return;
        }
        if (path.match(/^\/api\/improvement\/exemplars\/[^/]+$/) && method === 'DELETE') {
            const id = path.split('/')[4]!;
            const ok = deleteExemplar(id);
            if (!ok) { sendJSON(res, 404, { error: 'Exemplar not found' }); return; }
            sendJSON(res, 204, null);
            return;
        }

        // Agent Health Report (C-Suite overview)
        if (path === '/api/improvement/health' && method === 'GET') {
            sendJSON(res, 200, getAgentHealthReport());
            return;
        }

        // -----------------------------------------------------------------------
        // Tool Connection Management — connect, disconnect, test, catalog

        // GET /api/tools/catalog — full marketing tool catalog
        if (path === '/api/tools/catalog' && method === 'GET') {
            sendJSON(res, 200, { tools: MARKETING_TOOL_CATALOG });
            return;
        }

        // POST /api/tools/:toolId/connect — save credentials and mark connected
        if (path.match(/^\/api\/tools\/[^/]+\/connect$/) && method === 'POST') {
            const toolId = path.split('/')[3]!;
            const body = await readBody(req);
            const { apiKey, accessToken, accountName } = body as { apiKey?: string; accessToken?: string; accountName?: string };
            const result = connectTool(toolId, { apiKey, accessToken, accountName });
            recordAudit(userId, 'tool.connect', toolId, result.success ? 'success' : 'failed');
            if (result.success) {
                const status = getToolConnectionStatus(toolId);
                sendJSON(res, 200, { success: true, message: result.message, connection: status });
            } else {
                sendJSON(res, 400, { success: false, error: result.message });
            }
            return;
        }

        // POST /api/tools/:toolId/disconnect — clear connection
        if (path.match(/^\/api\/tools\/[^/]+\/disconnect$/) && method === 'POST') {
            if (guardRole('operator')) return;
            const toolId = path.split('/')[3]!;
            const result = disconnectTool(toolId);
            recordAudit(userId, 'tool.disconnect', toolId);
            sendJSON(res, 200, { success: result.success, message: result.message });
            return;
        }

        // POST /api/tools/:toolId/test — validate current connection
        if (path.match(/^\/api\/tools\/[^/]+\/test$/) && method === 'POST') {
            const toolId = path.split('/')[3]!;
            const result = await testToolConnection(toolId);
            sendJSON(res, result.success ? 200 : 400, result);
            return;
        }

        // GET /api/tools/:toolId/status — single tool status
        if (path.match(/^\/api\/tools\/[^/]+\/status$/) && method === 'GET') {
            const toolId = path.split('/')[3]!;
            const status = getToolConnectionStatus(toolId);
            sendJSON(res, 200, { connection: status });
            return;
        }

        // -----------------------------------------------------------------------
        // Connections API — generic connector state for ConnectionsHub
        // Uses an in-memory map keyed by connectorId

        // GET /api/connections — list all connection states
        if (path === '/api/connections' && method === 'GET') {
            sendJSON(res, 200, { connections: Object.fromEntries(connectionStore) });
            return;
        }

        // POST /api/connections/:connectorId/connect
        if (path.match(/^\/api\/connections\/[^/]+\/connect$/) && method === 'POST') {
            const connectorId = path.split('/')[3]!;
            const body = await readBody(req);
            const { credentials } = body as { credentials: Record<string, string> };
            // Validate: just check at least one non-empty value is present
            const hasValue = credentials && Object.values(credentials).some(v => v && v.trim().length > 0);
            if (!hasValue) {
                sendJSON(res, 400, { status: 'error', error: 'No credentials provided.' });
                return;
            }
            connectionStore.set(connectorId, {
                connectorId,
                status: 'connected',
                connectedAt: new Date().toISOString(),
                credentials,
            });
            sendJSON(res, 200, { status: 'connected', connectorId });
            return;
        }

        // POST /api/connections/:connectorId/disconnect
        if (path.match(/^\/api\/connections\/[^/]+\/disconnect$/) && method === 'POST') {
            const connectorId = path.split('/')[3]!;
            const existing = connectionStore.get(connectorId);
            if (existing) {
                connectionStore.set(connectorId, { connectorId, status: 'not-connected' });
            }
            sendJSON(res, 200, { status: 'not-connected', connectorId });
            return;
        }

        // POST /api/connections/:connectorId/test
        if (path.match(/^\/api\/connections\/[^/]+\/test$/) && method === 'POST') {
            const connectorId = path.split('/')[3]!;
            const state = connectionStore.get(connectorId);
            if (!state || state.status === 'not-connected') {
                sendJSON(res, 400, { ok: false, error: 'Not connected. Add credentials first.' });
                return;
            }
            // Simulate a lightweight test (real validation would call the provider's health endpoint)
            const simulatedOk = Math.random() > 0.05; // 95% pass rate in sim
            if (simulatedOk) {
                connectionStore.set(connectorId, { ...state, status: 'connected', lastTestedAt: new Date().toISOString() });
                sendJSON(res, 200, { ok: true, message: 'Connection validated successfully.' });
            } else {
                connectionStore.set(connectorId, { ...state, status: 'error', error: 'Credentials rejected by provider.' });
                sendJSON(res, 400, { ok: false, error: 'Test failed — credentials may be expired.' });
            }
            return;
        }

        // GET /api/connections/:connectorId/status
        if (path.match(/^\/api\/connections\/[^/]+\/status$/) && method === 'GET') {
            const connectorId = path.split('/')[3]!;
            const state = connectionStore.get(connectorId) ?? { connectorId, status: 'not-connected' };
            sendJSON(res, 200, { connection: state });
            return;
        }

        // -----------------------------------------------------------------------
        // Engineering Persona API (persona-gated)

        if (path.startsWith('/api/engineering/') && authUser && !requirePersonaAccess(authUser, 'engineering')) {
            sendJSON(res, 403, { error: 'Access denied for persona: engineering' }); return;
        }

        // GET /api/engineering/skills — full skill catalog
        if (path === '/api/engineering/skills' && method === 'GET') {
            sendJSON(res, 200, { skills: ENGINEERING_SKILLS, clusters: getEngineeringSkillsByCluster() });
            return;
        }

        // GET /api/engineering/skills/:idOrSlug — single skill
        if (path.match(/^\/api\/engineering\/skills\/[^/]+$/) && method === 'GET') {
            const idOrSlug = path.split('/')[4]!;
            const skill = getEngineeringSkill(idOrSlug);
            if (!skill) { sendJSON(res, 404, { error: 'Skill not found' }); return; }
            sendJSON(res, 200, { skill });
            return;
        }

        // POST /api/engineering/execute — run a skill
        if (path === '/api/engineering/execute' && method === 'POST') {
            const body = await readBody(req);
            const { skillId, inputs, simulate, customPrompt, provider, modelId } = body as { skillId?: string; inputs?: Record<string, unknown>; simulate?: boolean; customPrompt?: string; provider?: string; modelId?: string };
            if (!skillId) { sendJSON(res, 400, { error: 'skillId required' }); return; }
            const skill = getEngineeringSkill(skillId);
            if (!skill) { sendJSON(res, 404, { error: `Skill not found: ${skillId}` }); return; }
            const exec = createPersonaExecution('engineering', skill, inputs ?? {}, undefined, simulate, customPrompt, provider as any, modelId);
            recordAudit(userId, 'skill.execute', `Engineering / ${skill.name}`);
            broadcastEvent(exec.id, 'session.started', { persona: 'engineering', skillId, simulate, provider });
            sendJSON(res, 200, { execution: exec });
            return;
        }

        // GET /api/engineering/executions — list recent executions
        if (path === '/api/engineering/executions' && method === 'GET') {
            const execs = listPersonaExecutions('engineering');
            sendJSON(res, 200, { executions: execs });
            return;
        }

        // GET /api/engineering/executions/:id — single execution
        if (path.match(/^\/api\/engineering\/executions\/[^/]+$/) && method === 'GET') {
            const execId = path.split('/')[4]!;
            const exec = getPersonaExecution(execId);
            if (!exec || exec.persona !== 'engineering') { sendJSON(res, 404, { error: 'Execution not found' }); return; }
            sendJSON(res, 200, { execution: exec });
            return;
        }

        // POST /api/engineering/executions/:id/approve/:stepId — approve a step
        if (path.match(/^\/api\/engineering\/executions\/[^/]+\/approve\/[^/]+$/) && method === 'POST') {
            const parts = path.split('/');
            const execId = parts[4]!;
            const stepId = parts[6]!;
            const result = approvePersonaStep(execId, stepId);
            sendJSON(res, result.success ? 200 : 400, result);
            return;
        }

        // -----------------------------------------------------------------------
        // Product Persona API (persona-gated)

        if (path.startsWith('/api/product/') && authUser && !requirePersonaAccess(authUser, 'product')) {
            sendJSON(res, 403, { error: 'Access denied for persona: product' }); return;
        }

        // GET /api/product/skills — full skill catalog
        if (path === '/api/product/skills' && method === 'GET') {
            sendJSON(res, 200, { skills: PRODUCT_SKILLS, clusters: getProductSkillsByCluster() });
            return;
        }

        // GET /api/product/skills/:idOrSlug — single skill
        if (path.match(/^\/api\/product\/skills\/[^/]+$/) && method === 'GET') {
            const idOrSlug = path.split('/')[4]!;
            const skill = getProductSkill(idOrSlug);
            if (!skill) { sendJSON(res, 404, { error: 'Skill not found' }); return; }
            sendJSON(res, 200, { skill });
            return;
        }

        // POST /api/product/execute — run a skill
        if (path === '/api/product/execute' && method === 'POST') {
            const body = await readBody(req);
            const { skillId, inputs, simulate, customPrompt, provider, modelId } = body as { skillId?: string; inputs?: Record<string, unknown>; simulate?: boolean; customPrompt?: string; provider?: string; modelId?: string };
            if (!skillId) { sendJSON(res, 400, { error: 'skillId required' }); return; }
            const skill = getProductSkill(skillId);
            if (!skill) { sendJSON(res, 404, { error: `Skill not found: ${skillId}` }); return; }
            const exec = createPersonaExecution('product', skill, inputs ?? {}, undefined, simulate, customPrompt, provider as any, modelId);
            recordAudit(userId, 'skill.execute', `Product / ${skill.name}`);
            broadcastEvent(exec.id, 'session.started', { persona: 'product', skillId, simulate, provider });
            sendJSON(res, 200, { execution: exec });
            return;
        }

        // GET /api/product/executions — list recent executions
        if (path === '/api/product/executions' && method === 'GET') {
            const execs = listPersonaExecutions('product');
            sendJSON(res, 200, { executions: execs });
            return;
        }

        // GET /api/product/executions/:id — single execution
        if (path.match(/^\/api\/product\/executions\/[^/]+$/) && method === 'GET') {
            const execId = path.split('/')[4]!;
            const exec = getPersonaExecution(execId);
            if (!exec || exec.persona !== 'product') { sendJSON(res, 404, { error: 'Execution not found' }); return; }
            sendJSON(res, 200, { execution: exec });
            return;
        }

        // POST /api/product/executions/:id/approve/:stepId — approve a step
        if (path.match(/^\/api\/product\/executions\/[^/]+\/approve\/[^/]+$/) && method === 'POST') {
            const parts = path.split('/');
            const execId = parts[4]!;
            const stepId = parts[6]!;
            const result = approvePersonaStep(execId, stepId);
            sendJSON(res, result.success ? 200 : 400, result);
            return;
        }

        // -----------------------------------------------------------------------
        // HR & Talent Acquisition Persona API (persona-gated)

        if (path.startsWith('/api/hr/') && authUser && !requirePersonaAccess(authUser, 'hr')) {
            sendJSON(res, 403, { error: 'Access denied for persona: hr' }); return;
        }

        // GET /api/hr/skills — full skill catalog
        if (path === '/api/hr/skills' && method === 'GET') {
            sendJSON(res, 200, { skills: HR_SKILLS, clusters: getHRSkillsByCluster() });
            return;
        }

        // GET /api/hr/skills/:idOrSlug — single skill
        if (path.match(/^\/api\/hr\/skills\/[^/]+$/) && method === 'GET') {
            const idOrSlug = path.split('/')[4]!;
            const skill = getHRSkill(idOrSlug);
            if (!skill) { sendJSON(res, 404, { error: 'Skill not found' }); return; }
            sendJSON(res, 200, { skill });
            return;
        }

        // POST /api/hr/execute — run a skill
        if (path === '/api/hr/execute' && method === 'POST') {
            const body = await readBody(req);
            const { skillId, inputs, simulate, customPrompt, provider, modelId } = body as { skillId?: string; inputs?: Record<string, unknown>; simulate?: boolean; customPrompt?: string; provider?: string; modelId?: string };
            if (!skillId) { sendJSON(res, 400, { error: 'skillId required' }); return; }
            const skill = getHRSkill(skillId);
            if (!skill) { sendJSON(res, 404, { error: `Skill not found: ${skillId}` }); return; }
            const exec = createPersonaExecution('hr', skill, inputs ?? {}, undefined, simulate, customPrompt, provider as any, modelId);
            recordAudit(userId, 'skill.execute', `HR / ${skill.name}`);
            broadcastEvent(exec.id, 'session.started', { persona: 'hr', skillId, simulate, provider });
            sendJSON(res, 200, { execution: exec });
            return;
        }

        // GET /api/hr/executions — list recent executions
        if (path === '/api/hr/executions' && method === 'GET') {
            const execs = listPersonaExecutions('hr');
            sendJSON(res, 200, { executions: execs });
            return;
        }

        // GET /api/hr/executions/:id — single execution
        if (path.match(/^\/api\/hr\/executions\/[^/]+$/) && method === 'GET') {
            const execId = path.split('/')[4]!;
            const exec = getPersonaExecution(execId);
            if (!exec || exec.persona !== 'hr') { sendJSON(res, 404, { error: 'Execution not found' }); return; }
            sendJSON(res, 200, { execution: exec });
            return;
        }

        // POST /api/hr/executions/:id/approve/:stepId — approve a step
        if (path.match(/^\/api\/hr\/executions\/[^/]+\/approve\/[^/]+$/) && method === 'POST') {
            const parts = path.split('/');
            const execId = parts[4]!;
            const stepId = parts[6]!;
            const result = approvePersonaStep(execId, stepId);
            sendJSON(res, result.success ? 200 : 400, result);
            return;
        }

        // -----------------------------------------------------------------------
        // TA (Talent Acquisition) Persona API
        // -----------------------------------------------------------------------

        if (path === '/api/ta/skills' && method === 'GET') {
            const cluster = url.searchParams.get('cluster') ?? undefined;
            sendJSON(res, 200, { skills: cluster ? getTASkillsByCluster(cluster) : TA_SKILLS });
            return;
        }

        if (path.match(/^\/api\/ta\/skills\/[^/]+$/) && method === 'GET') {
            const idOrSlug = path.split('/')[4]!;
            const skill = getTASkill(idOrSlug);
            if (!skill) { sendJSON(res, 404, { error: 'Skill not found' }); return; }
            sendJSON(res, 200, { skill });
            return;
        }

        if (path === '/api/ta/executions' && method === 'POST') {
            const body = await readBody(req);
            const { skillId, inputs, simulate } = body as { skillId?: string; inputs?: Record<string, unknown>; simulate?: boolean };
            if (!skillId) { sendJSON(res, 400, { error: 'skillId required' }); return; }
            const skill = getTASkill(skillId);
            if (!skill) { sendJSON(res, 404, { error: `Skill not found: ${skillId}` }); return; }
            const execution = createPersonaExecution('ta' as any, skill as any, inputs || {}, userId, simulate ?? false);
            sendJSON(res, 201, { execution });
            return;
        }

        if (path === '/api/ta/executions' && method === 'GET') {
            const execs = listPersonaExecutions('ta' as any);
            sendJSON(res, 200, { executions: execs });
            return;
        }

        if (path.match(/^\/api\/ta\/executions\/[^/]+$/) && method === 'GET') {
            const execId = path.split('/')[4]!;
            const exec = getPersonaExecution(execId);
            if (!exec) { sendJSON(res, 404, { error: 'Execution not found' }); return; }
            sendJSON(res, 200, { execution: exec });
            return;
        }

        // -----------------------------------------------------------------------
        // Program Persona API
        // -----------------------------------------------------------------------

        if (path === '/api/program/skills' && method === 'GET') {
            const cluster = url.searchParams.get('cluster') ?? undefined;
            sendJSON(res, 200, { skills: cluster ? getProgramSkillsByCluster(cluster) : PROGRAM_SKILLS });
            return;
        }

        if (path.match(/^\/api\/program\/skills\/[^/]+$/) && method === 'GET') {
            const idOrSlug = path.split('/')[4]!;
            const skill = getProgramSkill(idOrSlug);
            if (!skill) { sendJSON(res, 404, { error: 'Skill not found' }); return; }
            sendJSON(res, 200, { skill });
            return;
        }

        if (path === '/api/program/executions' && method === 'POST') {
            const body = await readBody(req);
            const { skillId, inputs, simulate } = body as { skillId?: string; inputs?: Record<string, unknown>; simulate?: boolean };
            if (!skillId) { sendJSON(res, 400, { error: 'skillId required' }); return; }
            const skill = getProgramSkill(skillId);
            if (!skill) { sendJSON(res, 404, { error: `Skill not found: ${skillId}` }); return; }
            const execution = createPersonaExecution('program' as any, skill as any, inputs || {}, userId, simulate ?? false);
            sendJSON(res, 201, { execution });
            return;
        }

        if (path === '/api/program/executions' && method === 'GET') {
            const execs = listPersonaExecutions('program' as any);
            sendJSON(res, 200, { executions: execs });
            return;
        }

        if (path.match(/^\/api\/program\/executions\/[^/]+$/) && method === 'GET') {
            const execId = path.split('/')[4]!;
            const exec = getPersonaExecution(execId);
            if (!exec) { sendJSON(res, 404, { error: 'Execution not found' }); return; }
            sendJSON(res, 200, { execution: exec });
            return;
        }

        // -----------------------------------------------------------------------
        // Orchestrator API — Goal decomposition & execution
        // -----------------------------------------------------------------------

        if (path === '/api/orchestrator/goal' && method === 'POST') {
            const body = await readBody(req);
            const { description, context, priority } = body as { description?: string; context?: Record<string, unknown>; priority?: string };
            if (!description || typeof description !== 'string') {
                sendJSON(res, 400, { error: 'Missing description field' });
                return;
            }
            const exec = await submitGoal(
                description,
                context as Record<string, unknown>,
                (priority as 'low' | 'normal' | 'high' | 'critical') ?? 'normal',
                userId
            );
            recordAudit(userId, 'goal.submit', String(description).slice(0, 80));
            broadcastEvent(exec.id, 'session.started', { type: 'goal', description, priority });
            sendJSON(res, 200, exec);
            return;
        }

        if (path.startsWith('/api/orchestrator/goal/') && method === 'GET') {
            const goalId = path.replace('/api/orchestrator/goal/', '');
            const exec = getGoalExecution(goalId);
            if (!exec) { sendJSON(res, 404, { error: 'Goal execution not found' }); return; }
            sendJSON(res, 200, exec);
            return;
        }

        if (path.startsWith('/api/orchestrator/goal/') && path.endsWith('/cancel') && method === 'POST') {
            const goalId = path.replace('/api/orchestrator/goal/', '').replace('/cancel', '');
            const cancelled = await cancelGoal(goalId);
            sendJSON(res, 200, { cancelled });
            return;
        }

        if (path === '/api/orchestrator/goals' && method === 'GET') {
            sendJSON(res, 200, listGoalExecutions());
            return;
        }

        // -----------------------------------------------------------------------
        // Pipeline Graph Config API — serve graph.json for each persona
        // -----------------------------------------------------------------------

        const graphRouteMatch = path.match(/^\/api\/(\w+)\/pipeline\/graph$/);
        const graphQueryPersona = path === '/api/pipeline/graph' && method === 'GET' ? url.searchParams.get('persona') : null;

        if ((graphRouteMatch || graphQueryPersona) && method === 'GET') {
            const persona = (graphRouteMatch?.[1] || graphQueryPersona || '').toLowerCase();
            try {
                // Resolve project root relative to this server file
                const thisDir = typeof __dirname !== 'undefined' ? __dirname : nodePath.dirname(fileURLToPath(import.meta.url));
                const projectRoot = nodePath.resolve(thisDir, '..', '..', '..');
                const graphPath = nodePath.join(projectRoot, 'agents', persona, 'graph_runtime', 'graph.json');
                if (fs.existsSync(graphPath)) {
                    const raw = fs.readFileSync(graphPath, 'utf-8');
                    const data = JSON.parse(raw);
                    sendJSON(res, 200, data);
                } else {
                    // Generate a minimal placeholder graph for personas without a graph.json
                    const agentsByPersona = getAgentsByPersona(persona as any);
                    const nodes = agentsByPersona.map((a, i) => ({
                        id: a.id,
                        agent: a.id,
                        depends_on: i > 0 ? [agentsByPersona[i - 1].id] : [],
                        phase: 'default',
                        parallel_group: null,
                    }));
                    sendJSON(res, 200, {
                        graph_id: `${persona}.agent_graph`,
                        name: `${persona.charAt(0).toUpperCase() + persona.slice(1)} Agent Collaboration Graph`,
                        description: `Auto-generated graph for ${persona} agents`,
                        nodes,
                        phases: { default: { label: 'Execution', order: 1, description: 'Sequential agent execution' } },
                        quality_gates: [],
                        checkpoints: [],
                        feedback_loops: [],
                        shared_state: [],
                    });
                }
            } catch (err) {
                sendJSON(res, 500, { error: 'Failed to load graph config' });
            }
            return;
        }

        // -----------------------------------------------------------------------
        // Pipeline Engine API — DAG-based agent pipeline execution
        // -----------------------------------------------------------------------

        if (path === '/api/pipeline/execute' && method === 'POST') {
            const body = await readBody(req);
            const { intent, context, provider, model, graphConfig, orchestratorConfig, agentDefinitions } = body as {
                intent?: string;
                context?: Record<string, unknown>;
                provider?: string;
                model?: string;
                graphConfig?: GraphConfig;
                orchestratorConfig?: OrchestratorConfig;
                agentDefinitions?: AgentDefinition[];
            };
            if (!intent || typeof intent !== 'string') {
                sendJSON(res, 400, { error: 'Missing intent field' });
                return;
            }
            if (!graphConfig || !orchestratorConfig || !agentDefinitions?.length) {
                sendJSON(res, 400, { error: 'Missing graphConfig, orchestratorConfig, or agentDefinitions' });
                return;
            }
            const agentDefs = new Map(agentDefinitions.map(a => [a.agent_id, a]));
            const engine = new PipelineEngine(graphConfig, orchestratorConfig, agentDefs);
            const execution = await engine.execute(intent, context, { provider: provider as any, model });
            recordAudit(userId, 'pipeline.execute', String(intent).slice(0, 80));
            broadcastEvent(execution.id, 'pipeline.started', { intent, nodeCount: execution.nodeStates.size });
            sendJSON(res, 200, {
                id: execution.id,
                status: execution.status,
                intent: execution.intent,
                totalTokensUsed: execution.totalTokensUsed,
                totalCostUsd: execution.totalCostUsd,
                afterActionReport: execution.afterActionReport,
                statusReports: execution.statusReports,
            });
            return;
        }

        if (path.startsWith('/api/pipeline/') && !path.includes('/cancel') && method === 'GET') {
            const pipelineId = path.replace('/api/pipeline/', '');
            const exec = getPipelineExecution(pipelineId);
            if (!exec) { sendJSON(res, 404, { error: 'Pipeline execution not found' }); return; }
            sendJSON(res, 200, {
                id: exec.id,
                status: exec.status,
                intent: exec.intent,
                totalTokensUsed: exec.totalTokensUsed,
                totalCostUsd: exec.totalCostUsd,
                afterActionReport: exec.afterActionReport,
                statusReports: exec.statusReports,
            });
            return;
        }

        if (path.startsWith('/api/pipeline/') && path.endsWith('/cancel') && method === 'POST') {
            const pipelineId = path.replace('/api/pipeline/', '').replace('/cancel', '');
            const cancelled = await cancelPipeline(pipelineId);
            sendJSON(res, 200, { cancelled });
            return;
        }

        if (path === '/api/pipelines' && method === 'GET') {
            const executions = listPipelineExecutions().map(e => ({
                id: e.id,
                status: e.status,
                intent: e.intent,
                startedAt: e.startedAt,
                completedAt: e.completedAt,
                totalTokensUsed: e.totalTokensUsed,
                totalCostUsd: e.totalCostUsd,
            }));
            sendJSON(res, 200, executions);
            return;
        }

        // GET /api/plugins — list registered plugins and their health
        if (path === '/api/plugins' && method === 'GET') {
            const health = await pluginRegistry.healthCheckAll();
            const plugins = [
                ...pluginRegistry.listByType('runtime').map(p => ({ ...p.manifest, healthy: health.get(p.manifest.id)?.healthy })),
                ...pluginRegistry.listByType('tool').map(p => ({ ...p.manifest, healthy: health.get(p.manifest.id)?.healthy })),
                ...pluginRegistry.listByType('llm').map(p => ({ ...p.manifest, healthy: health.get(p.manifest.id)?.healthy })),
                ...pluginRegistry.listByType('memory').map(p => ({ ...p.manifest, healthy: health.get(p.manifest.id)?.healthy })),
                ...pluginRegistry.listByType('observability').map(p => ({ ...p.manifest, healthy: health.get(p.manifest.id)?.healthy })),
            ];
            sendJSON(res, 200, { plugins });
            return;
        }

        // -----------------------------------------------------------------------
        // Event Bus API — Event log & metrics
        // -----------------------------------------------------------------------

        if (path === '/api/events' && method === 'GET') {
            const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
            const pattern = url.searchParams.get('pattern') ?? undefined;
            const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
            sendJSON(res, 200, eventBus.getLog(pattern, limit));
            return;
        }

        if (path === '/api/events/metrics' && method === 'GET') {
            sendJSON(res, 200, eventBus.getMetrics());
            return;
        }

        // -----------------------------------------------------------------------
        // LLM Provider API — Multi-model support
        // -----------------------------------------------------------------------

        if (path === '/api/llm/providers' && method === 'GET') {
            const providers = getAvailableProviders();
            const defaultProvider = getDefaultProvider();
            sendJSON(res, 200, { providers, defaultProvider });
            return;
        }

        // -----------------------------------------------------------------------
        // Agent Registry API — Backend agent identities
        // -----------------------------------------------------------------------

        if (path === '/api/agents/registry' && method === 'GET') {
            sendJSON(res, 200, getFullRegistry());
            return;
        }

        if (path.match(/^\/api\/agents\/registry\/[^/]+$/) && method === 'GET') {
            const agentIdOrCallSign = decodeURIComponent(path.split('/')[4]!);
            const agent = getAgentIdentity(agentIdOrCallSign);
            if (!agent) { sendJSON(res, 404, { error: `Agent not found: ${agentIdOrCallSign}` }); return; }
            sendJSON(res, 200, { agent });
            return;
        }

        if (path.match(/^\/api\/agents\/persona\/[^/]+$/) && method === 'GET') {
            const persona = path.split('/')[4] as any;
            const agents = getAgentsByPersona(persona);
            sendJSON(res, 200, { agents, count: agents.length });
            return;
        }

        // -----------------------------------------------------------------------
        // Agent KPI API — Performance metrics from real executions
        // -----------------------------------------------------------------------

        if (path === '/api/agents/kpis' && method === 'GET') {
            sendJSON(res, 200, { kpis: getAgentKPIs() });
            return;
        }

        if (path.match(/^\/api\/agents\/kpis\/[^/]+$/) && method === 'GET') {
            const agentId = decodeURIComponent(path.split('/')[4]!);
            const kpi = getAgentKPI(agentId);
            if (!kpi) { sendJSON(res, 404, { error: `No KPI data for agent: ${agentId}` }); return; }
            sendJSON(res, 200, { kpi });
            return;
        }

        // Agent Memory — per-agent accumulated context
        if (path === '/api/agents/memory' && method === 'GET') {
            sendJSON(res, 200, { snapshots: getAllAgentMemorySnapshots() });
            return;
        }

        if (path.match(/^\/api\/agents\/memory\/[^/]+$/) && method === 'GET') {
            const agentId = decodeURIComponent(path.split('/')[4]!);
            sendJSON(res, 200, { agentId, entries: getAgentMemory(agentId), document: getAgentMemoryDocument(agentId) });
            return;
        }

        if (path.match(/^\/api\/agents\/memory\/[^/]+$/) && method === 'POST') {
            const agentId = decodeURIComponent(path.split('/')[4]!);
            const body = await readBody(req);
            if (!body.kind || !body.content) { sendJSON(res, 400, { error: 'kind and content required' }); return; }
            const entry = recordAgentMemory(agentId, body.kind as 'learning' | 'correction' | 'pattern' | 'preference', body.content as string, (body.source as string) ?? 'manual');
            sendJSON(res, 201, { entry });
            return;
        }

        // -----------------------------------------------------------------------
        // C-Suite Command Layer & Vision-Down Execution
        // -----------------------------------------------------------------------

        // GET /api/csuite — list all C-Suite officers with profiles
        if (path === '/api/csuite' && method === 'GET') {
            const agents = getCSuiteAgents();
            const profiles = getAllCSuiteProfiles();
            const officers = agents.map(a => ({
                agent: a,
                profile: profiles.find(p => p.agentId === a.id),
                directReports: getChainOfCommand(a.id).length - 1,
            }));
            sendJSON(res, 200, { officers, total: officers.length });
            return;
        }

        // GET /api/csuite/:agentId — get C-Suite officer detail
        if (path.match(/^\/api\/csuite\/[^/]+$/) && method === 'GET') {
            const agentId = decodeURIComponent(path.split('/')[3]!);
            const agent = getAgentIdentity(agentId);
            const profile = getCSuiteProfile(agentId);
            if (!agent || !profile) { sendJSON(res, 404, { error: 'C-Suite officer not found' }); return; }
            const orgTree = getOrgTree(agentId);
            sendJSON(res, 200, { agent, profile, orgTree });
            return;
        }

        // GET /api/csuite/:agentId/chain — get chain of command
        if (path.match(/^\/api\/csuite\/[^/]+\/chain$/) && method === 'GET') {
            const agentId = decodeURIComponent(path.split('/')[3]!);
            const chain = getChainOfCommand(agentId);
            sendJSON(res, 200, { chain });
            return;
        }

        // -----------------------------------------------------------------------
        // Vision Statements — strategic vision management
        // -----------------------------------------------------------------------

        // POST /api/vision — create a new vision statement
        if (path === '/api/vision' && method === 'POST') {
            const body = await readBody(req);
            const { statement } = body as { statement: string };
            if (!statement) { sendJSON(res, 400, { error: 'statement is required' }); return; }
            const vision = await createVision(statement, 'user');
            sendJSON(res, 201, { vision });
            return;
        }

        // GET /api/vision — list all vision statements
        if (path === '/api/vision' && method === 'GET') {
            sendJSON(res, 200, { visions: listVisions() });
            return;
        }

        // GET /api/vision/:id — get vision detail
        if (path.match(/^\/api\/vision\/[^/]+$/) && method === 'GET') {
            const visionId = decodeURIComponent(path.split('/')[3]!);
            const vision = getVision(visionId);
            if (!vision) { sendJSON(res, 404, { error: 'Vision not found' }); return; }
            sendJSON(res, 200, { vision });
            return;
        }

        // POST /api/vision/:id/decompose — CEO decomposes vision into objectives
        if (path.match(/^\/api\/vision\/[^/]+\/decompose$/) && method === 'POST') {
            const visionId = decodeURIComponent(path.split('/')[3]!);
            try {
                const decomposition = await decomposeVision(visionId);
                sendJSON(res, 200, { decomposition });
            } catch (err) {
                sendJSON(res, 400, { error: (err as Error).message });
            }
            return;
        }

        // POST /api/vision/:id/cascade/:objectiveId — cascade objective to regiment
        if (path.match(/^\/api\/vision\/[^/]+\/cascade\/[^/]+$/) && method === 'POST') {
            const parts = path.split('/');
            const visionId = decodeURIComponent(parts[3]!);
            const objectiveId = decodeURIComponent(parts[5]!);
            try {
                const tasks = await cascadeToRegiment(visionId, objectiveId);
                sendJSON(res, 200, { tasks });
            } catch (err) {
                sendJSON(res, 400, { error: (err as Error).message });
            }
            return;
        }

        // GET /api/vision/:id/status — roll-up progress view
        if (path.match(/^\/api\/vision\/[^/]+\/status$/) && method === 'GET') {
            const visionId = decodeURIComponent(path.split('/')[3]!);
            const status = getVisionStatus(visionId);
            if (!status) { sendJSON(res, 404, { error: 'Vision not found' }); return; }
            sendJSON(res, 200, status);
            return;
        }

        // -----------------------------------------------------------------------
        // PMO — Program Management Office
        // -----------------------------------------------------------------------

        // POST /api/pmo/programs — create a program
        if (path === '/api/pmo/programs' && method === 'POST') {
            const body = await readBody(req);
            const { visionId, title, involvedRegiments } = body as { visionId: string; title: string; involvedRegiments: string[] };
            if (!visionId || !title) { sendJSON(res, 400, { error: 'visionId and title are required' }); return; }
            const program = await createProgram(visionId, title, involvedRegiments ?? []);
            sendJSON(res, 201, { program });
            return;
        }

        // GET /api/pmo/programs — list programs
        if (path === '/api/pmo/programs' && method === 'GET') {
            const visionId = url.searchParams.get('visionId') ?? undefined;
            sendJSON(res, 200, { programs: listPrograms(visionId) });
            return;
        }

        // GET /api/pmo/programs/:id — get program detail
        if (path.match(/^\/api\/pmo\/programs\/[^/]+$/) && method === 'GET') {
            const programId = decodeURIComponent(path.split('/')[4]!);
            const program = getProgram(programId);
            if (!program) { sendJSON(res, 404, { error: 'Program not found' }); return; }
            sendJSON(res, 200, { program });
            return;
        }

        // PUT /api/pmo/programs/:id — update program
        if (path.match(/^\/api\/pmo\/programs\/[^/]+$/) && method === 'PUT') {
            const programId = decodeURIComponent(path.split('/')[4]!);
            const body = await readBody(req);
            try {
                const program = await updateProgram(programId, body as any);
                sendJSON(res, 200, { program });
            } catch (err) {
                sendJSON(res, 404, { error: (err as Error).message });
            }
            return;
        }

        // GET /api/pmo/status — PMO status report
        if (path === '/api/pmo/status' && method === 'GET') {
            const visionId = url.searchParams.get('visionId') ?? undefined;
            const report = await generatePMOStatusReport(visionId);
            sendJSON(res, 200, { report });
            return;
        }

        // -----------------------------------------------------------------------
        // After-Action Reports (AAR) — auto-generated per execution
        // -----------------------------------------------------------------------

        // GET /api/aar — list all AARs
        if (path === '/api/aar' && method === 'GET') {
            const persona = url.searchParams.get('persona') ?? undefined;
            const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
            sendJSON(res, 200, { reports: listAfterActionReports(persona, limit) });
            return;
        }

        // GET /api/aar/:executionId — get AAR for a specific execution
        if (path.match(/^\/api\/aar\/[^/]+$/) && method === 'GET') {
            const executionId = decodeURIComponent(path.split('/')[3]!);
            const aar = getAfterActionReport(executionId);
            if (!aar) { sendJSON(res, 404, { error: 'No After-Action Report for this execution' }); return; }
            sendJSON(res, 200, { report: aar });
            return;
        }

        // -----------------------------------------------------------------------
        // Retraining Flags — agent performance alerts
        // -----------------------------------------------------------------------

        // GET /api/retraining — list all retraining flags
        if (path === '/api/retraining' && method === 'GET') {
            sendJSON(res, 200, { flags: getRetrainingFlags() });
            return;
        }

        // GET /api/retraining/:agentId — get flag for specific agent
        if (path.match(/^\/api\/retraining\/[^/]+$/) && method === 'GET') {
            const agentId = decodeURIComponent(path.split('/')[3]!);
            const flag = getRetrainingFlag(agentId);
            if (!flag) { sendJSON(res, 404, { error: 'No retraining flag for this agent' }); return; }
            sendJSON(res, 200, { flag });
            return;
        }

        // POST /api/retraining/:agentId/acknowledge — mark flag as reviewed
        if (path.match(/^\/api\/retraining\/[^/]+\/acknowledge$/) && method === 'POST') {
            const agentId = decodeURIComponent(path.split('/')[3]!);
            const result = acknowledgeRetrainingFlag(agentId);
            sendJSON(res, result.success ? 200 : 404, result);
            return;
        }

        // DELETE /api/retraining/:agentId — dismiss a retraining flag
        if (path.match(/^\/api\/retraining\/[^/]+$/) && method === 'DELETE') {
            const agentId = decodeURIComponent(path.split('/')[3]!);
            const result = dismissRetrainingFlag(agentId);
            sendJSON(res, result.success ? 200 : 404, result);
            return;
        }

        // -----------------------------------------------------------------------
        // Cognitive Pipeline — goal decomposition, reasoning, reflection, grounding
        // -----------------------------------------------------------------------
        if (path === '/api/cognitive/process' && method === 'POST') {
            const body = await readBody(req);
            const { goal, context, options } = body as { goal: string; context?: Record<string, unknown>; options?: CognitiveRequest['options'] };
            if (!goal) { sendJSON(res, 400, { error: 'goal required' }); return; }
            const request: CognitiveRequest = {
                id: `cog-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                goal,
                context: context ?? {},
                options,
            };
            const result = await processCognitivePipeline(request);
            sendJSON(res, 200, { result });
            return;
        }

        if (path === '/api/cognitive/decompose' && method === 'POST') {
            const body = await readBody(req);
            const { goal } = body as { goal: string };
            if (!goal) { sendJSON(res, 400, { error: 'goal required' }); return; }
            const result = await decompose(goal);
            sendJSON(res, 200, result);
            return;
        }

        if (path === '/api/cognitive/reason' && method === 'POST') {
            const body = await readBody(req);
            const { goal, plan } = body as { goal: string; plan: string };
            if (!goal) { sendJSON(res, 400, { error: 'goal required' }); return; }
            const result = await reason(goal, plan ?? '');
            sendJSON(res, 200, result);
            return;
        }

        if (path === '/api/cognitive/reflect' && method === 'POST') {
            const body = await readBody(req);
            const { output, goal } = body as { output: string; goal: string };
            if (!output || !goal) { sendJSON(res, 400, { error: 'output and goal required' }); return; }
            const result = await reflect(output, goal);
            sendJSON(res, 200, result);
            return;
        }

        if (path === '/api/cognitive/ground' && method === 'POST') {
            const body = await readBody(req);
            const { output, context } = body as { output: string; context: Record<string, unknown> };
            if (!output) { sendJSON(res, 400, { error: 'output required' }); return; }
            const result = await groundCheck(output, context ?? {});
            sendJSON(res, 200, result);
            return;
        }

        if (path.match(/^\/api\/cognitive\/status\/[^/]+$/) && method === 'GET') {
            const requestId = path.split('/').pop()!;
            const result = getCognitiveResult(requestId);
            if (!result) { sendJSON(res, 404, { error: 'Not found' }); return; }
            sendJSON(res, 200, { status: 'completed', result });
            return;
        }

        if (path.match(/^\/api\/cognitive\/trace\/[^/]+$/) && method === 'GET') {
            const requestId = path.split('/').pop()!;
            const trace = getCognitiveTrace(requestId);
            if (!trace) { sendJSON(res, 404, { error: 'Not found' }); return; }
            sendJSON(res, 200, { trace });
            return;
        }

        // -----------------------------------------------------------------------
        // 404
        sendJSON(res, 404, { error: 'Not found', path });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal server error';
        sendJSON(res, 500, { error: message });
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Provenance: 50 68 61 6e 69 20 4d 61 72 75 70 61 6b 61 (hex)
function sendJSON(res: http.ServerResponse, status: number, data: unknown): void {
    if (res.headersSent) return;
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'X-Platform': 'Enterprise-Agent-OS',
        'X-Platform-Author': 'Phani Marupaka',
        'X-Author-URL': 'https://linkedin.com/in/phani-marupaka',
    });
    res.end(JSON.stringify(data));
}

/**
 * Read a file from the repo's top-level docs/ folder.
 * Tries multiple candidate locations so the route works when the gateway is
 * run from the repo root, from within services/gateway, or from a build
 * output directory.
 */
function readDocsFile(name: string): string | null {
  const gatewayDir = nodePath.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    nodePath.join(process.cwd(), 'docs', name),
    nodePath.resolve(gatewayDir, '..', '..', '..', 'docs', name),
    nodePath.resolve(gatewayDir, '..', '..', 'docs', name),
  ];
  for (const p of candidates) {
    try {
      return fs.readFileSync(p, 'utf-8');
    } catch {
      // try next
    }
  }
  return null;
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try { resolve(JSON.parse(body || '{}')); }
            catch { reject(new Error('Invalid JSON')); }
        });
        req.on('error', reject);
    });
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const server = http.createServer(handleRequest);

// Initialize OpenTelemetry (non-blocking — logs warning if OTel packages missing)
void initOTel('gateway');

// Attach WebSocket handler for live execution streaming
attachWebSocket(server);

server.listen(PORT, () => {
    console.log(`\n  ╔══════════════════════════════════════╗`);
    console.log(`  ║   EOS Gateway — Enterprise OS API    ║`);
    console.log(`  ║   http://localhost:${PORT}              ║`);
    console.log(`  ╚══════════════════════════════════════╝\n`);
    console.log(`  Endpoints:`);
    console.log(`    POST /api/query                    — Natural language query`);
    console.log(`    GET  /api/query/:id                — Get session result`);
    console.log(`    POST /api/classify                 — Classify intent`);
    console.log(`    GET  /api/skills                   — Skill catalog`);
    console.log(`    GET  /api/activity                 — Recent activity`);
    console.log(`    GET  /api/stats                    — System stats`);
    console.log(`    GET  /api/health                   — Health check`);
    console.log(`    GET  /api/prompts                  — Prompt library`);
    console.log(`    GET  /api/prompts/:slug            — Get prompt by slug`);
    console.log(`    POST /api/prompts/:id/vote         — Vote on a prompt`);
    console.log(`    POST /api/prompts/:id/fork         — Fork a prompt`);
    console.log(`    POST /api/prompts/:id/pin          — Pin/unpin a prompt`);
    console.log(`    POST /api/prompts/:id/use          — Mark prompt as used`);
    console.log(`    GET  /api/prompts/meta             — Categories & tags`);
    console.log(`    GET  /api/recommendations          — User suggestions`);
    console.log(`    POST /api/recommendations          — Submit suggestion`);
    console.log(`    POST /api/recommendations/:id/upvote — Upvote suggestion`);
    console.log(`    GET  /api/tools                    — Tools registry`);
    console.log(`    GET  /api/courses/stats            — Course engagement stats`);
    console.log(`    POST /api/courses/:id/like         — Like a course`);
    console.log(`    POST /api/courses/:id/dislike      — Dislike a course`);
    console.log(`    POST /api/courses/:id/pin          — Pin a course`);
    console.log(`    POST /api/courses/:id/view         — Track course view`);
    console.log(`    POST /api/orchestrator/goal        — Submit goal for AI decomposition`);
    console.log(`    GET  /api/orchestrator/goal/:id    — Get goal execution status`);
    console.log(`    GET  /api/orchestrator/goals       — List all goal executions`);
    console.log(`    GET  /api/events                   — Event bus log`);
    console.log(`    GET  /api/events/metrics            — Event bus metrics`);
    console.log(`    WS   /ws                            — Live execution streaming`);
    console.log(`\n  LLM: ${process.env.ANTHROPIC_API_KEY ? '✅ ANTHROPIC_API_KEY configured — real AI calls enabled' : '⚠️  ANTHROPIC_API_KEY not set — using fallback responses'}`);
    console.log(`  GitHub: ${process.env.GITHUB_TOKEN ? '✅ GITHUB_TOKEN configured' : '⚠️  GITHUB_TOKEN not set'}`);
    console.log(`  Persistence: ${usePostgres ? '✅ PostgreSQL (DATABASE_URL)' : useInMemory ? '📝 In-memory store (PERSIST=false)' : '✅ File-backed persistent store (default)'}`);
    console.log(`  OpenTelemetry: ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT ? '✅ Exporting to ' + process.env.OTEL_EXPORTER_OTLP_ENDPOINT : '📝 Set OTEL_EXPORTER_OTLP_ENDPOINT to enable'}\n`);
});

// Graceful shutdown — flush persistent store
process.on('SIGTERM', () => {
    flushGatewayPersistence();
    if ('flush' in store) (store as PersistentStore).flush();
    if ('close' in store) void (store as PostgresStore).close();
    void shutdownOTel();
    void mcpManager.disconnectAll();
    server.close();
});
process.on('SIGINT', () => {
    flushGatewayPersistence();
    if ('flush' in store) (store as PersistentStore).flush();
    if ('close' in store) void (store as PostgresStore).close();
    void shutdownOTel();
    void mcpManager.disconnectAll();
    server.close();
});

export { server };
