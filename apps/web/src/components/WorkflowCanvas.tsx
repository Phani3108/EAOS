/**
 * WorkflowCanvas — Cross-functional workflow launcher.
 * Browse flagship workflow templates, visualize their DAG, supply inputs, and
 * run them via POST /api/workflows/flagship/:id/run. Steps execute in order;
 * requiresApproval steps pause on the approval bus. Live step progress is shown.
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */
'use client';

import { useState, useEffect } from 'react';
import { useEAOSStore } from '../store/eaos-store';
import DemoPreviewBanner from './shared/DemoPreviewBanner';

const API = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000';

// ── SevenLabs Demo Workflows ────────────────────────────────
const DEMO_WORKFLOWS: WorkflowTemplate[] = [
  { id: 'fw-d1', slug: 'prd-to-jira', name: 'PRD \u2192 Jira Decomposition', description: 'Take a product brief, generate a full PRD, decompose into epics/stories, create in Jira.', icon: '\ud83d\udce6', type: 'cross-functional', personas: ['product', 'engineering'], complexity: 'complex', estimatedTime: '3\u20135 min',
    inputs: [{ id: 'brief', label: 'Product Brief', type: 'textarea', required: true, placeholder: 'Describe the feature...' }],
    steps: [
      { id: 's1', name: 'Analyze Brief', agent: 'Captain Odin', agentPersona: 'Product', tool: 'Claude', outputKey: 'analysis', description: 'Parse brief, identify user problems and goals' },
      { id: 's2', name: 'Generate PRD', agent: 'Captain Odin', agentPersona: 'Product', tool: 'Claude', outputKey: 'prd', description: 'Full PRD with requirements and edge cases', dependsOn: ['s1'] },
      { id: 's3', name: 'Tech Feasibility', agent: 'Captain Prometheus', agentPersona: 'Engineering', tool: 'Claude', outputKey: 'review', description: 'Review for technical feasibility', dependsOn: ['s2'] },
      { id: 's4', name: 'Decompose Epics', agent: 'Corporal Freya', agentPersona: 'Product', tool: 'Claude', outputKey: 'epics', description: 'Break into 3-5 epics', dependsOn: ['s2', 's3'] },
      { id: 's5', name: 'Create Jira', agent: 'Corporal Mercury', agentPersona: 'Engineering', tool: 'Jira', outputKey: 'tickets', description: 'Create tickets in Jira', requiresApproval: true, dependsOn: ['s4'] },
    ],
    outputs: ['analysis', 'prd', 'review', 'epics', 'tickets'], tools: ['Claude', 'Jira'], tags: ['prd', 'jira'] },
  { id: 'fw-d2', slug: 'incident-rca', name: 'Incident RCA Swarm', description: 'Triage, investigate, remediate, and produce root cause analysis for production incidents.', icon: '\ud83d\udea8', type: 'cross-functional', personas: ['engineering', 'program'], complexity: 'critical', estimatedTime: '5\u201310 min',
    inputs: [{ id: 'incident', label: 'Incident Description', type: 'textarea', required: true, placeholder: 'What happened?' }],
    steps: [
      { id: 's1', name: 'Triage', agent: 'Colonel Atlas', agentPersona: 'Engineering', tool: 'Claude', outputKey: 'triage', description: 'Classify severity and blast radius' },
      { id: 's2', name: 'Log Analysis', agent: 'Sergeant Vulcan', agentPersona: 'Engineering', tool: 'DataDog', outputKey: 'logs', description: 'Pull relevant logs and metrics', dependsOn: ['s1'] },
      { id: 's3', name: 'Remediation', agent: 'Captain Prometheus', agentPersona: 'Engineering', tool: 'Claude', outputKey: 'fix', description: 'Propose and execute fix', requiresApproval: true, dependsOn: ['s2'] },
      { id: 's4', name: 'RCA Document', agent: 'Colonel Atlas', agentPersona: 'Engineering', tool: 'Confluence', outputKey: 'rca', description: 'Full root cause analysis', dependsOn: ['s3'] },
    ],
    outputs: ['triage', 'logs', 'fix', 'rca'], tools: ['Claude', 'DataDog', 'Confluence'], tags: ['incident', 'rca'] },
  { id: 'fw-d3', slug: 'campaign-launch', name: 'Campaign Launch Pod', description: 'Strategy through execution: audience, messaging, content, channel setup, and tracking.', icon: '\ud83d\udce3', type: 'cross-functional', personas: ['marketing', 'product'], complexity: 'complex', estimatedTime: '5\u20138 min',
    inputs: [{ id: 'goal', label: 'Campaign Goal', type: 'textarea', required: true, placeholder: 'What are you trying to achieve?' }],
    steps: [
      { id: 's1', name: 'Strategy', agent: 'Colonel Hyperion', agentPersona: 'Marketing', tool: 'Claude', outputKey: 'strategy', description: 'Campaign objectives and channel strategy' },
      { id: 's2', name: 'Content Creation', agent: 'Captain Apollo', agentPersona: 'Marketing', tool: 'Claude', outputKey: 'content', description: 'Email, ads, landing page copy', dependsOn: ['s1'] },
      { id: 's3', name: 'Channel Setup', agent: 'Captain Iris', agentPersona: 'Marketing', tool: 'HubSpot', outputKey: 'channels', description: 'Configure in HubSpot', requiresApproval: true, dependsOn: ['s2'] },
    ],
    outputs: ['strategy', 'content', 'channels'], tools: ['Claude', 'HubSpot'], tags: ['campaign', 'marketing'] },
  { id: 'fw-d4', slug: 'hiring-pipeline', name: 'Hiring Pipeline', description: 'End-to-end hiring: JD, scorecard, interview kits, and debrief synthesis.', icon: '\ud83d\udc65', type: 'cross-functional', personas: ['ta', 'engineering', 'hr'], complexity: 'complex', estimatedTime: '5\u20138 min',
    inputs: [{ id: 'role', label: 'Role Title', type: 'text', required: true, placeholder: 'e.g. Senior Backend Engineer' }],
    steps: [
      { id: 's1', name: 'Generate JD', agent: 'JD Specialist', agentPersona: 'TA', tool: 'Claude', outputKey: 'jd', description: 'DEI-optimized job description' },
      { id: 's2', name: 'Scorecard', agent: 'Scorecard Analyst', agentPersona: 'TA', tool: 'Claude', outputKey: 'scorecard', description: 'Competency rubric', dependsOn: ['s1'] },
      { id: 's3', name: 'Interview Kit', agent: 'Interview Designer', agentPersona: 'TA', tool: 'Claude', outputKey: 'kit', description: 'Questions and evaluation guide', dependsOn: ['s2'] },
      { id: 's4', name: 'Compliance Check', agent: 'Colonel Rhea', agentPersona: 'HR', tool: 'Claude', outputKey: 'compliance', description: 'HR policy verification', requiresApproval: true, dependsOn: ['s1'] },
    ],
    outputs: ['jd', 'scorecard', 'kit', 'compliance'], tools: ['Claude'], tags: ['hiring', 'ta'] },
  { id: 'fw-d5', slug: 'launch-readiness', name: 'Launch Readiness Board', description: 'Multi-function go/no-go: Engineering, Product, Marketing, Program all assess readiness.', icon: '\ud83d\ude80', type: 'cross-functional', personas: ['program', 'engineering', 'product', 'marketing'], complexity: 'complex', estimatedTime: '5\u201310 min',
    inputs: [{ id: 'launch', label: 'Launch Name', type: 'text', required: true, placeholder: 'e.g. Card Modernization v2' }],
    steps: [
      { id: 's1', name: 'Eng Readiness', agent: 'Colonel Atlas', agentPersona: 'Engineering', tool: 'Claude', outputKey: 'eng', description: 'Code, tests, deployment plan' },
      { id: 's2', name: 'Product Readiness', agent: 'Colonel Themis', agentPersona: 'Product', tool: 'Claude', outputKey: 'prod', description: 'Feature scope, docs' },
      { id: 's3', name: 'Marketing Readiness', agent: 'Colonel Hyperion', agentPersona: 'Marketing', tool: 'Claude', outputKey: 'mkt', description: 'Campaign assets, enablement' },
      { id: 's4', name: 'Go/No-Go', agent: 'Colonel Chronos', agentPersona: 'Program', tool: 'Claude', outputKey: 'decision', description: 'Confidence score and recommendation', requiresApproval: true, dependsOn: ['s1', 's2', 's3'] },
    ],
    outputs: ['eng', 'prod', 'mkt', 'decision'], tools: ['Claude', 'Jira'], tags: ['launch', 'readiness'] },
];

// ── Types ───────────────────────────────────────────────────────
interface WorkflowStep {
  id: string; name: string; agent: string; agentPersona: string; tool?: string;
  outputKey: string; description: string; requiresApproval?: boolean; dependsOn?: string[];
}
interface WorkflowTemplate {
  id: string; slug: string; name: string; description: string; icon: string;
  type: string; personas: string[]; complexity: string; estimatedTime: string;
  inputs: { id: string; label: string; type: string; required?: boolean; placeholder?: string }[];
  steps: WorkflowStep[]; outputs: string[]; tools: string[]; tags: string[];
}

const PERSONA_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  engineering: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  marketing: { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
  product: { bg: 'bg-violet-50', text: 'text-violet-700', dot: 'bg-violet-500' },
  hr: { bg: 'bg-pink-50', text: 'text-pink-700', dot: 'bg-pink-500' },
  ta: { bg: 'bg-rose-50', text: 'text-rose-700', dot: 'bg-rose-500' },
  program: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
};

const COMPLEXITY_BADGE: Record<string, string> = {
  moderate: 'badge-info', complex: 'badge-warning', critical: 'badge-danger',
};

// ═══════════════════════════════════════════════════════════════
export default function WorkflowCanvas() {
  const setActiveSection = useEAOSStore(s => s.setActiveSection);
  const [workflows, setWorkflows] = useState<WorkflowTemplate[]>([]);
  const [selected, setSelected] = useState<WorkflowTemplate | null>(null);
  const [filterPersona, setFilterPersona] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [exec, setExec] = useState<{ id: string; status: string; steps: { stepName?: string; name?: string; status: string }[] } | null>(null);

  useEffect(() => {
    fetch(`${API}/api/workflows/flagship`)
      .then(r => r.json())
      .then(d => {
        if (d.workflows?.length) { setWorkflows(d.workflows); setSelected(d.workflows[0]); }
        else { setWorkflows(DEMO_WORKFLOWS); setSelected(DEMO_WORKFLOWS[0]); setIsDemo(true); }
      })
      .catch(() => { setWorkflows(DEMO_WORKFLOWS); setSelected(DEMO_WORKFLOWS[0]); setIsDemo(true); });
  }, []);

  // Reset the run form/state when a different template is selected.
  useEffect(() => { setInputs({}); setExec(null); setRunError(null); setRunning(false); }, [selected?.id]);

  const runWorkflow = async () => {
    if (!selected) return;
    setRunning(true); setRunError(null); setExec(null);
    try {
      const res = await fetch(`${API}/api/workflows/flagship/${selected.id}/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs }),
      });
      if (!res.ok) throw new Error(`Run failed (${res.status})`);
      const { execution } = await res.json();
      const id = execution.id as string;
      setExec({ id, status: execution.status, steps: execution.steps ?? [] });
      const poll = setInterval(async () => {
        try {
          const e = await fetch(`${API}/api/executions/${id}`).then(r => r.json()).then(d => d.execution);
          if (!e) return;
          setExec({ id, status: e.status, steps: e.steps ?? [] });
          if (['completed', 'failed'].includes(e.status)) { clearInterval(poll); setRunning(false); }
        } catch { /* keep polling */ }
      }, 1500);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Run failed'); setRunning(false);
    }
  };

  const filtered = filterPersona
    ? workflows.filter(w => w.personas.includes(filterPersona))
    : workflows;

  const allPersonas = Array.from(new Set(workflows.flatMap(w => w.personas)));

  return (
    <div className="page-container">
      <div className="page-content">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="page-title">Workflow Canvas</h1>
            <p className="page-subtitle">Browse cross-functional workflows, visualize their DAG, supply inputs, and run them end-to-end</p>
          </div>
          <button onClick={() => setActiveSection('platform-skills')} className="btn btn-secondary btn-sm">
            Open Skill Library
          </button>
        </div>

        {isDemo && <DemoPreviewBanner pageName="Workflow Canvas" steps={[
          'Start the gateway to load live workflows and enable Run',
          'Select a workflow to visualize its step-by-step DAG with agent assignments',
          'Fill the inputs and click Run Workflow to execute it (steps run in order; approval gates pause)',
        ]} />}

        {/* Persona filter */}
        <div className="flex gap-1.5 mb-5">
          <button onClick={() => setFilterPersona(null)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${!filterPersona ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            All ({workflows.length})
          </button>
          {allPersonas.map(p => (
            <button key={p} onClick={() => setFilterPersona(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize ${filterPersona === p ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              {p}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* Left — Workflow list */}
          <div className="col-span-1 space-y-3">
            {filtered.map(wf => (
              <button key={wf.id} onClick={() => setSelected(wf)}
                className={`card p-4 w-full text-left transition-all ${selected?.id === wf.id ? 'border-blue-500 shadow-md' : ''}`}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{wf.icon}</span>
                  <span className="text-sm font-semibold text-slate-900">{wf.name}</span>
                </div>
                <p className="text-xs text-slate-500 mb-2 line-clamp-2">{wf.description}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`badge ${COMPLEXITY_BADGE[wf.complexity] || 'badge-neutral'}`}>{wf.complexity}</span>
                  <span className="text-[10px] text-slate-400">{wf.estimatedTime}</span>
                  {wf.personas.map(p => {
                    const c = PERSONA_COLORS[p] || PERSONA_COLORS.engineering;
                    return <span key={p} className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${c.bg} ${c.text}`}>{p}</span>;
                  })}
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="card p-8 text-center text-sm text-slate-400">No workflows match the filter.</div>
            )}
          </div>

          {/* Right — Workflow detail + DAG visualization */}
          <div className="col-span-2">
            {selected ? (
              <div className="space-y-5">
                {/* Header card */}
                <div className="card p-6">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">{selected.icon}</span>
                      <div>
                        <h2 className="text-lg font-bold text-slate-900">{selected.name}</h2>
                        <p className="text-sm text-slate-500">{selected.description}</p>
                      </div>
                    </div>
                    <button onClick={() => setActiveSection('platform-skills')} className="btn btn-secondary btn-sm">
                      Skill Library
                    </button>
                  </div>
                  <div className="flex items-center gap-4 mt-4 text-xs text-slate-500">
                    <span><strong>Type:</strong> {selected.type}</span>
                    <span><strong>Complexity:</strong> {selected.complexity}</span>
                    <span><strong>Time:</strong> {selected.estimatedTime}</span>
                    <span><strong>Steps:</strong> {selected.steps.length}</span>
                    <span><strong>Tools:</strong> {selected.tools.join(', ')}</span>
                  </div>
                </div>

                {/* DAG Visualization */}
                <div className="card p-6">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Workflow DAG</h3>
                  <div className="space-y-1">
                    {selected.steps.map((step, i) => {
                      const colors = PERSONA_COLORS[step.agentPersona.toLowerCase()] || PERSONA_COLORS.engineering;
                      const hasDeps = step.dependsOn && step.dependsOn.length > 0;
                      return (
                        <div key={step.id} className="flex gap-4">
                          {/* Step number + connector */}
                          <div className="flex flex-col items-center w-8">
                            <div className={`w-7 h-7 rounded-full ${colors.dot} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
                              {i + 1}
                            </div>
                            {i < selected.steps.length - 1 && (
                              <div className="w-px flex-1 bg-slate-200 my-1" />
                            )}
                          </div>

                          {/* Step card */}
                          <div className={`flex-1 rounded-xl border p-4 mb-2 ${step.requiresApproval ? 'border-amber-300 bg-amber-50/30' : 'border-slate-200 bg-white'}`}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-slate-900">{step.name}</span>
                                {step.requiresApproval && (
                                  <span className="badge badge-warning text-[9px]">Approval Gate</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${colors.bg} ${colors.text}`}>
                                  {step.agent}
                                </span>
                                {step.tool && (
                                  <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{step.tool}</span>
                                )}
                              </div>
                            </div>
                            <p className="text-xs text-slate-500">{step.description}</p>
                            {hasDeps && (
                              <p className="text-[10px] text-slate-400 mt-1">
                                Depends on: {step.dependsOn!.map(d => {
                                  const depStep = selected.steps.find(s => s.id === d);
                                  return depStep ? depStep.name : d;
                                }).join(', ')}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Inputs + Run */}
                <div className="card p-6">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Inputs</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {selected.inputs.map(inp => (
                      <div key={inp.id} className={inp.type === 'textarea' ? 'col-span-2' : ''}>
                        <label className="flex items-center gap-2 mb-1 text-sm font-medium text-slate-700">
                          {inp.label}
                          {inp.required && <span className="text-slate-400 text-xs">(required)</span>}
                        </label>
                        {inp.type === 'textarea' ? (
                          <textarea
                            value={inputs[inp.id] ?? ''}
                            onChange={e => setInputs(v => ({ ...v, [inp.id]: e.target.value }))}
                            rows={3}
                            placeholder={inp.placeholder || ''}
                            className="w-full text-sm rounded-lg bg-white border border-slate-200 px-3 py-2 text-slate-900 outline-none focus:border-blue-400 resize-y"
                          />
                        ) : (
                          <input
                            value={inputs[inp.id] ?? ''}
                            onChange={e => setInputs(v => ({ ...v, [inp.id]: e.target.value }))}
                            type="text"
                            placeholder={inp.placeholder || ''}
                            className="w-full text-sm rounded-lg bg-white border border-slate-200 px-3 py-2 text-slate-900 outline-none focus:border-blue-400"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-3 mt-4 flex-wrap">
                    <button onClick={runWorkflow} disabled={running || isDemo} className="btn btn-primary disabled:opacity-40">
                      {running ? 'Running…' : '▶ Run Workflow'}
                    </button>
                    {isDemo && <span className="text-xs text-amber-600">Start the gateway to run live workflows.</span>}
                    {runError && <span className="text-xs text-red-600">{runError}</span>}
                    {exec && <span className="text-xs text-slate-500">Execution status: <span className="font-medium text-slate-700">{exec.status}</span></span>}
                  </div>
                  {exec && exec.steps.length > 0 && (
                    <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3">
                      {exec.steps.map((s, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.status === 'completed' ? 'bg-emerald-500' : s.status === 'running' ? 'bg-blue-500 animate-pulse' : s.status === 'approval_required' ? 'bg-amber-500' : s.status === 'failed' ? 'bg-red-500' : 'bg-slate-300'}`} />
                          <span className="text-slate-600">{s.stepName ?? s.name}</span>
                          <span className="ml-auto text-[10px] text-slate-400 capitalize">{(s.status || '').replace(/_/g, ' ')}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Outputs */}
                <div className="card p-6">
                  <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Expected Outputs</h3>
                  <div className="flex flex-wrap gap-2">
                    {selected.outputs.map(out => (
                      <span key={out} className="badge badge-success text-[10px]">{out.replace(/_/g, ' ')}</span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="card p-12 text-center">
                <span className="text-4xl block mb-4">🔄</span>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Select a Workflow Template</h3>
                <p className="text-sm text-slate-500">Choose a cross-functional workflow template to visualize its step-by-step DAG.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
