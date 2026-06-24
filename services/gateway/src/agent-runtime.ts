/**
 * Agent Runtime — ReACT reasoning loop with state machine for agent execution.
 * Inspired by MiroFish's simulation runtime + ReACT pattern.
 * Supports persistent and ephemeral agents with 4-layer prompt assembly.
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import { randomUUID } from 'crypto';
import type { UTCPPacket, UTCPActor } from './utcp-protocol.js';
import type { A2AMessage, A2AAgent } from './a2a-protocol.js';
import type { MCPToolAction, MCPToolResponse } from './mcp-executor.js';

// ═══════════════════════════════════════════════════════════════
// Core Types
// ═══════════════════════════════════════════════════════════════

export type AgentState = 'idle' | 'thinking' | 'acting' | 'observing' | 'responding' | 'waiting_approval' | 'delegating' | 'terminated';

export type AgentType = 'persistent' | 'ephemeral';

export interface PromptLayers {
  /** Role, safety rules, tone, limits — universal across all agents */
  foundation: string;
  /** Domain expertise — engineering, marketing, product, etc. */
  function: string;
  /** Current workflow stage — what to focus on */
  stage: string;
  /** Specific user goal, context, artifacts */
  task: string;
}

export interface ReACTIteration {
  iteration: number;
  thought: string;
  action?: {
    type: 'tool_call' | 'a2a_message' | 'memory_lookup' | 'synthesize';
    tool_id?: string;
    params?: Record<string, unknown>;
    message?: Partial<A2AMessage>;
  };
  observation?: string;
  confidence: number;
  timestamp: string;
}

export interface AgentRuntime {
  // Identity
  runtime_id: string;
  agent_id: string;
  agent_name: string;
  regiment: string;
  rank: string;
  persona: string;
  type: AgentType;

  // State
  state: AgentState;
  task_ref?: string;               // Current UTCP task

  // Reasoning
  reasoning: {
    iterations: ReACTIteration[];
    current_iteration: number;
    max_iterations: number;
    total_confidence: number;
  };

  // Prompt Assembly
  prompt_layers: PromptLayers;

  // Capabilities
  tool_access: string[];            // Which MCP tools this agent can use
  memory_scope: string[];           // Which memory domains to access
  a2a_inbox: A2AMessage[];         // Pending messages from other agents
  delegation_rights: string[];      // Which agents can be delegated to

  // Telemetry
  metrics: {
    total_tokens: number;
    total_cost_usd: number;
    total_tool_calls: number;
    total_a2a_messages: number;
    total_executions: number;
    avg_confidence: number;
    success_rate: number;
  };

  // Lifecycle
  created_at: string;
  last_active_at: string;
  terminated_at?: string;
}

// ═══════════════════════════════════════════════════════════════
// Foundation Prompts
// ═══════════════════════════════════════════════════════════════

const FOUNDATION_PROMPT = `You are an AI agent operating within Enterprise AgentOS — a control plane for enterprise work.

CORE RULES:
1. You orchestrate work across tools — you do NOT execute work directly.
2. Every action you take must be traceable and auditable.
3. You MUST provide confidence scores (0-1) for every output.
4. When confidence < 0.7, you MUST escalate or request human review.
5. You NEVER fabricate data — if you don't have information, say so.
6. You respect privacy levels: public, internal, confidential, restricted.
7. You follow the chain of command: Colonel > Captain > Corporal > Sergeant.
8. You communicate with other agents via structured A2A messages.
9. You execute tool actions via MCP — never bypass the tool layer.
10. Every decision must include rationale and evidence.

OUTPUT FORMAT:
Always structure your responses as:
- THOUGHT: Your reasoning about the current step
- ACTION: What tool/agent to invoke (or SYNTHESIZE for final output)
- OBSERVATION: What you learned from the action result
- CONFIDENCE: 0-1 score for this step
`;

const FUNCTION_PROMPTS: Record<string, string> = {
  engineering: `You are an Engineering agent. Your domain expertise includes:
- Code architecture, design patterns, and best practices
- CI/CD pipelines, deployment strategies, and release management
- Incident management, root cause analysis, and post-mortems
- Code review, testing strategies, and quality assurance
- Technical documentation and knowledge management
Tools: GitHub, Jira, Confluence, Sentry, DataDog, CI/CD systems`,

  marketing: `You are a Marketing agent. Your domain expertise includes:
- Campaign strategy, planning, and execution
- Content creation, SEO, and brand management
- Performance analytics, attribution, and optimization
- Audience targeting, segmentation, and personalization
- Sales enablement and revenue operations
Tools: HubSpot, Google Analytics, LinkedIn Ads, Meta Ads, CMS`,

  product: `You are a Product agent. Your domain expertise includes:
- Product strategy, roadmap planning, and prioritization
- PRD creation, user stories, and acceptance criteria
- User research, competitive analysis, and market intelligence
- Feature adoption analysis and experimentation
- Cross-functional alignment and stakeholder management
Tools: Jira, Confluence, Analytics, Survey tools, Roadmap tools`,

  hr: `You are an HR agent. Your domain expertise includes:
- Employee lifecycle management and onboarding
- Policy interpretation and compliance
- Performance management and calibration
- Learning and development
- Employee relations and engagement
CRITICAL: Follow strict PII handling rules. Never act autonomously on sensitive cases.
Tools: HRIS, LMS, Survey tools, Calendar`,

  ta: `You are a Talent Acquisition agent. Your domain expertise includes:
- Job description creation and hiring scorecards
- Candidate sourcing, screening, and matching
- Interview coordination and panel design
- Feedback synthesis and debrief facilitation
- Offer management and negotiation support
Tools: ATS, LinkedIn, Calendar, Assessment tools`,

  program: `You are a Program Management agent. Your domain expertise includes:
- Initiative planning and execution governance
- Dependency management and risk assessment
- Stakeholder communication and status reporting
- Cross-functional coordination
- RAID log management and escalation
Tools: Jira, Confluence, Calendar, Roadmap tools`,
};

// ═══════════════════════════════════════════════════════════════
// Factory Functions
// ═══════════════════════════════════════════════════════════════

export function createAgentRuntime(params: {
  agent_id: string;
  agent_name: string;
  regiment: string;
  rank: string;
  persona: string;
  type: AgentType;
  tool_access: string[];
  function_domain: string;
}): AgentRuntime {
  const now = new Date().toISOString();
  return {
    runtime_id: `rt-${randomUUID().slice(0, 8)}`,
    agent_id: params.agent_id,
    agent_name: params.agent_name,
    regiment: params.regiment,
    rank: params.rank,
    persona: params.persona,
    type: params.type,
    state: 'idle',
    reasoning: {
      iterations: [],
      current_iteration: 0,
      max_iterations: 10,
      total_confidence: 0,
    },
    prompt_layers: {
      foundation: FOUNDATION_PROMPT,
      function: FUNCTION_PROMPTS[params.function_domain] || FUNCTION_PROMPTS.engineering,
      stage: '',
      task: '',
    },
    tool_access: params.tool_access,
    memory_scope: [params.persona, 'global'],
    a2a_inbox: [],
    delegation_rights: [],
    metrics: {
      total_tokens: 0,
      total_cost_usd: 0,
      total_tool_calls: 0,
      total_a2a_messages: 0,
      total_executions: 0,
      avg_confidence: 0,
      success_rate: 1,
    },
    created_at: now,
    last_active_at: now,
  };
}

export function createEphemeralAgent(params: {
  persona: string;
  function_domain: string;
  task_ref: string;
  tool_access: string[];
  stage_prompt: string;
  task_prompt: string;
}): AgentRuntime {
  const runtime = createAgentRuntime({
    agent_id: `eph-${randomUUID().slice(0, 8)}`,
    agent_name: `${params.persona} Specialist`,
    regiment: 'Ephemeral',
    rank: 'Specialist',
    persona: params.persona,
    type: 'ephemeral',
    tool_access: params.tool_access,
    function_domain: params.function_domain,
  });

  runtime.task_ref = params.task_ref;
  runtime.prompt_layers.stage = params.stage_prompt;
  runtime.prompt_layers.task = params.task_prompt;
  runtime.state = 'thinking';

  return runtime;
}

// ═══════════════════════════════════════════════════════════════
// ReACT Loop
// ═══════════════════════════════════════════════════════════════

export function addReACTIteration(runtime: AgentRuntime, iteration: Omit<ReACTIteration, 'iteration' | 'timestamp'>): AgentRuntime {
  const newIteration: ReACTIteration = {
    ...iteration,
    iteration: runtime.reasoning.current_iteration + 1,
    timestamp: new Date().toISOString(),
  };

  return {
    ...runtime,
    state: iteration.action ? 'acting' : iteration.observation ? 'observing' : 'thinking',
    reasoning: {
      ...runtime.reasoning,
      iterations: [...runtime.reasoning.iterations, newIteration],
      current_iteration: newIteration.iteration,
      total_confidence: iteration.confidence,
    },
    last_active_at: new Date().toISOString(),
  };
}

export function completeExecution(runtime: AgentRuntime, success: boolean): AgentRuntime {
  const now = new Date().toISOString();
  const newTotal = runtime.metrics.total_executions + 1;
  const newSuccess = success
    ? ((runtime.metrics.success_rate * runtime.metrics.total_executions) + 1) / newTotal
    : (runtime.metrics.success_rate * runtime.metrics.total_executions) / newTotal;

  return {
    ...runtime,
    state: runtime.type === 'ephemeral' ? 'terminated' : 'idle',
    task_ref: runtime.type === 'ephemeral' ? runtime.task_ref : undefined,
    reasoning: { ...runtime.reasoning, iterations: [], current_iteration: 0 },
    metrics: {
      ...runtime.metrics,
      total_executions: newTotal,
      success_rate: newSuccess,
    },
    last_active_at: now,
    terminated_at: runtime.type === 'ephemeral' ? now : undefined,
  };
}

export function assembleFullPrompt(runtime: AgentRuntime): string {
  return [
    runtime.prompt_layers.foundation,
    `\n--- DOMAIN ---\n${runtime.prompt_layers.function}`,
    runtime.prompt_layers.stage ? `\n--- STAGE ---\n${runtime.prompt_layers.stage}` : '',
    runtime.prompt_layers.task ? `\n--- TASK ---\n${runtime.prompt_layers.task}` : '',
    `\n--- AGENT IDENTITY ---\nName: ${runtime.agent_name}\nRegiment: ${runtime.regiment}\nRank: ${runtime.rank}\nPersona: ${runtime.persona}`,
    `\n--- TOOLS AVAILABLE ---\n${runtime.tool_access.join(', ')}`,
  ].filter(Boolean).join('\n');
}

// ═══════════════════════════════════════════════════════════════
// In-Memory Store
// ═══════════════════════════════════════════════════════════════

const runtimes = new Map<string, AgentRuntime>();

export function storeRuntime(rt: AgentRuntime): void { runtimes.set(rt.runtime_id, rt); }
export function getRuntime(id: string): AgentRuntime | undefined { return runtimes.get(id); }
export function getRuntimeByAgent(agentId: string): AgentRuntime | undefined {
  return Array.from(runtimes.values()).find(r => r.agent_id === agentId && r.state !== 'terminated');
}
export function getActiveRuntimes(): AgentRuntime[] {
  return Array.from(runtimes.values()).filter(r => r.state !== 'idle' && r.state !== 'terminated');
}
export function getAllRuntimes(): AgentRuntime[] {
  return Array.from(runtimes.values());
}
export function getEphemeralRuntimes(): AgentRuntime[] {
  return Array.from(runtimes.values()).filter(r => r.type === 'ephemeral');
}
export function terminateRuntime(runtimeId: string): void {
  const rt = runtimes.get(runtimeId);
  if (rt) {
    runtimes.set(runtimeId, { ...rt, state: 'terminated', terminated_at: new Date().toISOString() });
  }
}

// ═══════════════════════════════════════════════════════════════
// A2A Inbox — real agent-to-agent message delivery (Track C)
//
// Until now `a2a_inbox` was initialized empty and never read or written, so
// "agent-to-agent" was nominal. These functions make messages actually flow:
// the swarm manager delivers to inboxes and agents drain them when they reason.
// ═══════════════════════════════════════════════════════════════

/** Deliver an A2A message into a runtime's inbox. Returns false if no such runtime. */
export function deliverToInbox(runtimeId: string, msg: A2AMessage): boolean {
  const rt = runtimes.get(runtimeId);
  if (!rt) return false;
  rt.a2a_inbox.push(msg);
  rt.metrics.total_a2a_messages += 1;
  rt.last_active_at = new Date().toISOString();
  runtimes.set(runtimeId, rt);
  return true;
}

/** Deliver to an agent by agent_id (resolves its active runtime). */
export function deliverToAgent(agentId: string, msg: A2AMessage): boolean {
  const rt = getRuntimeByAgent(agentId);
  return rt ? deliverToInbox(rt.runtime_id, msg) : false;
}

/** Drain (read + clear) a runtime's inbox. */
export function drainInbox(runtimeId: string): A2AMessage[] {
  const rt = runtimes.get(runtimeId);
  if (!rt) return [];
  const msgs = rt.a2a_inbox;
  rt.a2a_inbox = [];
  runtimes.set(runtimeId, rt);
  return msgs;
}

/** Read a runtime's inbox without clearing it. */
export function peekInbox(runtimeId: string): A2AMessage[] {
  return runtimes.get(runtimeId)?.a2a_inbox ?? [];
}
