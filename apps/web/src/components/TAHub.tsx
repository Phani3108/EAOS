/**
 * TAHub — Talent Acquisition AI workspace inside AgentOS
 * 4-tab layout: Skills (execution) → Library → Pipelines → History
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */
'use client';

import { useState, useEffect, useRef } from 'react';
import { useTAStore, type PersonaExecutionStep } from '../store/persona-store';
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

const TA_TOOL_DEFS: { id: string; name: string; icon: string; connectorId: string }[] = [
  { id: 'claude', name: 'Claude', icon: '🤖', connectorId: 'anthropic' },
  { id: 'linkedin', name: 'LinkedIn', icon: '🔗', connectorId: 'linkedin-ads' },
  { id: 'slack', name: 'Slack', icon: '💬', connectorId: 'slack' },
  { id: 'google-drive', name: 'Google Drive', icon: '📁', connectorId: 'google-drive' },
  { id: 'confluence', name: 'Confluence', icon: '📚', connectorId: 'confluence' },
];

function useTAToolStatus(): Record<string, SkillToolRef> {
  const isToolConnected = useConnectionsStore(s => s.isToolConnected);
  const result: Record<string, SkillToolRef> = {};
  for (const tool of TA_TOOL_DEFS) {
    result[tool.id] = { id: tool.id, name: tool.name, icon: tool.icon, connected: isToolConnected(tool.connectorId) };
  }
  return result;
}

// ── Seed skills for demo ────────────────────────────────────
const DEMO_SKILLS: SkillDef[] = [
  { id: 'ta-001', slug: 'jd-generator', name: 'Job Description Generator', description: 'Generate a comprehensive, DEI-optimized JD from a hiring brief.', icon: '📄', cluster: 'Requisition', complexity: 'moderate', estimatedTime: '30–60s',
    inputs: [{ id: 'role_title', label: 'Role Title', type: 'text', required: true, section: 'basic', placeholder: 'e.g. Senior Backend Engineer' }, { id: 'hiring_brief', label: 'Hiring Brief', type: 'textarea', required: true, section: 'basic', placeholder: 'Describe the role...' }],
    steps: [{ id: 's1', order: 1, name: 'Analyze Brief', agent: 'JD Specialist', outputKey: 'analysis' }, { id: 's2', order: 2, name: 'Generate JD', agent: 'JD Specialist', outputKey: 'jd' }, { id: 's3', order: 3, name: 'DEI Review', agent: 'Inclusion Reviewer', outputKey: 'dei_review', requiresApproval: true }],
    outputs: ['analysis', 'jd', 'dei_review'], requiredTools: ['Claude'], optionalTools: ['Confluence'], tags: ['jd', 'hiring'] },
  { id: 'ta-003', slug: 'resume-screener', name: 'Resume Screening & Ranking', description: 'Score and rank resumes against requirements. Detect red flags and bias patterns.', icon: '📑', cluster: 'Screening', complexity: 'moderate', estimatedTime: '45–90s',
    inputs: [{ id: 'role_title', label: 'Role', type: 'text', required: true, section: 'basic' }, { id: 'must_haves', label: 'Must-Haves', type: 'textarea', required: true, section: 'basic' }],
    steps: [{ id: 's1', order: 1, name: 'Parse Resumes', agent: 'Resume Parser', outputKey: 'parsed' }, { id: 's2', order: 2, name: 'Score', agent: 'Candidate Matcher', outputKey: 'scores' }, { id: 's3', order: 3, name: 'Shortlist', agent: 'Candidate Matcher', outputKey: 'shortlist', requiresApproval: true }],
    outputs: ['parsed', 'scores', 'shortlist'], requiredTools: ['Claude'], optionalTools: ['LinkedIn'], tags: ['screening', 'resume'] },
  { id: 'ta-005', slug: 'interview-kit', name: 'Interview Kit Generator', description: 'Generate a structured interview kit with questions, rubrics, and interviewer guide.', icon: '🎤', cluster: 'Interview', complexity: 'moderate', estimatedTime: '30–60s',
    inputs: [{ id: 'role_title', label: 'Role', type: 'text', required: true, section: 'basic' }, { id: 'round', label: 'Round', type: 'text', required: true, section: 'basic' }],
    steps: [{ id: 's1', order: 1, name: 'Design Questions', agent: 'Interview Designer', outputKey: 'questions' }, { id: 's2', order: 2, name: 'Create Rubric', agent: 'Interview Designer', outputKey: 'rubric' }, { id: 's3', order: 3, name: 'Interviewer Guide', agent: 'Interview Designer', outputKey: 'guide' }],
    outputs: ['questions', 'rubric', 'guide'], requiredTools: ['Claude'], optionalTools: [], tags: ['interview'] },
  { id: 'ta-006', slug: 'interview-debrief', name: 'Interview Debrief Synthesizer', description: 'Synthesize interviewer feedback into structured debrief with recommendation.', icon: '📋', cluster: 'Evaluation', complexity: 'complex', estimatedTime: '45–90s',
    inputs: [{ id: 'candidate_name', label: 'Candidate', type: 'text', required: true, section: 'basic' }, { id: 'feedback', label: 'Feedback', type: 'textarea', required: true, section: 'basic' }],
    steps: [{ id: 's1', order: 1, name: 'Structure Feedback', agent: 'Debrief Analyst', outputKey: 'structured' }, { id: 's2', order: 2, name: 'Bias Check', agent: 'Bias Checker', outputKey: 'bias' }, { id: 's3', order: 3, name: 'Recommendation', agent: 'Debrief Analyst', outputKey: 'recommendation', requiresApproval: true }],
    outputs: ['structured', 'bias', 'recommendation'], requiredTools: ['Claude'], optionalTools: [], tags: ['debrief'] },
  { id: 'ta-008', slug: 'talent-market-analysis', name: 'Talent Market Analysis', description: 'Analyze talent availability, salary benchmarks, and sourcing strategy.', icon: '📈', cluster: 'Intelligence', complexity: 'complex', estimatedTime: '60–120s',
    inputs: [{ id: 'role_title', label: 'Role', type: 'text', required: true, section: 'basic' }, { id: 'location', label: 'Location', type: 'text', required: true, section: 'basic' }],
    steps: [{ id: 's1', order: 1, name: 'Supply Analysis', agent: 'Market Analyst', outputKey: 'supply' }, { id: 's2', order: 2, name: 'Comp Benchmark', agent: 'Market Analyst', outputKey: 'comp' }, { id: 's3', order: 3, name: 'Sourcing Strategy', agent: 'Market Analyst', outputKey: 'strategy' }],
    outputs: ['supply', 'comp', 'strategy'], requiredTools: ['Claude'], optionalTools: ['LinkedIn'], tags: ['market', 'sourcing'] },
];

// ── Command Center ──────────────────────────────────────────
function TACommandCenter() {
  const toolStatus = useTAToolStatus();
  const [skills, setSkills] = useState<SkillDef[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<SkillDef | null>(null);
  const [executing, setExecuting] = useState(false);
  const [isDemo, setIsDemo] = useState(false);
  const activeExecution = useTAStore((s: any) => s.activeExecution);
  const addExecution = useTAStore((s: any) => s.addExecution);
  const updateExecution = useTAStore((s: any) => s.updateExecution);
  const updateExecutionStep = useTAStore((s: any) => s.updateExecutionStep);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch(`${GATEWAY_URL}/api/ta/skills`).then(r => r.json())
      .then(d => { if (d.skills?.length) setSkills(d.skills); else { setSkills(DEMO_SKILLS); setIsDemo(true); } })
      .catch(() => { setSkills(DEMO_SKILLS); setIsDemo(true); });
  }, []);

  // Poll execution status
  useEffect(() => {
    if (!activeExecution || isTerminalExecutionStatus(activeExecution.status)) { if (pollRef.current) clearInterval(pollRef.current); return; }
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${GATEWAY_URL}/api/ta/executions/${activeExecution.id}`);
        const data = await r.json();
        if (data.execution) {
          updateExecution(activeExecution.id, { status: data.execution.status, steps: data.execution.steps, outputs: data.execution.outputs, completedAt: data.execution.completedAt });
        }
      } catch {}
    }, POLL_INTERVAL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [activeExecution?.id, activeExecution?.status, updateExecution]);

  const handleExecute = async (inputs: Record<string, unknown>, simulate: boolean, customPrompt?: string, modelId?: string, provider?: string) => {
    if (!selectedSkill) return;
    setExecuting(true);
    try {
      // Canonical path (was /api/ta/executions, which skipped the shared validation and run mode).
      const execution = await submitExecution({
        persona: 'ta', skillId: selectedSkill.id, inputs, simulate, customPrompt,
        provider: provider as ExecutionRequest['provider'], modelId,
      });
      addExecution({ id: execution.id, persona: 'ta', skillId: selectedSkill.id, skillName: selectedSkill.name, status: execution.status, steps: execution.steps || [], outputs: {}, startedAt: execution.startedAt });
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
      {isDemo && <DemoPreviewBanner pageName="TA Skills" steps={['Start the gateway to load talent acquisition skills', 'Select a skill (JD Generator, Resume Screener, Interview Kit, etc.)', 'Configure inputs and execute — agents handle the rest']} />}

      {phase === 'pick' && (
        <div>
          <h2 className="text-lg font-bold text-slate-900 mb-4">Select a Skill</h2>
          <div className="grid grid-cols-2 gap-3">
            {skills.map(s => (
              <button key={s.id} onClick={() => setSelectedSkill(s)} className="card p-4 text-left hover:border-emerald-500 transition-all">
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
          <PersonaWorkflowForm fields={selectedSkill.inputs} tools={Object.values(toolStatus)} persona="hr" accentClass="bg-emerald-600" accentHoverClass="hover:bg-emerald-700" onExecute={handleExecute} onCancel={() => setSelectedSkill(null)} executing={executing} />
        </div>
      )}

      {phase === 'running' && activeExecution && (
        <ExecutionTimeline workflowName={activeExecution.skillName} status={activeExecution.status} steps={activeExecution.steps.map((s: any) => ({ stepId: s.stepId, stepName: s.stepName, agent: s.agent, status: s.status, startedAt: s.startedAt, completedAt: s.completedAt, outputPreview: s.outputPreview }))} />
      )}

      {phase === 'output' && activeExecution && (
        <div>
          <div className={`rounded-xl p-4 mb-4 ${succeeded ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
            <h3 className={`text-sm font-bold ${succeeded ? 'text-emerald-800' : 'text-red-800'}`}>
              {activeExecution.status === 'simulated' ? 'Completed · Simulated' : succeeded ? 'Completed' : `Run ${activeExecution.status}`}
            </h3>
            <p className="text-xs text-slate-600 mt-1">{activeExecution.skillName} &middot; {activeExecution.steps.length} steps</p>
          </div>
          <button onClick={() => { updateExecution(activeExecution.id, {}); setSelectedSkill(null); }} className="btn btn-secondary btn-sm">Run Another Skill</button>
        </div>
      )}
    </div>
  );
}

// ── Skills Content (wraps CommandCenter) ─────────────────────
function TASkillsContent() { return <TACommandCenter />; }

// ── Library ──────────────────────────────────────────────────
function TALibraryContent() {
  const [tab, setTab] = useState<'skills' | 'prompts' | 'agents'>('skills');
  return (
    <div>
      <div className="flex border-b border-slate-200 px-6 pt-4">
        {(['skills', 'prompts', 'agents'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors capitalize ${tab === t ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {t === 'skills' ? '⚡ Skills' : t === 'prompts' ? '✨ Prompts' : '🤖 Agents'}
          </button>
        ))}
      </div>
      {tab === 'skills' && <div className="p-6"><p className="text-sm text-slate-500">Browse TA skills in the Run tab or view the full skill catalog.</p></div>}
      {tab === 'prompts' && <PromptLibrary personaFilter={"hr" as any} />}
      {tab === 'agents' && <AgentsPanel personaFilter={"HR" as any} />}
    </div>
  );
}

// ── History ──────────────────────────────────────────────────
function TAHistoryContent() {
  const executions = useTAStore((s: any) => s.executions);
  const mapped: OutputExecution[] = executions.map((e: any) => ({ id: e.id, skillName: e.skillName, status: e.status, steps: e.steps, outputs: e.outputs, startedAt: e.startedAt, completedAt: e.completedAt }));
  if (mapped.length === 0) return (
    <div className="p-6">
      <DemoPreviewBanner pageName="TA History" steps={['Execute a TA skill (JD Generator, Resume Screener, etc.)', 'Completed executions appear here with full output and quality scores', 'Compare results across different runs and export reports']} />
    </div>
  );
  return <OutputsView executions={mapped} accentColor="emerald" />;
}

// ── Main Hub ─────────────────────────────────────────────────
export function TAHub() {
  const activeSection = useTAStore((s: any) => s.activeSection);
  const setActiveSection = useTAStore((s: any) => s.setActiveSection);

  return (
    <UnifiedPersonaLayout persona="Talent Acquisition" accentColor="bg-emerald-600" activeSection={activeSection} onSectionChange={(s) => setActiveSection(s)}>
      {activeSection === 'run' && <TASkillsContent />}
      {activeSection === 'library' && <TALibraryContent />}
      {activeSection === 'pipelines' && (
        <div className="p-6">
          <DemoPreviewBanner pageName="TA Pipelines" steps={['Execute multi-step hiring workflows (JD → Scorecard → Interview Kit)', 'Pipeline DAG visualization shows step dependencies and approval gates', 'Track live progress as agents execute each stage']} />
          <PipelineView persona="ta"  />
        </div>
      )}
      {activeSection === 'history' && <TAHistoryContent />}
    </UnifiedPersonaLayout>
  );
}

export default TAHub;
