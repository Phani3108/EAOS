/**
 * Swarm Manager — Cross-functional agent team orchestration.
 * Dynamically spawns agent pods for missions like product launches,
 * incident response, hiring sprints, and campaign execution.
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import { randomUUID } from 'crypto';
import {
  createSwarm, storeSwarm, getSwarm, getActiveSwarms, getRecentSwarms,
  createMeeting, storeMeeting, createA2AMessage, storeMessage,
  type AgentSwarm, type A2AAgent, type AgentMeeting, type MeetingEntry,
} from './a2a-protocol.js';
import { createUTCPPacket, storePacket, type UTCPPacket } from './utcp-protocol.js';
import { createEphemeralAgent, storeRuntime, drainInbox, deliverToAgent, type AgentRuntime } from './agent-runtime.js';
import { callLLM, hasAnyLLMKey } from './llm-provider.js';
import { renderOrchestratorPrompt } from './prompts/orchestrator-prompt.js';

// ═══════════════════════════════════════════════════════════════
// Swarm Templates
// ═══════════════════════════════════════════════════════════════

export interface SwarmTemplate {
  type: AgentSwarm['type'];
  name: string;
  description: string;
  requiredFunctions: string[];
  agentRoles: { persona: string; role: string; rank: string }[];
  defaultTools: string[];
  phases: { name: string; description: string; agents: string[] }[];
}

export const SWARM_TEMPLATES: SwarmTemplate[] = [
  {
    type: 'product_launch',
    name: 'Product Launch Pod',
    description: 'End-to-end product launch coordination across Product, Engineering, Marketing, and Program.',
    requiredFunctions: ['product', 'engineering', 'marketing', 'program'],
    agentRoles: [
      { persona: 'Product', role: 'PRD Lead', rank: 'Captain' },
      { persona: 'Engineering', role: 'Tech Lead', rank: 'Captain' },
      { persona: 'Marketing', role: 'Campaign Lead', rank: 'Captain' },
      { persona: 'Program', role: 'Launch Coordinator', rank: 'Colonel' },
    ],
    defaultTools: ['jira', 'confluence', 'github', 'hubspot', 'slack'],
    phases: [
      { name: 'Planning', description: 'PRD finalization, scope confirmation, timeline', agents: ['Product', 'Engineering'] },
      { name: 'Build', description: 'Development, testing, staging', agents: ['Engineering'] },
      { name: 'GTM Prep', description: 'Campaign creation, enablement, docs', agents: ['Marketing', 'Product'] },
      { name: 'Launch', description: 'Deployment, announcement, monitoring', agents: ['Engineering', 'Marketing', 'Program'] },
      { name: 'Review', description: 'Adoption metrics, retrospective', agents: ['Product', 'Marketing', 'Program'] },
    ],
  },
  {
    type: 'incident_response',
    name: 'Incident Response Swarm',
    description: 'Rapid cross-functional response to a production incident.',
    requiredFunctions: ['engineering', 'program', 'support'],
    agentRoles: [
      { persona: 'Engineering', role: 'Incident Commander', rank: 'Colonel' },
      { persona: 'Engineering', role: 'Root Cause Analyst', rank: 'Captain' },
      { persona: 'Program', role: 'Comms Lead', rank: 'Captain' },
      { persona: 'Engineering', role: 'Remediation Engineer', rank: 'Corporal' },
    ],
    defaultTools: ['github', 'jira', 'slack', 'datadog'],
    phases: [
      { name: 'Triage', description: 'Assess severity, impact, blast radius', agents: ['Engineering'] },
      { name: 'Investigate', description: 'Log analysis, dependency mapping, hypothesis generation', agents: ['Engineering'] },
      { name: 'Remediate', description: 'Implement fix, deploy, verify', agents: ['Engineering'] },
      { name: 'Communicate', description: 'Stakeholder updates, customer communication', agents: ['Program'] },
      { name: 'RCA', description: 'Root cause analysis, preventive actions', agents: ['Engineering', 'Program'] },
    ],
  },
  {
    type: 'hiring_sprint',
    name: 'Hiring Sprint Pod',
    description: 'Accelerated hiring workflow from requisition to offer.',
    requiredFunctions: ['hr', 'engineering', 'product'],
    agentRoles: [
      { persona: 'HR', role: 'Recruiting Lead', rank: 'Captain' },
      { persona: 'HR', role: 'Sourcing Specialist', rank: 'Corporal' },
      { persona: 'Engineering', role: 'Technical Interviewer', rank: 'Captain' },
      { persona: 'Product', role: 'Hiring Manager', rank: 'Captain' },
    ],
    defaultTools: ['linkedin_ads', 'slack', 'google_drive', 'confluence'],
    phases: [
      { name: 'Requisition', description: 'JD creation, scorecard, channel strategy', agents: ['HR'] },
      { name: 'Source & Screen', description: 'Candidate pipeline, resume scoring', agents: ['HR'] },
      { name: 'Interview', description: 'Panel design, scheduling, feedback synthesis', agents: ['HR', 'Engineering', 'Product'] },
      { name: 'Decide', description: 'Debrief, candidate comparison, recommendation', agents: ['HR', 'Engineering', 'Product'] },
      { name: 'Offer', description: 'Offer preparation, negotiation support', agents: ['HR'] },
    ],
  },
  {
    type: 'campaign_pod',
    name: 'Campaign Execution Pod',
    description: 'Full-cycle campaign from strategy to analytics.',
    requiredFunctions: ['marketing', 'product', 'design'],
    agentRoles: [
      { persona: 'Marketing', role: 'Strategist', rank: 'Colonel' },
      { persona: 'Marketing', role: 'Content Lead', rank: 'Captain' },
      { persona: 'Marketing', role: 'Performance Analyst', rank: 'Corporal' },
      { persona: 'Product', role: 'Product Marketer', rank: 'Captain' },
    ],
    defaultTools: ['hubspot', 'google_analytics', 'linkedin_ads', 'canva', 'figma'],
    phases: [
      { name: 'Strategy', description: 'Objective, audience, positioning, channel mix', agents: ['Marketing'] },
      { name: 'Content', description: 'Copy, creative, landing pages, emails', agents: ['Marketing'] },
      { name: 'Launch', description: 'Campaign activation, ad deployment', agents: ['Marketing'] },
      { name: 'Optimize', description: 'Performance monitoring, A/B testing', agents: ['Marketing'] },
      { name: 'Report', description: 'ROI analysis, insights, next steps', agents: ['Marketing', 'Product'] },
    ],
  },
  {
    type: 'custom',
    name: 'Custom Swarm',
    description: 'Build a custom agent team for any cross-functional mission.',
    requiredFunctions: [],
    agentRoles: [],
    defaultTools: [],
    phases: [
      { name: 'Setup', description: 'Define mission, assign agents', agents: [] },
      { name: 'Execute', description: 'Run the mission', agents: [] },
      { name: 'Review', description: 'Assess outcomes', agents: [] },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════
// Swarm Lifecycle
// ═══════════════════════════════════════════════════════════════

export interface SwarmLaunchResult {
  swarm: AgentSwarm;
  utcpPacket: UTCPPacket;
  runtimes: AgentRuntime[];
  kickoffMeeting: AgentMeeting;
}

/** Launch a swarm from a template with a mission objective */
export function launchSwarm(params: {
  templateType: AgentSwarm['type'];
  mission: string;
  customAgents?: A2AAgent[];
  userId?: string;
}): SwarmLaunchResult {
  const template = SWARM_TEMPLATES.find(t => t.type === params.templateType) || SWARM_TEMPLATES[4]; // fallback to custom

  // Build agent list from template roles
  const agents: A2AAgent[] = params.customAgents || template.agentRoles.map((role, i) => ({
    agent_id: `swarm-agent-${randomUUID().slice(0, 6)}`,
    name: `${role.rank} ${role.role}`,
    regiment: role.persona,
    rank: role.rank,
    persona: role.persona,
  }));

  // Create UTCP packet for the mission
  const utcpPacket = createUTCPPacket({
    function: 'cross-functional' as any,
    stage: 'swarm-formation',
    intent: params.mission,
    initiator: { user_id: params.userId || 'system', role: 'operator' },
    objectives: [params.mission],
    tool_scopes: template.defaultTools,
    urgency: params.templateType === 'incident_response' ? 'critical' : 'medium',
  });
  storePacket(utcpPacket);

  // Create the swarm
  const swarm = createSwarm({
    mission: params.mission,
    task_ref: utcpPacket.task_id,
    type: params.templateType,
    agents,
  });
  swarm.status = 'active';
  storeSwarm(swarm);

  // Spawn ephemeral agent runtimes
  const runtimes: AgentRuntime[] = agents.map(agent => {
    const rt = createEphemeralAgent({
      persona: agent.persona.toLowerCase(),
      function_domain: agent.persona.toLowerCase(),
      task_ref: utcpPacket.task_id,
      tool_access: template.defaultTools,
      stage_prompt: `You are participating in a ${template.name}. Your role: ${agent.rank} ${agent.name}.`,
      task_prompt: `Mission: ${params.mission}. Collaborate with other agents via A2A protocol.`,
    });
    // Link the runtime to the swarm agent so A2A messages addressed to the agent_id
    // are delivered to this runtime's inbox (deliverToAgent → getRuntimeByAgent).
    rt.agent_id = agent.agent_id;
    rt.agent_name = agent.name;
    storeRuntime(rt);
    return rt;
  });

  // Create kickoff meeting
  const kickoffMeeting = createMeeting({
    type: params.templateType === 'incident_response' ? 'war_room' : 'sprint_planning',
    title: `${template.name} Kickoff: ${params.mission.slice(0, 60)}`,
    participants: agents,
    agenda: [
      `Mission brief: ${params.mission}`,
      'Role assignments and responsibilities',
      `Phase overview: ${template.phases.map(p => p.name).join(' → ')}`,
      'Tool access confirmation',
      'Timeline and milestones',
    ],
    task_ref: utcpPacket.task_id,
  });
  kickoffMeeting.status = 'in_progress';
  kickoffMeeting.started_at = new Date().toISOString();

  // Simulate kickoff discussion
  const now = Date.now();
  agents.forEach((agent, i) => {
    kickoffMeeting.discussion.push({
      speaker: agent.name,
      agent_id: agent.agent_id,
      message: `${agent.rank} ${agent.name} reporting for duty. Ready to execute ${agent.persona} responsibilities for this mission.`,
      type: 'update',
      timestamp: new Date(now + i * 10000).toISOString(),
    });
  });

  // Leader announces plan
  const leader = agents[0];
  kickoffMeeting.discussion.push({
    speaker: leader.name,
    agent_id: leader.agent_id,
    message: `Mission plan: ${template.phases.map((p, i) => `Phase ${i + 1}: ${p.name}`).join(' → ')}. Let's execute.`,
    type: 'decision',
    timestamp: new Date(now + agents.length * 10000).toISOString(),
  });

  kickoffMeeting.decisions.push({
    topic: 'Mission activation',
    outcome: `${template.name} activated with ${agents.length} agents`,
    votes: Object.fromEntries(agents.map(a => [a.agent_id, 'agree' as const])),
    confidence: 0.95,
    rationale: 'All agents confirmed readiness',
  });

  kickoffMeeting.status = 'completed';
  kickoffMeeting.completed_at = new Date(now + (agents.length + 1) * 10000).toISOString();
  storeMeeting(kickoffMeeting);

  // Send initial A2A messages between agents
  if (agents.length >= 2) {
    const initMsg = createA2AMessage({
      type: 'delegate',
      sender: agents[0],
      receiver: agents[1],
      task_ref: utcpPacket.task_id,
      payload: {
        objective: `Phase 1: ${template.phases[0]?.name || 'Setup'}`,
        context: { mission: params.mission, phase: 0 },
      },
      priority: params.templateType === 'incident_response' ? 'critical' : 'high',
    });
    storeMessage(initMsg);
    deliverToAgent(agents[1].agent_id, initMsg); // real A2A delivery into the inbox
    swarm.messages.push(initMsg);
  }

  // Update swarm with meeting reference
  swarm.meetings.push(kickoffMeeting);
  storeSwarm(swarm);

  // Real collaborative kickoff when an LLM key is present — replaces the scripted
  // baseline above with genuine agent-to-agent contributions exchanged via the A2A
  // inbox. Fire-and-forget: the synchronous return preserves the existing contract,
  // and the stored meeting/swarm are upgraded in place once the discussion completes.
  if (hasAnyLLMKey() && agents.length > 0) {
    void runSwarmDiscussion(swarm, agents, runtimes, params.mission, template, kickoffMeeting)
      .catch(err => console.warn('[swarm] real discussion failed:', err));
  }

  return { swarm, utcpPacket, runtimes, kickoffMeeting };
}

/**
 * Real collaborative swarm kickoff. The leader delegates the mission into each agent's
 * A2A inbox; each agent then drains its inbox, contributes via an LLM call (using the
 * adopted deer-flow lead-agent prompt and seeing the discussion so far), and posts a
 * response back through the inbox. The meeting's discussion + decision are derived from
 * the real contributions — replacing the scripted baseline. A bounded sequential round
 * (one agent at a time) keeps each agent's context aware of prior speakers, mirroring
 * deer-flow's coordinated subagent fan-out. Degrades to the scripted baseline when no
 * LLM key is configured (this function is only invoked when one is).
 */
async function runSwarmDiscussion(
  swarm: AgentSwarm,
  agents: A2AAgent[],
  agentRuntimes: AgentRuntime[],
  mission: string,
  template: SwarmTemplate,
  meeting: AgentMeeting,
): Promise<void> {
  const leader = agents[0];

  // Leader delegates the mission to every other agent's inbox (real A2A).
  for (let i = 1; i < agents.length; i++) {
    const msg = createA2AMessage({
      type: 'delegate', sender: leader, receiver: agents[i], task_ref: swarm.task_ref,
      payload: { objective: mission, context: { phase: 0, role: agents[i].name } },
      priority: template.type === 'incident_response' ? 'critical' : 'high',
    });
    storeMessage(msg);
    deliverToAgent(agents[i].agent_id, msg);
    swarm.messages.push(msg);
  }

  const discussion: MeetingEntry[] = [];
  for (const agent of agents) {
    const rt = agentRuntimes.find(r => r.agent_id === agent.agent_id);
    const inbox = rt ? drainInbox(rt.runtime_id) : [];
    const prior = discussion.map(d => `${d.speaker}: ${d.message}`).join('\n');

    const systemPrompt = `${renderOrchestratorPrompt({ agent_name: agent.name })}

You are ${agent.rank} ${agent.name}, the ${agent.persona} member of a ${template.name}. Collaborate with the other agents — be specific and build on what they have said.`;
    const userPrompt = `Mission: ${mission}

Your A2A inbox (${inbox.length} message(s)):
${inbox.map(m => `- ${m.type}: ${JSON.stringify(m.payload)}`).join('\n') || '(empty)'}

Discussion so far:
${prior || '(you are opening the discussion)'}

Give your kickoff contribution in 2-3 sentences: what you will own and your first concrete action. End with exactly one line: "READINESS: READY" or "READINESS: BLOCKED - <reason>".`;

    try {
      const res = await callLLM({ systemPrompt, userPrompt, maxTokens: 400, temperature: 0.4 });
      const text = res.content.trim();
      discussion.push({ speaker: agent.name, agent_id: agent.agent_id, message: text, type: 'update', timestamp: new Date().toISOString() });

      // Round-trip: post the contribution back to the leader's inbox (real A2A).
      if (agent.agent_id !== leader.agent_id) {
        const back = createA2AMessage({
          type: 'query', sender: agent, receiver: leader, task_ref: swarm.task_ref,
          payload: { objective: 'kickoff-response', context: { summary: text.slice(0, 500) } },
          priority: 'medium',
        });
        storeMessage(back);
        deliverToAgent(leader.agent_id, back);
        swarm.messages.push(back);
      }
    } catch (err) {
      discussion.push({ speaker: agent.name, agent_id: agent.agent_id, message: `(could not contribute: ${(err as Error).message})`, type: 'blocker', timestamp: new Date().toISOString() });
    }
  }

  // Bidirectional round-trip: now that every member has posted a response back to the
  // leader's inbox, the leader DRAINS its inbox and synthesizes a final decision that
  // actually incorporates those member messages. Without this pass the member→leader
  // responses are stored + counted but never read, leaving the "discussion" one-way.
  const leaderRt = agentRuntimes.find(r => r.agent_id === leader.agent_id);
  const leaderInbox = leaderRt ? drainInbox(leaderRt.runtime_id) : [];
  const memberResponses = leaderInbox.filter(
    m => (m.payload as { objective?: string })?.objective === 'kickoff-response',
  );

  if (discussion.length > 0) {
    const isReady = (m: string) => /READINESS:\s*READY/i.test(m);
    const ready = discussion.filter(d => isReady(d.message)).length;
    meeting.discussion = discussion;

    // Leader reads the drained member responses and produces a synthesis. Prefer a real
    // LLM synthesis over the member contributions it just received; degrade gracefully to
    // a deterministic roll-up if the call fails so the round-trip is always reflected.
    let synthesis = '';
    const responseSummaries = memberResponses
      .map(m => (m.payload as { context?: { summary?: string } })?.context?.summary)
      .filter((s): s is string => typeof s === 'string' && s.length > 0);

    if (responseSummaries.length > 0) {
      const synthSystem = `${renderOrchestratorPrompt({ agent_name: leader.name })}

You are ${leader.rank} ${leader.name}, leading a ${template.name}. Your team members have each replied to your kickoff delegation. Synthesize their responses into a single decision.`;
      const synthUser = `Mission: ${mission}

Member responses received in your A2A inbox (${responseSummaries.length}):
${responseSummaries.map((s, i) => `${i + 1}. ${s}`).join('\n')}

In 2-3 sentences, synthesize these into the team's plan and confirm whether the swarm is GO or NO-GO.`;
      try {
        const synthRes = await callLLM({ systemPrompt: synthSystem, userPrompt: synthUser, maxTokens: 400, temperature: 0.4 });
        synthesis = synthRes.content.trim();
      } catch (err) {
        synthesis = `Synthesis from ${responseSummaries.length} member response(s); ${ready}/${discussion.length} READY. (LLM synthesis unavailable: ${(err as Error).message})`;
      }

      // Record the leader's synthesis as the closing entry in the discussion so the
      // bidirectional exchange is visible in the meeting transcript.
      discussion.push({
        speaker: leader.name,
        agent_id: leader.agent_id,
        message: `Leader synthesis (from ${responseSummaries.length} member response(s)): ${synthesis}`,
        type: 'decision',
        timestamp: new Date().toISOString(),
      });
      meeting.discussion = discussion;
    }

    meeting.decisions = [{
      topic: 'Mission activation',
      outcome: `${template.name}: ${ready}/${discussion.length} agents READY`,
      votes: Object.fromEntries(discussion.map(d => [d.agent_id, isReady(d.message) ? 'agree' : 'abstain'])) as Record<string, 'agree' | 'disagree' | 'abstain'>,
      confidence: discussion.length ? ready / discussion.length : 0,
      rationale: synthesis
        ? `Leader synthesis over ${memberResponses.length} drained A2A member response(s): ${synthesis}`
        : 'Derived from real agent kickoff contributions (LLM-driven A2A discussion).',
    }];
    meeting.completed_at = new Date().toISOString();
    storeMeeting(meeting);
    storeSwarm(swarm);
  }
}

/** Advance a swarm to the next phase */
export function advanceSwarmPhase(swarmId: string): AgentSwarm | undefined {
  const swarm = getSwarm(swarmId);
  if (!swarm) return undefined;

  const template = SWARM_TEMPLATES.find(t => t.type === swarm.type);
  if (!template) return undefined;

  // Determine current phase from artifacts count
  const currentPhase = Math.min(swarm.artifacts.length, template.phases.length - 1);
  const nextPhase = template.phases[currentPhase];

  if (nextPhase) {
    swarm.artifacts.push({
      type: 'phase_completion',
      title: `Phase ${currentPhase + 1}: ${nextPhase.name}`,
      content: `Phase completed. Moving to: ${nextPhase.description}`,
      author: swarm.agents[0]?.name || 'System',
      created_at: new Date().toISOString(),
    });
  }

  // If all phases complete, dissolve
  if (currentPhase >= template.phases.length - 1) {
    swarm.status = 'completed';
    swarm.completed_at = new Date().toISOString();
  }

  storeSwarm(swarm);
  return swarm;
}

/** Dissolve a swarm */
export function dissolveSwarm(swarmId: string): AgentSwarm | undefined {
  const swarm = getSwarm(swarmId);
  if (!swarm) return undefined;

  swarm.status = 'dissolved' as any;
  swarm.completed_at = new Date().toISOString();
  storeSwarm(swarm);
  return swarm;
}

// ═══════════════════════════════════════════════════════════════
// Query Functions
// ═══════════════════════════════════════════════════════════════

export function getSwarmTemplates(): SwarmTemplate[] {
  return SWARM_TEMPLATES;
}

export function getSwarmTemplate(type: string): SwarmTemplate | undefined {
  return SWARM_TEMPLATES.find(t => t.type === type);
}

export function getSwarmStats(): {
  active: number;
  completed: number;
  totalAgents: number;
  totalMessages: number;
} {
  const all = getRecentSwarms(100);
  return {
    active: all.filter(s => s.status === 'active').length,
    completed: all.filter(s => s.status === 'completed').length,
    totalAgents: all.reduce((sum, s) => sum + s.agents.length, 0),
    totalMessages: all.reduce((sum, s) => sum + s.messages.length, 0),
  };
}
