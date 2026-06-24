/**
 * ProductHub — AI Product Management Assistant inside AgentOS
 * Consolidated: Skills (execution + agent browse) → Outputs → Programs → Memory.
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */
'use client';

import { useState, useEffect, useRef } from 'react';
import { notify } from '../lib/notify';
import { useProductStore, type PersonaExecutionStep } from '../store/persona-store';
import { useConnectionsStore } from '../store/connections-store';
import { useEAOSStore } from '../store/eaos-store';
import { ExecutionTimeline } from './marketing/ExecutionTimeline';
import { PersonaWorkflowForm, type SkillInputField, type SkillToolRef } from './persona/PersonaWorkflowForm';
import { UnifiedPersonaLayout } from './persona/UnifiedPersonaLayout';
import { OutputsView, type OutputExecution } from './persona/OutputsView';
import { PromptLibrary } from './PromptLibraryDeep';
import AgentsPanel from './AgentsPanel';
import { PipelineView } from './PipelineView';
import DemoPreviewBanner from './shared/DemoPreviewBanner';
import type { ExecutionStepEvent } from '../store/marketing-store';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000';
const POLL_INTERVAL_MS = 2000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillStep {
  id: string;
  order: number;
  name: string;
  agent: string;
  tool?: string;
  outputKey: string;
  requiresApproval?: boolean;
}

interface SkillDef {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  cluster: string;
  complexity: 'simple' | 'moderate' | 'complex';
  estimatedTime: string;
  inputs: SkillInputField[];
  steps: SkillStep[];
  outputs: string[];
  requiredTools: string[];
  optionalTools: string[];
  tags: string[];
}

// Tool connection state reads from central connections store
const PROD_TOOL_DEFS: { id: string; name: string; icon: string; connectorId: string }[] = [
  { id: 'claude',     name: 'Claude',      icon: '🤖', connectorId: 'anthropic'     },
  { id: 'jira',       name: 'Jira',        icon: '🟦', connectorId: 'jira'          },
  { id: 'confluence', name: 'Confluence',  icon: '📘', connectorId: 'confluence'    },
  { id: 'notion',     name: 'Notion',      icon: '⬜', connectorId: 'notion'        },
  { id: 'perplexity', name: 'Perplexity',  icon: '🔍', connectorId: 'perplexity'    },
  { id: 'gdrive',     name: 'Google Drive', icon: '📁', connectorId: 'google-drive'  },
  { id: 'slack',      name: 'Slack',       icon: '💬', connectorId: 'slack'         },
];

function useProdToolStatus(): Record<string, SkillToolRef> {
  const isToolConnected = useConnectionsStore(s => s.isToolConnected);
  const result: Record<string, SkillToolRef> = {};
  for (const tool of PROD_TOOL_DEFS) {
    result[tool.id] = { id: tool.id, name: tool.name, icon: tool.icon, connected: isToolConnected(tool.connectorId) };
  }
  return result;
}

function buildToolStrip(skill: SkillDef, toolStatus: Record<string, SkillToolRef>): SkillToolRef[] {
  const ids = [...skill.requiredTools, ...skill.optionalTools];
  return ids.map((id) => toolStatus[id] ?? { id, name: id, icon: '🔧', connected: false });
}

// ---------------------------------------------------------------------------
// Command Center
// ---------------------------------------------------------------------------

function ProductCommandCenter({ initialSkillSlug }: { initialSkillSlug?: string | null }) {
  const [skills, setSkills] = useState<SkillDef[]>([]);
  const [clusters, setClusters] = useState<Record<string, SkillDef[]>>({});
  const [selectedSkill, setSelectedSkill] = useState<SkillDef | null>(null);
  const [executing, setExecuting] = useState(false);
  const toolStatus = useProdToolStatus();
  const mainSetActiveSection = useEAOSStore(s => s.setActiveSection);
  const connectedCount = PROD_TOOL_DEFS.filter(t => useConnectionsStore.getState().isToolConnected(t.connectorId)).length;

  const activeExecution = useProductStore((s) => s.activeExecution);
  const addExecution = useProductStore((s) => s.addExecution);
  const updateExecution = useProductStore((s) => s.updateExecution);
  const updateExecutionStep = useProductStore((s) => s.updateExecutionStep);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch(`${GATEWAY_URL}/api/product/skills`)
      .then((r) => r.json())
      .then((data) => {
        if (data.skills) setSkills(data.skills);
        if (data.clusters) setClusters(data.clusters);
      })
      .catch(() => {});
  }, []);

  // Auto-select skill when triggered from agent browser Run button
  useEffect(() => {
    if (initialSkillSlug && skills.length > 0) {
      const match = skills.find((s) => s.slug === initialSkillSlug || s.id === initialSkillSlug);
      if (match) setSelectedSkill(match);
    }
  }, [initialSkillSlug, skills]);

  // Poll active execution
  useEffect(() => {
    if (!activeExecution || ['completed', 'failed'].includes(activeExecution.status)) {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
      return;
    }
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${GATEWAY_URL}/api/product/executions/${activeExecution.id}`);
        if (!res.ok) return;
        const { execution } = await res.json();
        if (!execution) return;
        updateExecution(activeExecution.id, { status: execution.status, completedAt: execution.completedAt, outputs: execution.outputs ?? {} });
        for (const step of execution.steps ?? []) {
          updateExecutionStep(activeExecution.id, step.stepId, { status: step.status, startedAt: step.startedAt, completedAt: step.completedAt, outputPreview: step.outputPreview, error: step.error, agentCallSign: step.agentCallSign, agentRank: step.agentRank, qualityScore: step.qualityScore, latencyMs: step.latencyMs });
        }
        if (['completed', 'failed'].includes(execution.status)) {
          if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
        }
      } catch { /* ignore */ }
    }, POLL_INTERVAL_MS);
    return () => { if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; } };
  }, [activeExecution?.id, activeExecution?.status]);

  const handleExecute = async (inputs: Record<string, string>, simulate: boolean, customPrompt?: string, modelId?: string, provider?: string) => {
    if (!selectedSkill) return;
    setExecuting(true);
    try {
      const res = await fetch(`${GATEWAY_URL}/api/product/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillId: selectedSkill.id, inputs, simulate, customPrompt, provider, modelId }),
      });
      if (!res.ok) throw new Error('Execution failed');
      const { execution } = await res.json();
      const stepEvents = (execution.steps ?? []).map((s: { stepId: string; stepName: string; agent: string; tool?: string; status: string; outputKey?: string }) => ({
        id: `evt-${s.stepId}`,
        stepId: s.stepId,
        stepName: s.stepName,
        agent: s.agent,
        tool: s.tool,
        status: s.status as PersonaExecutionStep['status'],
        outputKey: s.outputKey,
      }));
      addExecution({ id: execution.id, persona: 'product', skillId: execution.skillId, skillName: execution.skillName, status: execution.status ?? 'queued', steps: stepEvents, outputs: execution.outputs ?? {}, startedAt: execution.startedAt });
      setSelectedSkill(null);
    } catch (err) {
      notify('error', 'Execution failed', err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setExecuting(false);
    }
  };

  const timelineSteps: ExecutionStepEvent[] = (activeExecution?.steps ?? []).map((s) => ({
    id: `evt-${s.stepId}`,
    stepId: s.stepId,
    stepName: s.stepName,
    agent: s.agent,
    agentCallSign: s.agentCallSign,
    agentRank: s.agentRank,
    tool: s.tool,
    status: s.status,
    startedAt: s.startedAt,
    completedAt: s.completedAt,
    outputKey: s.outputKey,
    outputPreview: s.outputPreview,
    error: s.error,
    qualityScore: s.qualityScore,
    latencyMs: s.latencyMs,
  }));

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      {/* Hero header — product-specific */}
      <div className="rounded-xl bg-gradient-to-r from-violet-700 to-violet-900 text-white p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Product Command Center</h2>
            <p className="text-sm text-violet-200 mt-0.5">AI-powered PRDs, epics, user stories, roadmaps & stakeholder reports.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-[11px] text-violet-300 uppercase tracking-wider">Tools Connected</p>
              <p className="text-lg font-bold">{connectedCount}/{PROD_TOOL_DEFS.length}</p>
            </div>
            <button
              onClick={() => mainSetActiveSection('conn-devtools')}
              className="px-3 py-2 text-xs font-semibold rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
            >
              Manage →
            </button>
          </div>
        </div>
        {connectedCount === 0 && (
          <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center gap-3">
            <svg className="w-4 h-4 text-amber-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01" /></svg>
            <p className="text-[13px] text-amber-200">No tools connected. Skills will run in simulation mode. <button onClick={() => mainSetActiveSection('conn-devtools')} className="underline text-amber-100 hover:text-white">Connect tools</button></p>
          </div>
        )}
      </div>

      {/* Active execution */}
      {activeExecution && !selectedSkill && (
        <ExecutionTimeline
          steps={timelineSteps}
          workflowName={activeExecution.skillName}
          status={activeExecution.status}
          outputs={activeExecution.outputs}
        />
      )}

      {/* Skill selector */}
      {!selectedSkill ? (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-slate-700">{skills.length} Product Skills</h3>
          <div className="grid gap-4">
            {Object.entries(clusters).map(([cluster, clusterSkills]) => (
              <div key={cluster} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm font-bold text-slate-800 mb-3">{cluster}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {clusterSkills.map((skill) => (
                    <button
                      key={skill.id}
                      onClick={() => setSelectedSkill(skill)}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-200 bg-violet-50 hover:border-violet-400 hover:bg-white text-left transition-all"
                    >
                      <span>{skill.icon}</span>
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-slate-800 truncate">{skill.name}</p>
                        <p className="text-[11px] text-slate-400">{skill.estimatedTime}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <span className="text-xl">{selectedSkill.icon}</span>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{selectedSkill.name}</h3>
                  <p className="text-[11px] text-slate-500">{selectedSkill.description}</p>
                </div>
              </div>
              <button onClick={() => setSelectedSkill(null)} className="text-xs text-slate-400 hover:text-slate-600">← Back</button>
            </div>
            <PersonaWorkflowForm
              fields={selectedSkill.inputs}
              tools={buildToolStrip(selectedSkill, toolStatus)}
              accentClass="bg-violet-700"
              accentHoverClass="hover:bg-violet-800"
              persona="product"
              onExecute={handleExecute}
              onCancel={() => setSelectedSkill(null)}
              executing={executing}
            />
          </div>
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h4 className="text-xs font-bold text-slate-700 mb-3 uppercase tracking-wide">Skill Steps</h4>
              <ol className="space-y-2">
                {selectedSkill.steps.map((step, i) => (
                  <li key={step.id} className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-violet-100 text-violet-600 text-[11px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                    <div>
                      <p className="text-xs font-semibold text-slate-800">{step.name}</p>
                      <p className="text-[11px] text-slate-400">{step.agent} Agent{step.tool ? ` · ${step.tool}` : ''}</p>
                      {step.requiresApproval && (
                        <span className="text-[11px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">Approval required</span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              <div className="mt-4 pt-3 border-t border-slate-100 space-y-1">
                <p className="text-[11px] text-slate-500"><span className="font-semibold">Complexity:</span> {selectedSkill.complexity}</p>
                <p className="text-[11px] text-slate-500"><span className="font-semibold">Est. time:</span> {selectedSkill.estimatedTime}</p>
                <p className="text-[11px] text-slate-500"><span className="font-semibold">Required:</span> {selectedSkill.requiredTools.join(', ')}</p>
                {selectedSkill.optionalTools.length > 0 && (
                  <p className="text-[11px] text-slate-500"><span className="font-semibold">Optional:</span> {selectedSkill.optionalTools.join(', ')}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent type definitions
// ---------------------------------------------------------------------------

interface AgentSubSkill {
  id: string;
  name: string;
  description: string;
  promptId: string;
  outputs: string[];
  tools: string[];
  skillSlug?: string;
}

interface AgentDef {
  id: string;
  name: string;
  icon: string;
  role: string;
  tools: string[];
  color: string;
  subSkills: AgentSubSkill[];
}

const PROD_AGENTS: AgentDef[] = [
  {
    id: 'strategy', name: 'Product Strategy Agent', icon: '🎯', role: 'Product vision, positioning, market fit analysis',
    tools: ['Claude', 'Notion', 'Perplexity'], color: 'from-violet-50 to-purple-50 border-violet-200',
    subSkills: [
      { id: 'str-vision', name: 'Vision Statement', description: 'Generate product vision and mission statements', promptId: 'strategy-vision', outputs: ['Vision Doc', 'Mission Statement', 'Strategic Pillars'], tools: ['Claude'] },
      { id: 'str-positioning', name: 'Market Positioning', description: 'Analyze market and define product positioning', promptId: 'strategy-positioning', outputs: ['Positioning Matrix', 'Value Prop', 'Differentiation Map'], tools: ['Claude', 'Perplexity'] },
      { id: 'str-pmf', name: 'Product-Market Fit', description: 'Assess product-market fit with data-driven signals', promptId: 'strategy-pmf', outputs: ['PMF Score', 'Signal Analysis', 'Recommendations'], tools: ['Claude', 'Notion'] },
    ],
  },
  {
    id: 'research', name: 'User Research Agent', icon: '🔬', role: 'Research planning, interview synthesis, insights',
    tools: ['Claude', 'Notion', 'Google Drive'], color: 'from-emerald-50 to-teal-50 border-emerald-200',
    subSkills: [
      { id: 'res-plan', name: 'Research Plan', description: 'Design user research study with methodology selection', promptId: 'research-plan', outputs: ['Study Design', 'Interview Guide', 'Recruiting Criteria'], tools: ['Claude', 'Notion'] },
      { id: 'res-synthesis', name: 'Interview Synthesis', description: 'Synthesize user interview transcripts into insights', promptId: 'research-synthesis', outputs: ['Insights Report', 'Themes', 'Recommendations'], tools: ['Claude', 'Google Drive'] },
      { id: 'res-persona', name: 'Persona Builder', description: 'Create data-driven user personas from research', promptId: 'research-persona', outputs: ['Persona Profiles', 'Journey Maps', 'Pain Points'], tools: ['Claude'] },
    ],
  },
  {
    id: 'prd', name: 'PRD Agent', icon: '📄', role: 'PRD generation, spec writing, requirement analysis',
    tools: ['Claude', 'Confluence', 'Jira'], color: 'from-blue-50 to-indigo-50 border-blue-200',
    subSkills: [
      { id: 'prd-gen', name: 'PRD Generator', description: 'Generate comprehensive PRD from product brief', promptId: 'prd-generate', outputs: ['PRD Document', 'User Stories', 'Acceptance Criteria'], tools: ['Claude', 'Confluence'] },
      { id: 'prd-review', name: 'PRD Review', description: 'Review PRD for completeness, clarity, and edge cases', promptId: 'prd-review', outputs: ['Review Comments', 'Gap Analysis', 'Improvement Suggestions'], tools: ['Claude'] },
      { id: 'prd-epic', name: 'Epic Breakdown', description: 'Break PRD into epics and user stories for engineering', promptId: 'prd-epic-breakdown', outputs: ['Epic List', 'User Stories', 'Story Points'], tools: ['Claude', 'Jira'] },
    ],
  },
  {
    id: 'analytics', name: 'Analytics Agent', icon: '📊', role: 'Product analytics, funnel analysis, experimentation',
    tools: ['Claude', 'Notion'], color: 'from-cyan-50 to-sky-50 border-cyan-200',
    subSkills: [
      { id: 'ana-funnel', name: 'Funnel Analysis', description: 'Analyze conversion funnels and identify drop-off points', promptId: 'analytics-funnel', outputs: ['Funnel Report', 'Drop-off Analysis', 'Optimization Recommendations'], tools: ['Claude'] },
      { id: 'ana-experiment', name: 'A/B Test Design', description: 'Design experiments with hypothesis, metrics, and sample size', promptId: 'analytics-experiment', outputs: ['Experiment Design', 'Success Metrics', 'Statistical Plan'], tools: ['Claude'] },
      { id: 'ana-cohort', name: 'Cohort Analysis', description: 'Analyze user cohorts for retention and engagement patterns', promptId: 'analytics-cohort', outputs: ['Cohort Report', 'Retention Curves', 'Engagement Metrics'], tools: ['Claude', 'Notion'] },
    ],
  },
  {
    id: 'competitive', name: 'Competitive Intel Agent', icon: '🕵️', role: 'Competitor analysis, market trends, benchmarking',
    tools: ['Claude', 'Perplexity'], color: 'from-amber-50 to-yellow-50 border-amber-200',
    subSkills: [
      { id: 'comp-analysis', name: 'Competitor Deep Dive', description: 'Deep analysis of specific competitor product and strategy', promptId: 'competitive-deepdive', outputs: ['Competitor Profile', 'Feature Comparison', 'Strategic Assessment'], tools: ['Claude', 'Perplexity'] },
      { id: 'comp-landscape', name: 'Landscape Report', description: 'Full competitive landscape analysis with positioning', promptId: 'competitive-landscape', outputs: ['Landscape Map', 'Positioning Matrix', 'Opportunity Analysis'], tools: ['Claude', 'Perplexity'] },
      { id: 'comp-battlecard', name: 'Battle Cards', description: 'Generate sales battle cards for competitive deals', promptId: 'competitive-battlecard', outputs: ['Battle Card', 'Win/Loss Analysis', 'Objection Handling'], tools: ['Claude', 'Perplexity'] },
    ],
  },
  {
    id: 'launch', name: 'Launch Agent', icon: '🚀', role: 'Launch planning, GTM coordination, readiness checks',
    tools: ['Claude', 'Slack', 'Notion'], color: 'from-rose-50 to-pink-50 border-rose-200',
    subSkills: [
      { id: 'lch-plan', name: 'Launch Plan', description: 'Create comprehensive launch plan with timeline and owners', promptId: 'launch-plan', outputs: ['Launch Plan', 'Timeline', 'RACI Matrix'], tools: ['Claude', 'Notion'] },
      { id: 'lch-checklist', name: 'Launch Checklist', description: 'Generate launch readiness checklist across all functions', promptId: 'launch-checklist', outputs: ['Checklist', 'Readiness Score', 'Block List'], tools: ['Claude'] },
      { id: 'lch-announce', name: 'Launch Announcement', description: 'Draft internal and external launch announcements', promptId: 'launch-announcement', outputs: ['Internal Comms', 'Blog Post Draft', 'Social Posts'], tools: ['Claude', 'Slack'] },
    ],
  },
  {
    id: 'stakeholder', name: 'Stakeholder Reports Agent', icon: '📈', role: 'Status reports, board updates, exec summaries',
    tools: ['Claude', 'Notion', 'Google Drive'], color: 'from-slate-50 to-slate-100 border-slate-200',
    subSkills: [
      { id: 'stk-weekly', name: 'Weekly Update', description: 'Generate weekly product status update', promptId: 'stakeholder-weekly', outputs: ['Status Update', 'Key Metrics', 'Risks & Blockers'], tools: ['Claude', 'Notion'] },
      { id: 'stk-board', name: 'Board Report', description: 'Generate quarterly board report with KPIs and strategy', promptId: 'stakeholder-board', outputs: ['Board Deck', 'KPI Summary', 'Strategy Update'], tools: ['Claude', 'Google Drive'] },
      { id: 'stk-brief', name: 'Feature Brief', description: 'Create stakeholder-ready feature brief', promptId: 'stakeholder-feature', outputs: ['Feature Brief', 'Impact Assessment', 'Timeline'], tools: ['Claude'] },
    ],
  },
  {
    id: 'roadmap', name: 'Roadmap Agent', icon: '🗺️', role: 'Roadmap planning, prioritization, sequencing',
    tools: ['Claude', 'Jira', 'Notion'], color: 'from-indigo-50 to-blue-50 border-indigo-200',
    subSkills: [
      { id: 'rm-quarterly', name: 'Quarterly Planning', description: 'AI-assisted quarterly roadmap planning and sequencing', promptId: 'roadmap-quarterly', outputs: ['Roadmap Draft', 'Priority Matrix', 'Dependencies'], tools: ['Claude', 'Jira'] },
      { id: 'rm-prioritize', name: 'Feature Prioritization', description: 'Score and prioritize features using RICE/ICE frameworks', promptId: 'roadmap-prioritize', outputs: ['Priority Score', 'Framework Analysis', 'Rank Order'], tools: ['Claude'] },
      { id: 'rm-tradeoff', name: 'Trade-off Analysis', description: 'Analyze trade-offs between competing product priorities', promptId: 'roadmap-tradeoff', outputs: ['Trade-off Matrix', 'Impact Analysis', 'Recommendation'], tools: ['Claude', 'Notion'] },
    ],
  },
  {
    id: 'feedback', name: 'Customer Feedback Agent', icon: '💬', role: 'Feedback analysis, sentiment, theme extraction',
    tools: ['Claude', 'Slack'], color: 'from-lime-50 to-green-50 border-lime-200',
    subSkills: [
      { id: 'fb-analyze', name: 'Feedback Analysis', description: 'Analyze and categorize customer feedback at scale', promptId: 'feedback-analysis', outputs: ['Theme Analysis', 'Sentiment Report', 'Top Requests'], tools: ['Claude'] },
      { id: 'fb-nps', name: 'NPS Analysis', description: 'Deep dive into NPS responses and extract actionable insights', promptId: 'feedback-nps', outputs: ['NPS Breakdown', 'Driver Analysis', 'Improvement Plan'], tools: ['Claude'] },
      { id: 'fb-churn', name: 'Churn Analysis', description: 'Analyze churn reasons and suggest retention strategies', promptId: 'feedback-churn', outputs: ['Churn Report', 'Root Causes', 'Retention Playbook'], tools: ['Claude', 'Slack'] },
    ],
  },
  {
    id: 'pricing', name: 'Pricing Agent', icon: '💰', role: 'Pricing strategy, packaging, competitive pricing',
    tools: ['Claude', 'Perplexity'], color: 'from-sky-50 to-cyan-50 border-sky-200',
    subSkills: [
      { id: 'pr-strategy', name: 'Pricing Strategy', description: 'Develop pricing strategy based on market and value analysis', promptId: 'pricing-strategy', outputs: ['Pricing Model', 'Tier Structure', 'Revenue Projections'], tools: ['Claude', 'Perplexity'] },
      { id: 'pr-competitive', name: 'Competitive Pricing', description: 'Benchmark pricing against competitors', promptId: 'pricing-competitive', outputs: ['Price Comparison', 'Gap Analysis', 'Positioning'], tools: ['Claude', 'Perplexity'] },
      { id: 'pr-packaging', name: 'Feature Packaging', description: 'Optimize feature packaging and tier allocation', promptId: 'pricing-packaging', outputs: ['Package Matrix', 'Upgrade Triggers', 'Value Mapping'], tools: ['Claude'] },
    ],
  },
];

// ---------------------------------------------------------------------------
// Agent Capabilities Browser (collapsible, replaces standalone agents + prompts views)
// ---------------------------------------------------------------------------

function ProductAgentBrowser({ onRunSkill }: { onRunSkill?: (skillSlug: string) => void }) {
  const isToolConnected = useConnectionsStore(s => s.isToolConnected);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [selectedSubSkill, setSelectedSubSkill] = useState<Record<string, string>>({});

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Product Agents</h2>
        <p className="text-sm text-slate-600">10 AI agents with specialized sub-skills for strategy, research, PRDs, analytics, launches, and more.</p>
      </div>
      <div className="space-y-3">
        {PROD_AGENTS.map((a) => {
          const connectedTools = a.tools.filter(t => isToolConnected(PROD_TOOL_DEFS.find(d => d.name === t)?.connectorId ?? t.toLowerCase()));
          const allConnected = connectedTools.length === a.tools.length;
          const noneConnected = connectedTools.length === 0;
          const isExpanded = expandedAgent === a.id;
          const activeSubId = selectedSubSkill[a.id] ?? a.subSkills[0]?.id;
          const activeSub = a.subSkills.find(s => s.id === activeSubId) ?? a.subSkills[0];

          return (
            <div key={a.id} className={`rounded-xl border overflow-hidden transition-all ${isExpanded ? 'shadow-md' : ''} ${a.color.replace('from-', 'border-').split(' ')[2] || 'border-slate-200'}`}>
              <button
                onClick={() => setExpandedAgent(isExpanded ? null : a.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 bg-gradient-to-br ${a.color} text-left hover:brightness-[0.98] transition-all`}
              >
                <span className="text-xl">{a.icon}</span>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-bold text-slate-900">{a.name}</h4>
                  <p className="text-[11px] text-slate-600 truncate">{a.role}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[10px] text-slate-500 bg-white/60 px-2 py-0.5 rounded-full font-medium">
                    {a.subSkills.length} skills
                  </span>
                  <div className={`text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${
                    allConnected ? 'bg-emerald-100 text-emerald-700' : noneConnected ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${allConnected ? 'bg-emerald-500' : noneConnected ? 'bg-amber-500' : 'bg-blue-500'}`} />
                    {allConnected ? 'Ready' : noneConnected ? 'Sandbox' : `${connectedTools.length}/${a.tools.length}`}
                  </div>
                  <span className="text-[10px] text-slate-400">{isExpanded ? '▲' : '▼'}</span>
                </div>
              </button>

              {isExpanded && activeSub && (
                <div className="bg-white border-t p-4 space-y-4">
                  <div>
                    <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Select Skill</label>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {a.subSkills.map(sub => (
                        <button
                          key={sub.id}
                          onClick={() => setSelectedSubSkill(prev => ({ ...prev, [a.id]: sub.id }))}
                          className={`text-[11px] px-3 py-1.5 rounded-lg border font-medium transition-all ${
                            sub.id === activeSubId
                              ? 'bg-violet-700 text-white border-violet-700 shadow-sm'
                              : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          {sub.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 space-y-3">
                    <p className="text-xs text-slate-700">{activeSub.description}</p>
                    <div>
                      <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Pre-Built Prompt</label>
                      <div className="mt-1">
                        <span className="text-[11px] px-2.5 py-1 rounded-md bg-violet-50 border border-violet-200 text-violet-700 font-mono">
                          {activeSub.promptId}
                        </span>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Output Format</label>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {activeSub.outputs.map(out => (
                          <span key={out} className="text-[11px] px-2.5 py-1 rounded-md bg-blue-50 border border-blue-200 text-blue-700 font-medium">{out}</span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Tools Required</label>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {activeSub.tools.map(t => {
                          const toolDef = PROD_TOOL_DEFS.find(d => d.name === t);
                          const connected = toolDef ? isToolConnected(toolDef.connectorId) : false;
                          return (
                            <span key={t} className={`text-[11px] px-2 py-1 rounded-md border flex items-center gap-1.5 ${
                              connected ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-slate-200 text-slate-500'
                            }`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                              {t}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="text-[11px] text-slate-500">
                      {activeSub.tools.every(t => {
                        const td = PROD_TOOL_DEFS.find(d => d.name === t);
                        return td ? isToolConnected(td.connectorId) : false;
                      })
                        ? <span className="text-emerald-600 font-medium">All tools connected — live execution</span>
                        : <span className="text-amber-600 font-medium">Missing tools — will run in sandbox mode</span>
                      }
                    </div>
                    <button
                      onClick={() => onRunSkill?.(activeSub.skillSlug ?? activeSub.name)}
                      className="text-xs px-4 py-2 rounded-lg bg-violet-700 text-white font-semibold hover:bg-violet-800 transition-colors"
                    >
                      Run {activeSub.name} →
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skills View — Merges execution engine + agent capabilities browse
// ---------------------------------------------------------------------------

function ProdSkillsContent() {
  const [showAgents, setShowAgents] = useState(true);
  const [pendingSkillSlug, setPendingSkillSlug] = useState<string | null>(null);
  const cmdRef = useRef<HTMLDivElement>(null);

  const handleRunSkill = (slug: string) => {
    setPendingSkillSlug(slug);
    cmdRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div>
      <div ref={cmdRef}>
        <ProductCommandCenter initialSkillSlug={pendingSkillSlug} />
      </div>
      <div className="px-6 pb-6">
        <button
          onClick={() => setShowAgents(!showAgents)}
          className="w-full flex items-center justify-between py-3 text-left"
        >
          <div>
            <h3 className="text-sm font-bold text-slate-900">Browse by AI Agent</h3>
            <p className="text-[11px] text-slate-500">{PROD_AGENTS.length} agents · {PROD_AGENTS.reduce((s, a) => s + a.subSkills.length, 0)} capabilities with prompts, tools & outputs</p>
          </div>
          <span className="text-[10px] text-slate-400">{showAgents ? '▲ Collapse' : '▼ Expand'}</span>
        </button>
        {showAgents && <ProductAgentBrowser onRunSkill={handleRunSkill} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History — unified execution history
// ---------------------------------------------------------------------------

function ProdHistoryContent() {
  const executions = useProductStore((s) => s.executions);
  const mapped: OutputExecution[] = executions.map(e => ({
    id: e.id, skillName: e.skillName, status: e.status, steps: e.steps, outputs: e.outputs, startedAt: e.startedAt, completedAt: e.completedAt,
  }));
  if (mapped.length === 0) return (
    <div className="p-6"><DemoPreviewBanner pageName="Product History" steps={['Execute a product skill (PRD Generator, Epic Writer, Roadmap Analyzer)', 'Completed executions appear here with full outputs and quality scores', 'Compare PRD versions, track stakeholder feedback loops']} /></div>
  );
  return <OutputsView executions={mapped} accentColor="violet-700" />;
}

// ---------------------------------------------------------------------------
// Library — Browse skills, prompts, agent definitions
// ---------------------------------------------------------------------------

function ProdLibraryContent() {
  const [tab, setTab] = useState<'skills' | 'prompts' | 'agents'>('skills');
  return (
    <div>
      <div className="flex border-b border-slate-200 px-6 pt-4">
        {(['skills', 'prompts', 'agents'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors capitalize ${
              tab === t ? 'border-violet-700 text-violet-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'skills' ? '⚡ Skills' : t === 'prompts' ? '✨ Prompts' : '🤖 Agents'}
          </button>
        ))}
      </div>
      {tab === 'skills' && <ProductAgentBrowser onRunSkill={() => {}} />}
      {tab === 'prompts' && <PromptLibrary personaFilter="product" />}
      {tab === 'agents' && <AgentsPanel personaFilter="Product" />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Hub — 4-tab router with unified layout
// ---------------------------------------------------------------------------

export function ProductHub() {
  const activeSection = useProductStore((s) => s.activeSection);
  const setActiveSection = useProductStore((s) => s.setActiveSection);

  return (
    <UnifiedPersonaLayout
      persona="Product"
      accentColor="bg-violet-700"
      activeSection={activeSection}
      onSectionChange={(s) => setActiveSection(s as typeof activeSection)}
    >
      {activeSection === 'run' && <ProdSkillsContent />}
      {activeSection === 'library' && <ProdLibraryContent />}
      {activeSection === 'pipelines' && (
        <div className="p-6">
          <DemoPreviewBanner pageName="Product Pipelines" steps={['Execute multi-step product workflows (PRD → Epics → Stories → Jira)', 'Pipeline DAG shows decomposition chain with agent handoffs', 'Track real-time progress as Product and Engineering agents collaborate']} />
          <PipelineView persona="product" accentColor="violet-700" />
        </div>
      )}
      {activeSection === 'history' && <ProdHistoryContent />}
    </UnifiedPersonaLayout>
  );
}