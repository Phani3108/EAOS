/**
 * EngineeringHub — AI Engineering Assistant inside AgentOS
 * Consolidated: Skills (execution + agent browse) → Outputs → Programs → Memory.
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */
'use client';

import { useState, useEffect, useRef } from 'react';
import { notify } from '../lib/notify';
import { useEngineeringStore, type PersonaExecutionStep } from '../store/persona-store';
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
// Types (matching gateway response)
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
const ENG_TOOL_DEFS: { id: string; name: string; icon: string; connectorId: string }[] = [
  { id: 'claude',     name: 'Claude',     icon: '🤖', connectorId: 'anthropic'  },
  { id: 'github',     name: 'GitHub',     icon: '🐙', connectorId: 'github'     },
  { id: 'jira',       name: 'Jira',       icon: '🟦', connectorId: 'jira'       },
  { id: 'confluence', name: 'Confluence', icon: '📘', connectorId: 'confluence' },
  { id: 'sentry',     name: 'Sentry',     icon: '🛡️', connectorId: 'sentry'     },
  { id: 'datadog',    name: 'Datadog',    icon: '📊', connectorId: 'datadog'    },
  { id: 'pagerduty',  name: 'PagerDuty', icon: '🚨', connectorId: 'pagerduty'  },
];

function useEngToolStatus(): Record<string, SkillToolRef> {
  const isToolConnected = useConnectionsStore(s => s.isToolConnected);
  const result: Record<string, SkillToolRef> = {};
  for (const tool of ENG_TOOL_DEFS) {
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

function EngineeringCommandCenter({ initialSkillSlug }: { initialSkillSlug?: string | null }) {
  const [skills, setSkills] = useState<SkillDef[]>([]);
  const [clusters, setClusters] = useState<Record<string, SkillDef[]>>({});
  const [selectedSkill, setSelectedSkill] = useState<SkillDef | null>(null);
  const [executing, setExecuting] = useState(false);
  const toolStatus = useEngToolStatus();
  const setActiveSection = useEAOSStore(s => s.setActiveSection);
  const connectedCount = ENG_TOOL_DEFS.filter(t => useConnectionsStore.getState().isToolConnected(t.connectorId)).length;

  const activeExecution = useEngineeringStore((s) => s.activeExecution);
  const addExecution = useEngineeringStore((s) => s.addExecution);
  const updateExecution = useEngineeringStore((s) => s.updateExecution);
  const updateExecutionStep = useEngineeringStore((s) => s.updateExecutionStep);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch(`${GATEWAY_URL}/api/engineering/skills`)
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
        const res = await fetch(`${GATEWAY_URL}/api/engineering/executions/${activeExecution.id}`);
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
      const res = await fetch(`${GATEWAY_URL}/api/engineering/execute`, {
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
      addExecution({ id: execution.id, persona: 'engineering', skillId: execution.skillId, skillName: execution.skillName, status: execution.status ?? 'queued', steps: stepEvents, outputs: execution.outputs ?? {}, startedAt: execution.startedAt });
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
      {/* Hero header — engineering-specific */}
      <div className="rounded-xl bg-slate-900 text-white p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Engineering Command Center</h2>
            <p className="text-sm text-slate-400 mt-0.5">AI-powered skills for code review, incident response, testing & architecture.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-[11px] text-slate-400 uppercase tracking-wider">Tools Connected</p>
              <p className="text-lg font-bold">{connectedCount}/{ENG_TOOL_DEFS.length}</p>
            </div>
            <button
              onClick={() => setActiveSection('conn-devtools')}
              className="px-3 py-2 text-xs font-semibold rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
            >
              Manage →
            </button>
          </div>
        </div>
        {connectedCount === 0 && (
          <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center gap-3">
            <svg className="w-4 h-4 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01" /></svg>
            <p className="text-[13px] text-amber-200">No tools connected yet. Skills will run in simulation mode. <button onClick={() => setActiveSection('conn-devtools')} className="underline text-amber-100 hover:text-white">Connect tools</button></p>
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
          <h3 className="text-sm font-semibold text-slate-700">{skills.length} Engineering Skills</h3>
          <div className="grid gap-4">
            {Object.entries(clusters).map(([cluster, clusterSkills]) => (
              <div key={cluster} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-sm font-bold text-slate-800 mb-3">{cluster}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {clusterSkills.map((skill) => (
                    <button
                      key={skill.id}
                      onClick={() => setSelectedSkill(skill)}
                      className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:border-slate-400 hover:bg-white text-left transition-all"
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
          {/* Form */}
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
              accentClass="bg-slate-900"
              accentHoverClass="hover:bg-slate-800"
              persona="engineering"
              onExecute={handleExecute}
              onCancel={() => setSelectedSkill(null)}
              executing={executing}
            />
          </div>
          {/* Steps preview */}
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h4 className="text-xs font-bold text-slate-700 mb-3 uppercase tracking-wide">Skill Steps</h4>
              <ol className="space-y-2">
                {selectedSkill.steps.map((step, i) => (
                  <li key={step.id} className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-100 text-slate-500 text-[11px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                    <div>
                      <p className="text-xs font-semibold text-slate-800">{step.name}</p>
                      <p className="text-[11px] text-slate-400">{step.agent} Agent{step.tool ? ` · ${step.tool}` : ''}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="mt-4 pt-3 border-t border-slate-100 space-y-1">
                <p className="text-[11px] text-slate-500"><span className="font-semibold">Complexity:</span> {selectedSkill.complexity}</p>
                <p className="text-[11px] text-slate-500"><span className="font-semibold">Est. time:</span> {selectedSkill.estimatedTime}</p>
                <p className="text-[11px] text-slate-500"><span className="font-semibold">Required:</span> {selectedSkill.requiredTools.join(', ')}</p>
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
  skillSlug?: string;   // maps to PersonaSkillDef.slug for Run button
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

const ENG_AGENTS: AgentDef[] = [
  {
    id: 'code-review', name: 'Code Review Agent', icon: '🔍', role: 'PR reviews, code quality, static analysis',
    tools: ['GitHub', 'Claude'], color: 'from-blue-50 to-indigo-50 border-blue-200',
    subSkills: [
      { id: 'cr-review', name: 'Full PR Review', description: 'Comprehensive AI-powered review of a pull request', promptId: 'code-review-full', outputs: ['Review Comments', 'Summary Report', 'Approval Recommendation'], tools: ['GitHub', 'Claude'], skillSlug: 'pr-review-assistant' },
      { id: 'cr-security', name: 'Security Audit', description: 'Scan PR for security vulnerabilities and OWASP issues', promptId: 'code-review-security', outputs: ['Security Report', 'CVE Check', 'Remediation Steps'], tools: ['GitHub', 'Claude'], skillSlug: 'pr-review-assistant' },
      { id: 'cr-perf', name: 'Performance Review', description: 'Identify performance issues and optimization opportunities', promptId: 'code-review-perf', outputs: ['Performance Report', 'Optimization Suggestions'], tools: ['GitHub', 'Claude'] },
      { id: 'cr-style', name: 'Style & Conventions', description: 'Enforce coding standards and naming conventions', promptId: 'code-review-style', outputs: ['Style Report', 'Auto-fix Suggestions'], tools: ['GitHub', 'Claude'] },
    ],
  },
  {
    id: 'incident', name: 'Incident Agent', icon: '🚨', role: 'Incident response, triage, postmortems',
    tools: ['PagerDuty', 'Datadog', 'Sentry', 'Claude'], color: 'from-red-50 to-orange-50 border-red-200',
    subSkills: [
      { id: 'inc-triage', name: 'Incident Triage', description: 'Classify severity, identify affected services, and suggest initial response', promptId: 'incident-triage', outputs: ['Severity Assessment', 'Impact Analysis', 'Response Actions'], tools: ['PagerDuty', 'Claude'] },
      { id: 'inc-postmortem', name: 'Postmortem Generator', description: 'Generate postmortem document from incident data', promptId: 'incident-postmortem', outputs: ['Postmortem Document', 'Timeline', 'Action Items'], tools: ['Datadog', 'Sentry', 'Claude'] },
      { id: 'inc-rca', name: 'Root Cause Analysis', description: 'Analyze logs and metrics to identify root cause', promptId: 'incident-rca', outputs: ['RCA Report', 'Contributing Factors', 'Prevention Plan'], tools: ['Datadog', 'Sentry', 'Claude'], skillSlug: 'incident-rca-draft' },
    ],
  },
  {
    id: 'testing', name: 'Testing Agent', icon: '🧪', role: 'Test generation, coverage, QA automation',
    tools: ['GitHub', 'Claude'], color: 'from-emerald-50 to-teal-50 border-emerald-200',
    subSkills: [
      { id: 'test-unit', name: 'Unit Test Generation', description: 'Generate unit tests from source code', promptId: 'test-unit-gen', outputs: ['Test File', 'Coverage Delta', 'Edge Cases'], tools: ['GitHub', 'Claude'], skillSlug: 'unit-test-generator' },
      { id: 'test-integration', name: 'Integration Tests', description: 'Generate integration tests for API endpoints', promptId: 'test-integration-gen', outputs: ['Test Suite', 'Mock Setup', 'Fixture Data'], tools: ['GitHub', 'Claude'], skillSlug: 'integration-test-generator' },
      { id: 'test-e2e', name: 'E2E Test Scripts', description: 'Generate end-to-end test scripts', promptId: 'test-e2e-gen', outputs: ['E2E Script', 'Page Objects', 'Test Data'], tools: ['Claude'] },
      { id: 'test-coverage', name: 'Coverage Analysis', description: 'Analyze test coverage gaps and suggest improvements', promptId: 'test-coverage', outputs: ['Coverage Report', 'Gap Analysis', 'Priority Tests'], tools: ['GitHub', 'Claude'] },
    ],
  },
  {
    id: 'architecture', name: 'Architecture Agent', icon: '🏗️', role: 'System design, ADRs, architecture reviews',
    tools: ['Claude', 'Confluence'], color: 'from-violet-50 to-purple-50 border-violet-200',
    subSkills: [
      { id: 'arch-review', name: 'Architecture Review', description: 'AI review of system architecture decisions', promptId: 'arch-review', outputs: ['Review Document', 'Risk Assessment', 'Recommendations'], tools: ['Claude'], skillSlug: 'architecture-summary-generator' },
      { id: 'arch-adr', name: 'ADR Generator', description: 'Generate Architecture Decision Records', promptId: 'arch-adr-gen', outputs: ['ADR Document', 'Alternatives Analysis', 'Decision Matrix'], tools: ['Claude', 'Confluence'] },
      { id: 'arch-diagram', name: 'System Diagram', description: 'Generate system architecture diagrams from descriptions', promptId: 'arch-diagram', outputs: ['Mermaid Diagram', 'Component Map', 'Data Flow'], tools: ['Claude'] },
    ],
  },
  {
    id: 'devops', name: 'DevOps Agent', icon: '🚀', role: 'CI/CD, deployments, infrastructure',
    tools: ['GitHub', 'Claude'], color: 'from-cyan-50 to-sky-50 border-cyan-200',
    subSkills: [
      { id: 'ops-pipeline', name: 'Pipeline Config', description: 'Generate or optimize CI/CD pipeline configurations', promptId: 'devops-pipeline', outputs: ['Pipeline YAML', 'Stage Config', 'Optimization Notes'], tools: ['GitHub', 'Claude'], skillSlug: 'ci-failure-diagnosis' },
      { id: 'ops-deploy', name: 'Deploy Strategy', description: 'Plan deployment strategy (blue-green, canary, rolling)', promptId: 'devops-deploy', outputs: ['Deploy Plan', 'Rollback Playbook', 'Health Checks'], tools: ['Claude'] },
      { id: 'ops-infra', name: 'IaC Generation', description: 'Generate infrastructure-as-code templates', promptId: 'devops-iac', outputs: ['Terraform/Bicep', 'Resource Graph', 'Cost Estimate'], tools: ['Claude'] },
    ],
  },
  {
    id: 'documentation', name: 'Documentation Agent', icon: '📝', role: 'API docs, runbooks, technical writing',
    tools: ['Claude', 'Confluence', 'GitHub'], color: 'from-amber-50 to-yellow-50 border-amber-200',
    subSkills: [
      { id: 'doc-api', name: 'API Documentation', description: 'Generate API docs from code or OpenAPI specs', promptId: 'doc-api-gen', outputs: ['API Reference', 'OpenAPI Spec', 'Examples'], tools: ['GitHub', 'Claude'], skillSlug: 'technical-documentation-generator' },
      { id: 'doc-runbook', name: 'Runbook Generator', description: 'Create operational runbooks from system description', promptId: 'doc-runbook', outputs: ['Runbook', 'Decision Tree', 'Checklist'], tools: ['Claude', 'Confluence'] },
      { id: 'doc-onboard', name: 'Onboarding Guide', description: 'Generate developer onboarding documentation', promptId: 'doc-onboarding', outputs: ['Setup Guide', 'Architecture Overview', 'FAQ'], tools: ['Claude', 'Confluence'] },
      { id: 'doc-changelog', name: 'Changelog & Release Notes', description: 'Generate changelogs from git history', promptId: 'doc-changelog', outputs: ['Changelog', 'Release Notes', 'Migration Guide'], tools: ['GitHub', 'Claude'] },
    ],
  },
  {
    id: 'security', name: 'Security Agent', icon: '🛡️', role: 'Vulnerability scanning, compliance, security reviews',
    tools: ['Sentry', 'Claude'], color: 'from-rose-50 to-pink-50 border-rose-200',
    subSkills: [
      { id: 'sec-scan', name: 'Vulnerability Scan', description: 'SAST/DAST analysis with AI remediation suggestions', promptId: 'security-scan', outputs: ['Vulnerability Report', 'Severity Matrix', 'Fix Recommendations'], tools: ['Sentry', 'Claude'] },
      { id: 'sec-review', name: 'Security Review', description: 'Security architecture review and threat modeling', promptId: 'security-review', outputs: ['Threat Model', 'Risk Assessment', 'Mitigation Plan'], tools: ['Claude'] },
      { id: 'sec-compliance', name: 'Compliance Check', description: 'Check code and infrastructure for compliance standards', promptId: 'security-compliance', outputs: ['Compliance Report', 'Gap Analysis', 'Remediation Steps'], tools: ['Claude'] },
    ],
  },
  {
    id: 'performance', name: 'Performance Agent', icon: '⚡', role: 'Profiling, bottlenecks, optimization',
    tools: ['Datadog', 'Claude'], color: 'from-lime-50 to-green-50 border-lime-200',
    subSkills: [
      { id: 'perf-profile', name: 'Performance Profiling', description: 'Identify bottlenecks from profiling data', promptId: 'perf-profile', outputs: ['Profile Analysis', 'Hotspot Map', 'Optimization Plan'], tools: ['Datadog', 'Claude'] },
      { id: 'perf-query', name: 'Query Optimization', description: 'Analyze and optimize database queries', promptId: 'perf-query', outputs: ['Query Analysis', 'Index Suggestions', 'Optimized Queries'], tools: ['Claude'] },
      { id: 'perf-benchmark', name: 'Benchmark Runner', description: 'Design and analyze load test benchmarks', promptId: 'perf-benchmark', outputs: ['Benchmark Results', 'SLA Assessment', 'Scaling Recommendations'], tools: ['Datadog', 'Claude'] },
    ],
  },
  {
    id: 'refactoring', name: 'Refactoring Agent', icon: '♻️', role: 'Code refactoring, modernization, tech debt',
    tools: ['GitHub', 'Claude'], color: 'from-slate-50 to-slate-100 border-slate-200',
    subSkills: [
      { id: 'ref-modernize', name: 'Code Modernization', description: 'Modernize legacy code with current best practices', promptId: 'refactor-modernize', outputs: ['Refactored Code', 'Before/After Comparison', 'Migration Steps'], tools: ['GitHub', 'Claude'] },
      { id: 'ref-decompose', name: 'Service Decomposition', description: 'Break monolith into microservices', promptId: 'refactor-decompose', outputs: ['Decomposition Plan', 'API Contracts', 'Data Migration Strategy'], tools: ['Claude'] },
      { id: 'ref-debt', name: 'Tech Debt Audit', description: 'Identify and prioritize technical debt', promptId: 'refactor-debt', outputs: ['Debt Inventory', 'Priority Matrix', 'Effort Estimates'], tools: ['GitHub', 'Claude'] },
    ],
  },
  {
    id: 'planning', name: 'Sprint Planning Agent', icon: '📋', role: 'Sprint planning, estimation, capacity',
    tools: ['Jira', 'Claude'], color: 'from-sky-50 to-cyan-50 border-sky-200',
    subSkills: [
      { id: 'plan-sprint', name: 'Sprint Planning', description: 'AI-assisted sprint planning and capacity allocation', promptId: 'sprint-planning', outputs: ['Sprint Plan', 'Capacity Allocation', 'Risk Assessment'], tools: ['Jira', 'Claude'], skillSlug: 'jira-ticket-breakdown' },
      { id: 'plan-estimate', name: 'Story Estimation', description: 'AI story point estimation based on historical data', promptId: 'sprint-estimation', outputs: ['Point Estimates', 'Confidence Levels', 'Comparison Data'], tools: ['Jira', 'Claude'] },
      { id: 'plan-velocity', name: 'Velocity Analysis', description: 'Analyze team velocity trends and forecast capacity', promptId: 'sprint-velocity', outputs: ['Velocity Report', 'Forecast', 'Improvement Suggestions'], tools: ['Jira', 'Claude'] },
    ],
  },
];

// ---------------------------------------------------------------------------
// Agent Capabilities Browser (collapsible, replaces standalone agents + prompts views)
// ---------------------------------------------------------------------------

function EngineeringAgentBrowser({ onRunSkill }: { onRunSkill?: (skillSlug: string) => void }) {
  const isToolConnected = useConnectionsStore(s => s.isToolConnected);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [selectedSubSkill, setSelectedSubSkill] = useState<Record<string, string>>({});

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Engineering Agents</h2>
        <p className="text-sm text-slate-600">10 AI agents with specialized sub-skills for code review, incidents, testing, architecture, and more.</p>
      </div>
      <div className="space-y-3">
        {ENG_AGENTS.map((a) => {
          const connectedTools = a.tools.filter(t => isToolConnected(ENG_TOOL_DEFS.find(d => d.name === t)?.connectorId ?? t.toLowerCase()));
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
                              ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
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
                          const toolDef = ENG_TOOL_DEFS.find(d => d.name === t);
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
                        const td = ENG_TOOL_DEFS.find(d => d.name === t);
                        return td ? isToolConnected(td.connectorId) : false;
                      })
                        ? <span className="text-emerald-600 font-medium">All tools connected — live execution</span>
                        : <span className="text-amber-600 font-medium">Missing tools — will run in sandbox mode</span>
                      }
                    </div>
                    <button
                      onClick={() => onRunSkill?.(activeSub.skillSlug ?? activeSub.name)}
                      className="text-xs px-4 py-2 rounded-lg bg-slate-900 text-white font-semibold hover:bg-slate-800 transition-colors"
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

function EngSkillsContent() {
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
        <EngineeringCommandCenter initialSkillSlug={pendingSkillSlug} />
      </div>
      <div className="px-6 pb-6">
        <button
          onClick={() => setShowAgents(!showAgents)}
          className="w-full flex items-center justify-between py-3 text-left"
        >
          <div>
            <h3 className="text-sm font-bold text-slate-900">Browse by AI Agent</h3>
            <p className="text-[11px] text-slate-500">{ENG_AGENTS.length} agents · {ENG_AGENTS.reduce((s, a) => s + a.subSkills.length, 0)} capabilities with prompts, tools & outputs</p>
          </div>
          <span className="text-[10px] text-slate-400">{showAgents ? '▲ Collapse' : '▼ Expand'}</span>
        </button>
        {showAgents && <EngineeringAgentBrowser onRunSkill={handleRunSkill} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History — unified execution history
// ---------------------------------------------------------------------------

function EngHistoryContent() {
  const executions = useEngineeringStore((s) => s.executions);
  const mapped: OutputExecution[] = executions.map(e => ({
    id: e.id, skillName: e.skillName, status: e.status, steps: e.steps, outputs: e.outputs, startedAt: e.startedAt, completedAt: e.completedAt,
  }));
  if (mapped.length === 0) return (
    <div className="p-6"><DemoPreviewBanner pageName="Engineering History" steps={['Execute an engineering skill (PR Review, Incident RCA, Test Generator)', 'Completed executions appear here with full outputs and quality scores', 'Compare results across runs, export reports, and track agent performance']} /></div>
  );
  return <OutputsView executions={mapped} accentColor="slate-900" />;
}

// ---------------------------------------------------------------------------
// Library — Browse skills, prompts, agent definitions
// ---------------------------------------------------------------------------

function EngLibraryContent() {
  const [tab, setTab] = useState<'skills' | 'prompts' | 'agents'>('skills');
  return (
    <div>
      <div className="flex border-b border-slate-200 px-6 pt-4">
        {(['skills', 'prompts', 'agents'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors capitalize ${
              tab === t ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'skills' ? '⚡ Skills' : t === 'prompts' ? '✨ Prompts' : '🤖 Agents'}
          </button>
        ))}
      </div>
      {tab === 'skills' && <EngineeringAgentBrowser onRunSkill={() => {}} />}
      {tab === 'prompts' && <PromptLibrary personaFilter="engineering" />}
      {tab === 'agents' && <AgentsPanel personaFilter="Engineering" />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Hub — 4-tab router with unified layout
// ---------------------------------------------------------------------------

export function EngineeringHub() {
  const activeSection = useEngineeringStore((s) => s.activeSection);
  const setActiveSection = useEngineeringStore((s) => s.setActiveSection);

  return (
    <UnifiedPersonaLayout
      persona="Engineering"
      accentColor="bg-slate-900"
      activeSection={activeSection}
      onSectionChange={(s) => setActiveSection(s as typeof activeSection)}
    >
      {activeSection === 'run' && <EngSkillsContent />}
      {activeSection === 'library' && <EngLibraryContent />}
      {activeSection === 'pipelines' && (
        <div className="p-6">
          <DemoPreviewBanner pageName="Engineering Pipelines" steps={['Execute multi-step engineering workflows (PR Review → Security Scan → Report)', 'Pipeline DAG shows step dependencies, agent assignments, and approval gates', 'Track live progress as agents execute each stage with tool calls']} />
          <PipelineView persona="engineering" accentColor="slate-900" />
        </div>
      )}
      {activeSection === 'history' && <EngHistoryContent />}
    </UnifiedPersonaLayout>
  );
}
