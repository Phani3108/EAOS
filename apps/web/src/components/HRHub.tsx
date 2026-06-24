/**
 * HRHub — AI People's Success & Talent Acquisition Hub inside AgentOS
 * Consolidated: Skills (execution + agent browse) → Outputs → Programs → Memory.
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */
'use client';

import { useState, useEffect, useRef } from 'react';
import { notify } from '../lib/notify';
import { useHRStore, type PersonaExecutionStep } from '../store/persona-store';
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
const HR_TOOL_DEFS: { id: string; name: string; icon: string; connectorId: string }[] = [
  { id: 'claude',      name: 'Claude',       icon: '🤖', connectorId: 'anthropic'     },
  { id: 'perplexity',  name: 'Perplexity',   icon: '🔍', connectorId: 'perplexity'    },
  { id: 'notion',      name: 'Notion',       icon: '⬜', connectorId: 'notion'        },
  { id: 'slack',       name: 'Slack',        icon: '💬', connectorId: 'slack'         },
  { id: 'gdrive',      name: 'Google Drive', icon: '📁', connectorId: 'google-drive'  },
  { id: 'greenhouse',  name: 'Greenhouse',   icon: '🌿', connectorId: 'greenhouse'    },
  { id: 'lattice',     name: 'Lattice',      icon: '📊', connectorId: 'lattice'       },
];

function useHRToolStatus(): Record<string, SkillToolRef> {
  const isToolConnected = useConnectionsStore(s => s.isToolConnected);
  const result: Record<string, SkillToolRef> = {};
  for (const tool of HR_TOOL_DEFS) {
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

function HRCommandCenter({ initialSkillSlug }: { initialSkillSlug?: string | null }) {
  const [skills, setSkills] = useState<SkillDef[]>([]);
  const [clusters, setClusters] = useState<Record<string, SkillDef[]>>({});
  const [selectedSkill, setSelectedSkill] = useState<SkillDef | null>(null);
  const [executing, setExecuting] = useState(false);
  const toolStatus = useHRToolStatus();
  const mainSetActiveSection = useEAOSStore(s => s.setActiveSection);
  const connectedCount = HR_TOOL_DEFS.filter(t => useConnectionsStore.getState().isToolConnected(t.connectorId)).length;

  const activeExecution = useHRStore((s) => s.activeExecution);
  const addExecution = useHRStore((s) => s.addExecution);
  const updateExecution = useHRStore((s) => s.updateExecution);
  const updateExecutionStep = useHRStore((s) => s.updateExecutionStep);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch(`${GATEWAY_URL}/api/hr/skills`)
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
        const res = await fetch(`${GATEWAY_URL}/api/hr/executions/${activeExecution.id}`);
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
      const res = await fetch(`${GATEWAY_URL}/api/hr/execute`, {
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
      addExecution({ id: execution.id, persona: 'hr', skillId: execution.skillId, skillName: execution.skillName, status: execution.status ?? 'queued', steps: stepEvents, outputs: execution.outputs ?? {}, startedAt: execution.startedAt });
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
      {/* Hero header — HR-specific */}
      <div className="rounded-xl bg-gradient-to-r from-pink-700 to-rose-900 text-white p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">People &amp; Talent Command Center</h2>
            <p className="text-sm text-pink-200 mt-0.5">AI-powered JDs, resume screening, interview kits, onboarding, performance reviews &amp; people analytics.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-[11px] text-pink-300 uppercase tracking-wider">Tools Connected</p>
              <p className="text-lg font-bold">{connectedCount}/{HR_TOOL_DEFS.length}</p>
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
          <h3 className="text-sm font-semibold text-slate-700">{skills.length} HR & TA Skills</h3>
          <div className="grid gap-4">
            {Object.entries(clusters).map(([cluster, clusterSkills]) => (
              <div key={cluster} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm font-bold text-slate-800 mb-3">{cluster}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {clusterSkills.map((skill) => (
                    <button
                      key={skill.id}
                      onClick={() => setSelectedSkill(skill)}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-200 bg-pink-50 hover:border-pink-400 hover:bg-white text-left transition-all"
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
              accentClass="bg-pink-700"
              accentHoverClass="hover:bg-pink-800"
              persona="hr"
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
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-pink-100 text-pink-600 text-[11px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
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

const HR_AGENTS: AgentDef[] = [
  {
    id: 'ta-strategy', name: 'TA Strategist Agent', icon: '🎯', role: 'Hiring strategy, JD creation, pipeline management',
    tools: ['Claude', 'Greenhouse', 'LinkedIn'], color: 'from-pink-50 to-rose-50 border-pink-200',
    subSkills: [
      { id: 'ta-jd', name: 'JD Generator', description: 'Create inclusive, structured job descriptions', promptId: 'ta-jd-gen', outputs: ['Job Description', 'DEI Audit', 'Requirements'], tools: ['Claude'], skillSlug: 'jd-generator' },
      { id: 'ta-screening', name: 'Resume Screening', description: 'Screen and rank candidates against JD criteria', promptId: 'ta-screening', outputs: ['Ranked Shortlist', 'Scoring Matrix', 'Red Flags'], tools: ['Claude'], skillSlug: 'resume-screener' },
      { id: 'ta-pipeline', name: 'Pipeline Health', description: 'Analyze hiring pipeline metrics and bottlenecks', promptId: 'ta-pipeline', outputs: ['Pipeline Report', 'Bottleneck Analysis', 'Recommendations'], tools: ['Claude', 'Greenhouse'] },
    ],
  },
  {
    id: 'interview-design', name: 'Interview Design Agent', icon: '🎤', role: 'Interview kits, questions, rubrics, panel coordination',
    tools: ['Claude', 'Notion'], color: 'from-purple-50 to-fuchsia-50 border-purple-200',
    subSkills: [
      { id: 'int-kit', name: 'Interview Kit', description: 'Design structured interview kits with competency mapping', promptId: 'int-kit', outputs: ['Interview Kit', 'Competency Map', 'Rubrics'], tools: ['Claude'], skillSlug: 'interview-kit-generator' },
      { id: 'int-questions', name: 'Question Bank', description: 'Generate behavioral, technical, and case study questions', promptId: 'int-questions', outputs: ['Question Bank', 'STAR Prompts', 'Scoring Guide'], tools: ['Claude'] },
      { id: 'int-debrief', name: 'Debrief Template', description: 'Create structured interview debrief templates', promptId: 'int-debrief', outputs: ['Debrief Template', 'Decision Matrix', 'Summary'], tools: ['Claude', 'Notion'] },
    ],
  },
  {
    id: 'people-ops', name: 'People Ops Agent', icon: '🏢', role: 'Onboarding, offboarding, policies, employee lifecycle',
    tools: ['Claude', 'Notion', 'Slack'], color: 'from-emerald-50 to-teal-50 border-emerald-200',
    subSkills: [
      { id: 'pop-onboard', name: '30-60-90 Onboarding', description: 'Create structured onboarding plans with milestones', promptId: 'pop-onboarding', outputs: ['Onboarding Plan', 'Checklist', 'Check-in Schedule'], tools: ['Claude', 'Notion'], skillSlug: 'onboarding-plan-generator' },
      { id: 'pop-offboard', name: 'Offboarding', description: 'Generate offboarding checklists with knowledge transfer plans', promptId: 'pop-offboarding', outputs: ['Offboarding Checklist', 'Knowledge Transfer Plan', 'Exit Interview Guide'], tools: ['Claude'], skillSlug: 'offboarding-checklist' },
      { id: 'pop-policy', name: 'Policy Writer', description: 'Draft and update HR policies with compliance checks', promptId: 'pop-policy', outputs: ['Policy Draft', 'Compliance Review', 'FAQ'], tools: ['Claude'], skillSlug: 'hr-policy-generator' },
    ],
  },
  {
    id: 'performance', name: 'Performance & Growth Agent', icon: '📊', role: 'Performance reviews, calibration, growth plans',
    tools: ['Claude', 'Lattice'], color: 'from-blue-50 to-indigo-50 border-blue-200',
    subSkills: [
      { id: 'perf-review', name: 'Review Generator', description: 'Generate structured performance reviews from multiple inputs', promptId: 'perf-review', outputs: ['Performance Review', 'Rating Summary', 'Growth Areas'], tools: ['Claude', 'Lattice'], skillSlug: 'performance-review-generator' },
      { id: 'perf-calibration', name: 'Calibration Prep', description: 'Prepare calibration documents with cross-team comparison', promptId: 'perf-calibration', outputs: ['Calibration Doc', 'Distribution Analysis', 'Recommendations'], tools: ['Claude'] },
      { id: 'perf-growth', name: 'Growth Plan', description: 'Create individual development plans aligned to career ladders', promptId: 'perf-growth', outputs: ['Growth Plan', 'Skill Gap Analysis', 'Milestones'], tools: ['Claude'] },
    ],
  },
  {
    id: 'engagement', name: 'Engagement & Culture Agent', icon: '❤️', role: 'Surveys, sentiment analysis, culture programs',
    tools: ['Claude', 'Lattice', 'Slack'], color: 'from-amber-50 to-yellow-50 border-amber-200',
    subSkills: [
      { id: 'eng-survey', name: 'Survey Analysis', description: 'Analyze engagement surveys and extract actionable themes', promptId: 'eng-survey-analysis', outputs: ['Theme Analysis', 'Segment Breakdown', 'Action Plans'], tools: ['Claude', 'Lattice'], skillSlug: 'engagement-survey-analyzer' },
      { id: 'eng-pulse', name: 'Pulse Check', description: 'Design and analyze quick pulse surveys', promptId: 'eng-pulse', outputs: ['Pulse Results', 'Trend Report', 'Recommendations'], tools: ['Claude'] },
      { id: 'eng-culture', name: 'Culture Programs', description: 'Design employee recognition and culture programs', promptId: 'eng-culture', outputs: ['Program Design', 'Budget Estimate', 'Impact Metrics'], tools: ['Claude', 'Slack'] },
    ],
  },
  {
    id: 'compensation', name: 'Total Rewards Agent', icon: '💰', role: 'Compensation, benefits, equity, benchmarking',
    tools: ['Claude', 'Perplexity'], color: 'from-sky-50 to-cyan-50 border-sky-200',
    subSkills: [
      { id: 'comp-bench', name: 'Comp Benchmark', description: 'Benchmark compensation against market data', promptId: 'comp-benchmark', outputs: ['Benchmark Report', 'Pay Bands', 'Total Comp Analysis'], tools: ['Claude', 'Perplexity'], skillSlug: 'compensation-benchmarker' },
      { id: 'comp-equity', name: 'Equity Audit', description: 'Run internal equity analysis across teams', promptId: 'comp-equity', outputs: ['Equity Report', 'Gap Analysis', 'Remediation Plan'], tools: ['Claude'] },
      { id: 'comp-offer', name: 'Offer Modeling', description: 'Model offer packages with base, equity, and benefits', promptId: 'comp-offer', outputs: ['Offer Model', 'Comparison Table', 'Negotiation Range'], tools: ['Claude'], skillSlug: 'offer-letter-generator' },
    ],
  },
  {
    id: 'dei', name: 'DEI Agent', icon: '🌍', role: 'Diversity, equity, inclusion, bias auditing',
    tools: ['Claude'], color: 'from-lime-50 to-green-50 border-lime-200',
    subSkills: [
      { id: 'dei-audit', name: 'Language Audit', description: 'Scan content for exclusionary or biased language', promptId: 'dei-language', outputs: ['Audit Report', 'Flagged Terms', 'Alternatives'], tools: ['Claude'] },
      { id: 'dei-report', name: 'DEI Report', description: 'Generate DEI metrics report for leadership', promptId: 'dei-report', outputs: ['DEI Dashboard', 'Representation Stats', 'Goals Progress'], tools: ['Claude'] },
      { id: 'dei-training', name: 'Bias Training', description: 'Create bias awareness training materials', promptId: 'dei-training', outputs: ['Training Module', 'Scenarios', 'Assessment'], tools: ['Claude'] },
    ],
  },
  {
    id: 'hr-analytics', name: 'People Analytics Agent', icon: '📈', role: 'Workforce analytics, retention, predictive insights',
    tools: ['Claude', 'Lattice'], color: 'from-slate-50 to-slate-100 border-slate-200',
    subSkills: [
      { id: 'pa-retention', name: 'Retention Analysis', description: 'Analyze retention patterns and flight risk signals', promptId: 'pa-retention', outputs: ['Retention Report', 'Risk Indicators', 'Intervention Plan'], tools: ['Claude'] },
      { id: 'pa-workforce', name: 'Workforce Planning', description: 'Model future headcount needs based on growth plans', promptId: 'pa-workforce', outputs: ['Headcount Model', 'Skills Gap', 'Hiring Forecast'], tools: ['Claude'] },
      { id: 'pa-dashboard', name: 'HR Dashboard', description: 'Generate people metrics dashboard with KPIs', promptId: 'pa-dashboard', outputs: ['Dashboard Data', 'KPI Summary', 'Trend Analysis'], tools: ['Claude', 'Lattice'] },
    ],
  },
];

// ---------------------------------------------------------------------------
// Agent Capabilities Browser
// ---------------------------------------------------------------------------

function HRAgentBrowser() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const setActiveSection = useEAOSStore(s => s.setActiveSection);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-700 mb-2">HR & TA Agent Capabilities</h3>
      {HR_AGENTS.map((agent) => (
        <div key={agent.id} className={`rounded-xl border bg-gradient-to-br ${agent.color} p-4 transition-all`}>
          <button className="flex items-center gap-3 w-full text-left" onClick={() => setExpandedId(expandedId === agent.id ? null : agent.id)}>
            <span className="text-2xl">{agent.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800">{agent.name}</p>
              <p className="text-[11px] text-slate-500">{agent.role}</p>
            </div>
            <span className="text-xs text-slate-400">{expandedId === agent.id ? '▲' : '▼'}</span>
          </button>
          {expandedId === agent.id && (
            <div className="mt-3 space-y-2 pl-11">
              {agent.subSkills.map((sub) => (
                <div key={sub.id} className="rounded-lg bg-white/70 p-3 border border-slate-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-slate-800">{sub.name}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{sub.description}</p>
                    </div>
                    {sub.skillSlug && (
                      <button onClick={() => setActiveSection('ws-hr')} className="text-[11px] px-2 py-1 rounded bg-pink-100 text-pink-700 hover:bg-pink-200 font-medium">
                        Run →
                      </button>
                    )}
                  </div>
                  <div className="flex gap-1 mt-2 flex-wrap">
                    {sub.outputs.map((o) => (
                      <span key={o} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 text-slate-500 border border-slate-100">{o}</span>
                    ))}
                  </div>
                </div>
              ))}
              <div className="flex gap-1 flex-wrap pt-1">
                {agent.tools.map((t) => (
                  <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-white text-slate-600 border border-slate-200 font-medium">{t}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Content Views
// ---------------------------------------------------------------------------

function HRSkillsContent() {
  return (
    <div className="space-y-8">
      <HRCommandCenter />
      <div className="px-6"><HRAgentBrowser /></div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History — unified execution history
// ---------------------------------------------------------------------------

function HRHistoryContent() {
  const executions = useHRStore((s) => s.executions);
  const mapped: OutputExecution[] = executions.map(e => ({
    id: e.id, skillName: e.skillName || '', status: e.status, startedAt: e.startedAt, completedAt: e.completedAt, outputs: e.outputs, steps: [],
  }));
  if (mapped.length === 0) return (
    <div className="p-6"><DemoPreviewBanner pageName="HR History" steps={['Execute an HR skill (Policy Q&A, Onboarding Plan, Performance Review)', 'Completed executions appear here with outputs and compliance status', 'All HR executions include PII handling audit trails']} /></div>
  );
  return <OutputsView executions={mapped} accentColor="pink-700" />;
}

// ---------------------------------------------------------------------------
// Library — Browse skills, prompts, agent definitions
// ---------------------------------------------------------------------------

function HRLibraryContent() {
  const [tab, setTab] = useState<'skills' | 'prompts' | 'agents'>('skills');
  return (
    <div>
      <div className="flex border-b border-slate-200 px-6 pt-4">
        {(['skills', 'prompts', 'agents'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors capitalize ${
              tab === t ? 'border-pink-700 text-pink-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'skills' ? '⚡ Skills' : t === 'prompts' ? '✨ Prompts' : '🤖 Agents'}
          </button>
        ))}
      </div>
      {tab === 'skills' && <HRAgentBrowser />}
      {tab === 'prompts' && <PromptLibrary personaFilter="hr" />}
      {tab === 'agents' && <AgentsPanel personaFilter="HR & TA" />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Hub — 4-tab router with unified layout
// ---------------------------------------------------------------------------

export function HRHub() {
  const activeSection = useHRStore((s) => s.activeSection);
  const setActiveSection = useHRStore((s) => s.setActiveSection);

  return (
    <UnifiedPersonaLayout
      persona="HR & TA"
      accentColor="bg-pink-700"
      activeSection={activeSection}
      onSectionChange={(s) => setActiveSection(s as typeof activeSection)}
    >
      {activeSection === 'run' && <HRSkillsContent />}
      {activeSection === 'library' && <HRLibraryContent />}
      {activeSection === 'pipelines' && (
        <div className="p-6">
          <DemoPreviewBanner pageName="HR Pipelines" steps={['Execute multi-step HR workflows (Onboarding → Training → Review)', 'Pipeline DAG shows approval gates and compliance checkpoints', 'Track progress with strict PII access controls']} />
          <PipelineView persona="hr" accentColor="pink-700" />
        </div>
      )}
      {activeSection === 'history' && <HRHistoryContent />}
    </UnifiedPersonaLayout>
  );
}
