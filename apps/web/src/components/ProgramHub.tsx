/**
 * ProgramHub — Program Management AI workspace inside AgentOS
 * 4-tab layout: Skills (execution) → Library → Pipelines → History
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */
'use client';

import { useState, useEffect, useRef } from 'react';
import { useProgramStore, type PersonaExecutionStep } from '../store/persona-store';
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
import { notify } from '../lib/notify';
import { submitExecution } from '../lib/execution-client';
import { isTerminalExecutionStatus } from '@agentos/skills/schema';
import type { ExecutionRequest } from '@agentos/gateway/execution-api-contract';
import type { ExecutionStepEvent } from '../store/marketing-store';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000';
const POLL_INTERVAL_MS = 2000;

interface SkillStep { id: string; order: number; name: string; agent: string; tool?: string; outputKey: string; requiresApproval?: boolean }
interface SkillDef { id: string; slug: string; name: string; description: string; icon: string; cluster: string; complexity: 'simple' | 'moderate' | 'complex'; estimatedTime: string; inputs: SkillInputField[]; steps: SkillStep[]; outputs: string[]; requiredTools: string[]; optionalTools: string[]; tags: string[] }

const PGM_TOOL_DEFS: { id: string; name: string; icon: string; connectorId: string }[] = [
  { id: 'claude', name: 'Claude', icon: '🤖', connectorId: 'anthropic' },
  { id: 'jira', name: 'Jira', icon: '🟦', connectorId: 'jira' },
  { id: 'confluence', name: 'Confluence', icon: '📚', connectorId: 'confluence' },
  { id: 'slack', name: 'Slack', icon: '💬', connectorId: 'slack' },
];

function usePGMToolStatus(): Record<string, SkillToolRef> {
  const isToolConnected = useConnectionsStore(s => s.isToolConnected);
  const result: Record<string, SkillToolRef> = {};
  for (const tool of PGM_TOOL_DEFS) {
    result[tool.id] = { id: tool.id, name: tool.name, icon: tool.icon, connected: isToolConnected(tool.connectorId) };
  }
  return result;
}

// ── Seed skills for demo ────────────────────────────────────
const DEMO_SKILLS: SkillDef[] = [
  { id: 'pgm-001', slug: 'weekly-status-synthesis', name: 'Weekly Status Synthesis', description: 'Aggregate Jira, Confluence, Slack updates into an executive status report.', icon: '📊', cluster: 'Reporting', complexity: 'moderate', estimatedTime: '30–60s',
    inputs: [{ id: 'program_name', label: 'Program', type: 'text', required: true, section: 'basic', placeholder: 'e.g. Card Modernization v2' }, { id: 'period', label: 'Period', type: 'text', required: true, section: 'basic', placeholder: 'This Week' }],
    steps: [{ id: 's1', order: 1, name: 'Gather Jira Data', agent: 'Status Analyst', tool: 'Jira', outputKey: 'jira_data' }, { id: 's2', order: 2, name: 'Identify Risks', agent: 'Risk Analyst', outputKey: 'risks' }, { id: 's3', order: 3, name: 'Executive Summary', agent: 'Report Compiler', outputKey: 'report', requiresApproval: true }],
    outputs: ['jira_data', 'risks', 'report'], requiredTools: ['Claude'], optionalTools: ['Jira', 'Confluence'], tags: ['status', 'reporting'] },
  { id: 'pgm-002', slug: 'raid-detection', name: 'RAID Log Generator', description: 'Scan programs to detect Risks, Assumptions, Issues, and Dependencies with mitigations.', icon: '⚠️', cluster: 'Risk Management', complexity: 'complex', estimatedTime: '60–120s',
    inputs: [{ id: 'program_name', label: 'Program', type: 'text', required: true, section: 'basic' }, { id: 'context', label: 'Program Context', type: 'textarea', required: true, section: 'basic' }],
    steps: [{ id: 's1', order: 1, name: 'Analyze Context', agent: 'RAID Analyst', outputKey: 'context' }, { id: 's2', order: 2, name: 'Identify Risks', agent: 'RAID Analyst', outputKey: 'risks' }, { id: 's3', order: 3, name: 'RAID Log', agent: 'RAID Analyst', outputKey: 'raid_log', requiresApproval: true }],
    outputs: ['context', 'risks', 'raid_log'], requiredTools: ['Claude'], optionalTools: ['Jira'], tags: ['raid', 'risk'] },
  { id: 'pgm-003', slug: 'launch-readiness', name: 'Launch Readiness Assessment', description: 'Multi-function readiness check — Engineering, Product, Marketing, Support all assessed.', icon: '🚀', cluster: 'Launch', complexity: 'complex', estimatedTime: '60–120s',
    inputs: [{ id: 'launch_name', label: 'Launch Name', type: 'text', required: true, section: 'basic' }, { id: 'scope', label: 'Scope', type: 'textarea', required: true, section: 'basic' }],
    steps: [{ id: 's1', order: 1, name: 'Eng Readiness', agent: 'Launch Coordinator', outputKey: 'eng' }, { id: 's2', order: 2, name: 'Product Readiness', agent: 'Launch Coordinator', outputKey: 'prod' }, { id: 's3', order: 3, name: 'Go/No-Go', agent: 'Program Lead', outputKey: 'decision', requiresApproval: true }],
    outputs: ['eng', 'prod', 'decision'], requiredTools: ['Claude'], optionalTools: ['Jira', 'Confluence'], tags: ['launch', 'readiness'] },
  { id: 'pgm-004', slug: 'program-plan', name: 'Program Plan Generator', description: 'Generate a structured plan with milestones, workstreams, RACI, and governance.', icon: '📋', cluster: 'Planning', complexity: 'complex', estimatedTime: '60–90s',
    inputs: [{ id: 'initiative', label: 'Initiative', type: 'text', required: true, section: 'basic' }, { id: 'brief', label: 'Brief', type: 'textarea', required: true, section: 'basic' }],
    steps: [{ id: 's1', order: 1, name: 'Scope Analysis', agent: 'Program Planner', outputKey: 'scope' }, { id: 's2', order: 2, name: 'Workstreams', agent: 'Program Planner', outputKey: 'workstreams' }, { id: 's3', order: 3, name: 'Program Plan', agent: 'Program Lead', outputKey: 'plan', requiresApproval: true }],
    outputs: ['scope', 'workstreams', 'plan'], requiredTools: ['Claude'], optionalTools: ['Jira'], tags: ['planning', 'raci'] },
  { id: 'pgm-005', slug: 'stakeholder-update', name: 'Stakeholder Communication', description: 'Draft stakeholder updates — weekly reports, escalations, launch announcements.', icon: '📨', cluster: 'Communication', complexity: 'simple', estimatedTime: '15–30s',
    inputs: [{ id: 'type', label: 'Type', type: 'text', required: true, section: 'basic', placeholder: 'Weekly Update / Escalation / Announcement' }, { id: 'context', label: 'Key Points', type: 'textarea', required: true, section: 'basic' }],
    steps: [{ id: 's1', order: 1, name: 'Draft', agent: 'Comms Specialist', outputKey: 'draft' }, { id: 's2', order: 2, name: 'Finalize', agent: 'Comms Specialist', outputKey: 'final', requiresApproval: true }],
    outputs: ['draft', 'final'], requiredTools: ['Claude'], optionalTools: ['Slack'], tags: ['communication'] },
  { id: 'pgm-008', slug: 'executive-review-pack', name: 'Executive Review Pack', description: 'Comprehensive exec pack with program health, financials, risks, and decisions needed.', icon: '💼', cluster: 'Reporting', complexity: 'complex', estimatedTime: '60–120s',
    inputs: [{ id: 'program', label: 'Program', type: 'text', required: true, section: 'basic' }, { id: 'data', label: 'Program Data', type: 'textarea', required: true, section: 'basic' }],
    steps: [{ id: 's1', order: 1, name: 'Health Analysis', agent: 'Executive Analyst', outputKey: 'health' }, { id: 's2', order: 2, name: 'Risk Brief', agent: 'Executive Analyst', outputKey: 'risks' }, { id: 's3', order: 3, name: 'Exec Pack', agent: 'Executive Analyst', outputKey: 'pack', requiresApproval: true }],
    outputs: ['health', 'risks', 'pack'], requiredTools: ['Claude'], optionalTools: ['Jira', 'Confluence'], tags: ['executive', 'review'] },
];

// ── Command Center ──────────────────────────────────────────
function ProgramCommandCenter() {
  const toolStatus = usePGMToolStatus();
  const [skills, setSkills] = useState<SkillDef[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<SkillDef | null>(null);
  const [executing, setExecuting] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const activeExecution = useProgramStore((s: any) => s.activeExecution);
  const addExecution = useProgramStore((s: any) => s.addExecution);
  const updateExecution = useProgramStore((s: any) => s.updateExecution);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch(`${GATEWAY_URL}/api/program/skills`).then(r => r.json())
      .then(d => { if (d.skills?.length) setSkills(d.skills); else { setSkills(DEMO_SKILLS); setIsDemo(true); } })
      .catch(() => { setSkills(DEMO_SKILLS); setIsDemo(true); });
  }, []);

  useEffect(() => {
    if (!activeExecution || isTerminalExecutionStatus(activeExecution.status)) { if (pollRef.current) clearInterval(pollRef.current); return; }
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${GATEWAY_URL}/api/program/executions/${activeExecution.id}`);
        const data = await r.json();
        if (data.execution) updateExecution(activeExecution.id, { status: data.execution.status, steps: data.execution.steps, outputs: data.execution.outputs, completedAt: data.execution.completedAt });
      } catch {}
    }, POLL_INTERVAL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeExecution?.id, activeExecution?.status, updateExecution]);

  const handleExecute = async (inputs: Record<string, unknown>, simulate: boolean, customPrompt?: string, modelId?: string, provider?: string) => {
    if (!selectedSkill) return;
    setExecuting(true);
    try {
      // Canonical path (was /api/program/executions, which skipped the shared validation and run mode).
      const execution = await submitExecution({
        persona: 'program', skillId: selectedSkill.id, inputs, simulate, customPrompt,
        provider: provider as ExecutionRequest['provider'], modelId,
      });
      addExecution({ id: execution.id, persona: 'program', skillId: selectedSkill.id, skillName: selectedSkill.name, status: execution.status, steps: execution.steps || [], outputs: {}, startedAt: execution.startedAt });
    } catch (err) {
      notify('error', 'Run not started', err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setExecuting(false);
    }
  };

  const phase = activeExecution ? (isTerminalExecutionStatus(activeExecution.status) ? 'output' : 'running') : selectedSkill ? 'configure' : 'pick';
  const succeeded = activeExecution ? ['completed', 'simulated'].includes(activeExecution.status) : false;

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto">
      {isDemo && <DemoPreviewBanner pageName="Program Skills" steps={['Start the gateway to load program management skills', 'Select a skill (Status Synthesis, RAID Log, Launch Readiness, etc.)', 'Configure inputs and execute — agents coordinate across functions']} />}

      {phase === 'pick' && (
        <div>
          <h2 className="text-lg font-bold text-slate-900 mb-4">Select a Skill</h2>
          <div className="grid grid-cols-2 gap-3">
            {skills.map(s => (
              <button key={s.id} onClick={() => setSelectedSkill(s)} className="card p-4 text-left hover:border-indigo-500 transition-all">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{s.icon}</span>
                  <span className="text-sm font-semibold text-slate-900">{s.name}</span>
                </div>
                <p className="text-xs text-slate-500 mb-2">{s.description}</p>
                <div className="flex items-center gap-2">
                  <span className="badge badge-neutral text-[9px]">{s.cluster}</span>
                  <span className="text-[10px] text-slate-400">{s.estimatedTime}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {phase === 'configure' && selectedSkill && (
        <div>
          <button onClick={() => setSelectedSkill(null)} className="text-xs text-slate-500 hover:text-slate-700 mb-3">&larr; Back to skills</button>
          <PersonaWorkflowForm fields={selectedSkill.inputs} tools={Object.values(toolStatus)} persona="engineering" accentClass="bg-indigo-600" accentHoverClass="hover:bg-indigo-700" onExecute={handleExecute} onCancel={() => setSelectedSkill(null)} executing={executing} />
        </div>
      )}

      {phase === 'running' && activeExecution && (
        <ExecutionTimeline workflowName={activeExecution.skillName} status={activeExecution.status} steps={activeExecution.steps.map((s: any) => ({ stepId: s.stepId, stepName: s.stepName, agent: s.agent, status: s.status, startedAt: s.startedAt, completedAt: s.completedAt, outputPreview: s.outputPreview }))} />
      )}

      {phase === 'output' && activeExecution && (
        <div>
          <div className={`rounded-xl p-4 mb-4 ${succeeded ? 'bg-indigo-50 border border-indigo-200' : 'bg-red-50 border border-red-200'}`}>
            <h3 className={`text-sm font-bold ${succeeded ? 'text-indigo-800' : 'text-red-800'}`}>
              {activeExecution.status === 'simulated' ? 'Completed · Simulated' : succeeded ? 'Completed' : `Run ${activeExecution.status}`}
            </h3>
          </div>
          <button onClick={() => { updateExecution(activeExecution.id, {}); setSelectedSkill(null); }} className="btn btn-secondary btn-sm">Run Another Skill</button>
        </div>
      )}
    </div>
  );
}

function ProgramSkillsContent() { return <ProgramCommandCenter />; }

function ProgramLibraryContent() {
  const [tab, setTab] = useState<'skills' | 'prompts' | 'agents'>('skills');
  return (
    <div>
      <div className="flex border-b border-slate-200 px-6 pt-4">
        {(['skills', 'prompts', 'agents'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors capitalize ${tab === t ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {t === 'skills' ? '⚡ Skills' : t === 'prompts' ? '✨ Prompts' : '🤖 Agents'}
          </button>
        ))}
      </div>
      {tab === 'skills' && <div className="p-6"><p className="text-sm text-slate-500">Browse Program skills in the Run tab or view the full catalog.</p></div>}
      {tab === 'prompts' && <PromptLibrary personaFilter={"engineering" as any} />}
      {tab === 'agents' && <AgentsPanel personaFilter={"Engineering" as any} />}
    </div>
  );
}

function ProgramHistoryContent() {
  const executions = useProgramStore((s: any) => s.executions);
  const mapped: OutputExecution[] = executions.map((e: any) => ({ id: e.id, skillName: e.skillName, status: e.status, steps: e.steps, outputs: e.outputs, startedAt: e.startedAt, completedAt: e.completedAt }));
  if (mapped.length === 0) return (
    <div className="p-6">
      <DemoPreviewBanner pageName="Program History" steps={['Execute a program skill (Status Synthesis, RAID Log, Launch Readiness)', 'Completed executions appear here with full outputs and quality scores', 'Compare runs across sprints and export for stakeholder reviews']} />
    </div>
  );
  return <OutputsView executions={mapped} accentColor="indigo" />;
}

export function ProgramHub() {
  const activeSection = useProgramStore((s: any) => s.activeSection);
  const setActiveSection = useProgramStore((s: any) => s.setActiveSection);

  return (
    <UnifiedPersonaLayout persona="Program" accentColor="bg-indigo-600" activeSection={activeSection} onSectionChange={(s) => setActiveSection(s)}>
      {activeSection === 'run' && <ProgramSkillsContent />}
      {activeSection === 'library' && <ProgramLibraryContent />}
      {activeSection === 'pipelines' && (
        <div className="p-6">
          <DemoPreviewBanner pageName="Program Pipelines" steps={['Execute multi-step program workflows (Status → RAID → Launch Readiness)', 'Pipeline DAG shows cross-functional dependencies and approval gates', 'Track real-time progress as agents coordinate across teams']} />
          <PipelineView persona="program"  />
        </div>
      )}
      {activeSection === 'history' && <ProgramHistoryContent />}
    </UnifiedPersonaLayout>
  );
}

export default ProgramHub;
