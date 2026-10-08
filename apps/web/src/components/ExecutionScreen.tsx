/**
 * ExecutionScreen — The core work surface of AgentOS.
 * Three phases: Configure → Execute (with live timeline) → Output (with export).
 * Generic — works with any persona/skill. The frontend's "money screen."
 */
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useExecutionStore, type SkillDefinition, type Execution, type PreCheckResult } from '../store/execution-store';
import { useConnectionsStore, resolveConnectorId } from '../store/connections-store';
import { useEAOSStore } from '../store/eaos-store';
import { OutputViewer } from './OutputViewer';
import { isTerminalExecutionStatus, type WorkflowPersona } from '@agentos/skills/schema';
import { fetchExecution, submitExecution, uploadArtifact } from '../lib/execution-client';

const GATEWAY = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000';
const POLL_MS = 2000;

// ── Step status styling ────────────────────────────────────────────────────

const STEP_DOT: Record<string, string> = {
  pending:           'bg-slate-300',
  running:           'bg-blue-500 animate-pulse',
  completed:         'bg-emerald-500',
  failed:            'bg-red-500',
  rejected: 'bg-red-500', cancelled: 'bg-slate-500', unsupported: 'bg-amber-500', inconclusive: 'bg-amber-500', simulated: 'bg-purple-500',
  approval_required: 'bg-amber-500',
  skipped:           'bg-slate-300',
};

const STEP_TEXT: Record<string, string> = {
  pending:           'text-slate-400',
  running:           'text-blue-600 font-medium',
  completed:         'text-emerald-700',
  failed:            'text-red-600',
  rejected: 'text-red-600', cancelled: 'text-slate-500', unsupported: 'text-amber-600', inconclusive: 'text-amber-600', simulated: 'text-purple-600',
  approval_required: 'text-amber-600',
  skipped:           'text-slate-400 line-through',
};

const STEP_LABEL: Record<string, string> = {
  pending:           'Queued',
  running:           'Running…',
  completed:         'Complete',
  failed:            'Failed',
  rejected: 'Rejected', cancelled: 'Cancelled', unsupported: 'Unsupported', inconclusive: 'Inconclusive', simulated: 'Simulated',
  approval_required: 'Needs approval',
  skipped:           'Skipped',
};

// ── Component ──────────────────────────────────────────────────────────────

interface Props {
  persona: string;
  workspace: string;
  /** If provided, resumes/views an existing execution */
  executionId?: string;
  /** Called when user navigates back */
  onBack?: () => void;
}

export function ExecutionScreen({ persona, workspace, onBack }: Props) {
  const {
    activeExecution,
    selectedSkill,
    availableSkills,
    setSelectedSkill,
    setAvailableSkills,
    createExecution,
    updateExecution,
    updateStep,
    clearActive,
  } = useExecutionStore();

  const isToolConnected = useConnectionsStore(s => s.isToolConnected);

  // Phase: 'pick' → 'configure' → 'running' → 'output'
  const phase = !selectedSkill && !activeExecution ? 'pick'
    : selectedSkill && !activeExecution ? 'configure'
    : activeExecution && ['running', 'queued', 'paused'].includes(activeExecution.status) ? 'running'
    : activeExecution && isTerminalExecutionStatus(activeExecution.status) ? 'output'
    : 'configure';

  // ── Load available skills for this persona ───────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${GATEWAY}/api/${persona}/skills`);
        if (res.ok) {
          const data = await res.json();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const raw: any[] = data.skills ?? data ?? [];
          const skills: SkillDefinition[] = raw.map((s) => ({
            id: s.id ?? s.skill_id ?? s.slug,
            name: s.name ?? s.title,
            description: s.description ?? '',
            persona,
            category: s.category ?? s.cluster ?? '',
            requiredTools: s.requiredTools ?? s.tools ?? [],
            steps: (s.steps ?? []).map((st: any, i: number) => ({
              id: st.id ?? st.stepId ?? `step-${i + 1}`,
              name: st.name ?? st.stepName ?? `Step ${i + 1}`,
              agent: st.agent ?? 'default',
              tool: st.tool,
              outputKey: st.outputKey ?? st.output_key,
              requiresApproval: st.requiresApproval ?? false,
              description: st.description ?? '',
            })),
            support: s.support,
            inputFields: (s.inputFields ?? s.inputs ?? s.fields ?? []).map((f: any) => ({
              key: f.key ?? f.id ?? f.name,
              label: f.label ?? f.key ?? f.name,
              type: f.type ?? 'text',
              placeholder: f.placeholder ?? '',
              required: f.required ?? false,
              multiple: f.multiple ?? false,
              hint: f.hint ?? f.helpText,
              options: f.options
                ? (Array.isArray(f.options) && typeof f.options[0] === 'string'
                    ? f.options.map((o: string) => ({ label: o, value: o }))
                    : f.options)
                : undefined,
            })),
            outputFormat: s.outputFormat,
            icon: s.icon,
            estimatedTime: s.estimatedTime ?? s.estimated_time,
            executableType: s.executableType ?? 'skill',
            promptIds: s.linkedPromptIds ?? s.promptIds ?? [],
            composedSkillIds: s.composedSkillIds ?? [],
          }));
          setAvailableSkills(skills);
        }
      } catch {
        // Gateway not reachable — use empty list
      }
    })();
  }, [persona, setAvailableSkills]);

  // ── Polling for running execution ────────────────────────────────────────
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const activeId = activeExecution?.id;
  const activeStatus = activeExecution?.status;
  useEffect(() => {
    if (!activeId || !activeStatus || !['running', 'queued', 'paused'].includes(activeStatus)) {
      stopPolling();
      return;
    }

    const poll = async () => {
      try {
        const exec = await fetchExecution(activeId);

        updateExecution(activeId, {
          status: exec.status,
          completedAt: exec.completedAt,
          outputs: exec.outputs ?? {},
        });

        for (const step of exec.steps ?? []) {
          updateStep(activeId, step.stepId, {
            status: step.status,
            startedAt: step.startedAt,
            completedAt: step.completedAt,
            outputPreview: step.outputPreview,
            error: step.error,
          });
        }

        if (isTerminalExecutionStatus(exec.status)) {
          stopPolling();
        }
      } catch { /* gateway unreachable — keep trying */ }
    };

    pollRef.current = setInterval(poll, POLL_MS);
    poll(); // immediate first poll
    return stopPolling;
  }, [activeId, activeStatus, updateExecution, updateStep, stopPolling]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleBack = () => {
    stopPolling();
    clearActive();
    onBack?.();
  };

  return (
    <div className="page-container">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-slate-400 mb-4">
        <button onClick={handleBack} className="hover:text-slate-700 transition-colors">
          {persona.charAt(0).toUpperCase() + persona.slice(1)}
        </button>
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        {selectedSkill || activeExecution ? (
          <>
            <button onClick={() => { clearActive(); }} className="hover:text-slate-700 transition-colors">Skills</button>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            <span className="text-slate-700 font-medium">{activeExecution?.skillName ?? selectedSkill?.name}</span>
          </>
        ) : (
          <span className="text-slate-700 font-medium">Skills</span>
        )}
      </div>

      {/* Phase: Pick a skill */}
      {phase === 'pick' && (
        <SkillPicker
          skills={availableSkills}
          persona={persona}
          onSelect={setSelectedSkill}
        />
      )}

      {/* Phase: Configure */}
      {phase === 'configure' && selectedSkill && (
        <ConfigurePanel
          skill={selectedSkill}
          persona={persona}
          workspace={workspace}
          isToolConnected={isToolConnected}
          onRun={(inputs, fileIds, simulate) => {
            const exec = createExecution({ persona, skill: selectedSkill, workspace, inputs, fileIds, simulate });
            if (fileIds?.length) {
              updateExecution(exec.id, { status: 'unsupported' });
              if (exec.steps[0]) updateStep(exec.id, exec.steps[0].stepId, { status: 'unsupported', error: 'Uploaded files require a tenant-scoped artifact binding before execution.' });
              return;
            }
            // Fire execution on gateway
            submitExecution({ persona: persona as WorkflowPersona, skillId: selectedSkill.id, inputs, simulate })
              .then(remote => {
                if (remote?.id) {
                  // Overwrite local ID with gateway's ID so polling works
                  updateExecution(exec.id, { id: remote.id, status: remote.status ?? 'queued' });
                }
              })
              .catch(() => {
                updateExecution(exec.id, { status: 'failed' });
              });
          }}
          onBack={() => setSelectedSkill(null)}
        />
      )}

      {/* Phase: Running / Output */}
      {(phase === 'running' || phase === 'output') && activeExecution && (
        <ExecutionView
          execution={activeExecution}
          onBack={handleBack}
          onRerun={() => {
            const skill = availableSkills.find(s => s.id === activeExecution.skillId);
            clearActive();
            if (skill) setSelectedSkill(skill);
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════

// ── Skill Picker ───────────────────────────────────────────────────────────

function SkillPicker({ skills, persona, onSelect }: {
  skills: SkillDefinition[];
  persona: string;
  onSelect: (skill: SkillDefinition) => void;
}) {
  const [search, setSearch] = useState('');
  const [pickerTab, setPickerTab] = useState<'all' | 'skills' | 'workflows'>('all');

  const filtered = skills.filter(s => {
    const matchesSearch = s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase());
    const matchesTab = pickerTab === 'all' ? true
      : pickerTab === 'skills' ? s.executableType !== 'workflow'
      : s.executableType === 'workflow';
    return matchesSearch && matchesTab;
  });

  const skillCount = skills.filter(s => s.executableType !== 'workflow').length;
  const workflowCount = skills.filter(s => s.executableType === 'workflow').length;

  // Group by category
  const grouped: Record<string, SkillDefinition[]> = {};
  filtered.forEach(s => {
    const cat = s.category || 'General';
    (grouped[cat] ??= []).push(s);
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-semibold text-slate-900">
            {persona.charAt(0).toUpperCase() + persona.slice(1)} Skills & Workflows
          </h1>
          <p className="text-[13px] text-slate-500 mt-1">
            Skills are atomic execution units. Workflows compose multiple skills into a pipeline.
          </p>
        </div>
      </div>

      {/* Picker tabs: All | Skills | Workflows */}
      <div className="flex items-center gap-1 mb-4 p-0.5 bg-slate-100 rounded-lg w-fit">
        {[
          { key: 'all' as const, label: 'All', count: skills.length },
          { key: 'skills' as const, label: '⚡ Skills', count: skillCount },
          { key: 'workflows' as const, label: '🔀 Workflows', count: workflowCount },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setPickerTab(t.key)}
            className={`px-3 py-1.5 text-[12px] font-medium rounded-md transition-colors ${
              pickerTab === t.key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label} <span className="text-[11px] text-slate-400 ml-0.5">{t.count}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          className="input pl-10 w-full max-w-md"
          placeholder={pickerTab === 'workflows' ? 'Search workflows…' : pickerTab === 'skills' ? 'Search skills…' : 'Search skills & workflows…'}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Skill cards */}
      {Object.entries(grouped).map(([category, catSkills]) => (
        <div key={category} className="mb-6">
          <h2 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">{category}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {catSkills.map(skill => (
              <button
                key={skill.id}
                onClick={() => onSelect(skill)}
                className="card p-4 text-left hover:border-blue-200 hover:shadow-sm transition-all group"
              >
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-lg ${
                    skill.executableType === 'workflow'
                      ? 'bg-purple-50 text-purple-600'
                      : 'bg-blue-50 text-blue-600'
                  }`}>
                    {skill.icon || (skill.executableType === 'workflow' ? '🔀' : '⚡')}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h3 className={`text-[14px] font-medium text-slate-900 transition-colors ${
                        skill.executableType === 'workflow' ? 'group-hover:text-purple-600' : 'group-hover:text-blue-600'
                      }`}>
                        {skill.name}
                      </h3>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        skill.executableType === 'workflow'
                          ? 'bg-purple-100 text-purple-600'
                          : 'bg-blue-100 text-blue-600'
                      }`}>
                        {skill.executableType === 'workflow' ? 'Workflow' : 'Skill'}
                      </span>
                    </div>
                    <p className="text-[12px] text-slate-500 mt-0.5 line-clamp-2">{skill.description}</p>
                    {skill.support && <p className="text-[11px] text-amber-700 mt-1">{skill.support.executionClass} · {skill.support.readiness} · vendor sandbox not certified</p>}
                    <div className="flex items-center gap-2 mt-2">
                      {skill.executableType === 'workflow' && skill.composedSkillIds && skill.composedSkillIds.length > 0 && (
                        <span className="text-[11px] text-purple-400">
                          {skill.composedSkillIds.length} skill{skill.composedSkillIds.length > 1 ? 's' : ''} composed
                        </span>
                      )}
                      {skill.requiredTools.length > 0 && (
                        <span className="text-[11px] text-slate-400">
                          {skill.requiredTools.length} tool{skill.requiredTools.length > 1 ? 's' : ''}
                        </span>
                      )}
                      {skill.steps.length > 0 && (
                        <span className="text-[11px] text-slate-400">
                          {skill.steps.length} step{skill.steps.length > 1 ? 's' : ''}
                        </span>
                      )}
                      {skill.estimatedTime && (
                        <span className="text-[11px] text-slate-400">~{skill.estimatedTime}</span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}

      {skills.length === 0 && (
        <div className="empty-state">
          <svg className="w-10 h-10 text-slate-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
          </svg>
          <p className="text-[13px] text-slate-500">No skills available for {persona}.</p>
          <p className="text-[12px] text-slate-400 mt-1">Connect tools and check the gateway is running.</p>
        </div>
      )}
    </div>
  );
}

// ── Configure Panel ────────────────────────────────────────────────────────

function ConfigurePanel({ skill, persona, workspace, isToolConnected, onRun, onBack }: {
  skill: SkillDefinition;
  persona: string;
  workspace: string;
  isToolConnected: (toolNameOrId: string) => boolean;
  onRun: (inputs: Record<string, unknown>, fileIds: string[], simulate: boolean) => void;
  onBack: () => void;
}) {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [artifacts, setArtifacts] = useState<Record<string, Array<{ artifactId: string }>>>({});
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [simulate, setSimulate] = useState(false);
  const [preCheck, setPreCheck] = useState<PreCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const setFocusedField = useExecutionStore(s => s.setFocusedField);
  const setRightPanelMode = useEAOSStore(s => s.setRightPanelMode);

  // Switch right panel to help mode when entering configuration
  useEffect(() => {
    setRightPanelMode('help');
    return () => { setFocusedField(null); };
  }, [setRightPanelMode, setFocusedField]);

  const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000';

  // Run pre-check
  useEffect(() => {
    setChecking(true);
    fetch(`${GATEWAY_URL}/api/${persona}/execute/precheck`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflowId: skill.id, skillId: skill.id, simulate }),
    })
      .then(r => r.json())
      .then(data => setPreCheck(data))
      .catch(() => setPreCheck({ canExecute: true })) // if gateway down, allow simulate
      .finally(() => setChecking(false));
  }, [skill.id, simulate, persona, GATEWAY_URL]);

  const allRequiredFilled = skill.inputFields
    .filter(f => f.required)
    .every(f => f.type === 'file' ? (artifacts[f.key]?.length ?? 0) > 0 : (inputs[f.key] ?? '').trim().length > 0);

  const canRun = !uploading && (preCheck?.canExecute || simulate) && allRequiredFilled;
  const handleUpload = async (key: string, files: FileList | null) => {
    setUploading(true); setUploadError(null);
    try { setArtifacts(previous => ({ ...previous, [key]: [] })); const refs = await Promise.all(Array.from(files ?? []).map(uploadArtifact)); setArtifacts(previous => ({ ...previous, [key]: refs })); }
    catch (error) { setUploadError(error instanceof Error ? error.message : 'Upload failed'); }
    finally { setUploading(false); }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-slate-400 hover:text-slate-700 transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-[18px] font-semibold text-slate-900">{skill.name}</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">{skill.description}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Input form */}
        <div className="lg:col-span-2 space-y-4">
          <div className="card p-5">
            <h2 className="text-[14px] font-semibold text-slate-900 mb-4">Configure Inputs</h2>

            {skill.inputFields.length > 0 ? (
              <div className="space-y-4">
                {skill.inputFields.map(field => (
                  <div key={field.key}>
                    <label className="block text-[13px] font-medium text-slate-700 mb-1.5">
                      {field.label}
                      {field.required && <span className="text-red-400 ml-0.5">*</span>}
                    </label>
                    {field.type === 'file' ? (
                      <div>
                        <input type="file" multiple={field.multiple} disabled={uploading} accept=".txt,.md,.csv,.json,.log,.ts,.js,.py,.go,.rs,.java,.sql" onChange={event => handleUpload(field.key, event.target.files)} />
                        <p className="text-xs text-slate-500">UTF-8 text, Markdown, CSV, JSON or source code; 512 KB maximum. {artifacts[field.key]?.length ?? 0} stored artifact(s).</p>
                        {uploadError && <p role="alert" className="text-xs text-red-600">{uploadError}</p>}
                      </div>
                    ) : field.type === 'textarea' ? (
                      <textarea
                        className="input w-full min-h-[100px] resize-y"
                        placeholder={field.placeholder}
                        value={inputs[field.key] ?? ''}
                        onChange={e => setInputs(p => ({ ...p, [field.key]: e.target.value }))}
                        onFocus={() => setFocusedField(field.key)}
                      />
                    ) : field.type === 'select' && field.options ? (
                      <select
                        className="input w-full"
                        value={inputs[field.key] ?? ''}
                        onChange={e => setInputs(p => ({ ...p, [field.key]: e.target.value }))}
                        onFocus={() => setFocusedField(field.key)}
                      >
                        <option value="">{field.placeholder || 'Select…'}</option>
                        {field.options.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                        className="input w-full"
                        placeholder={field.placeholder}
                        value={inputs[field.key] ?? ''}
                        onChange={e => setInputs(p => ({ ...p, [field.key]: e.target.value }))}
                        onFocus={() => setFocusedField(field.key)}
                      />
                    )}
                    {field.hint && <p className="text-[11px] text-slate-400 mt-1">{field.hint}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[13px] text-slate-500">This skill runs automatically — no inputs required.</p>
            )}
          </div>
        </div>

        {/* Right: Tool check + run */}
        <div className="space-y-4">
          {/* Tool connections */}
          <div className="card p-4">
            <h3 className="text-[13px] font-semibold text-slate-900 mb-3">Required Tools</h3>
            {skill.requiredTools.length > 0 ? (
              <div className="space-y-2">
                {skill.requiredTools.map(tool => {
                  const connected = isToolConnected(tool);
                  return (
                    <div key={tool} className="flex items-center gap-2 text-[13px]">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${connected ? 'bg-emerald-500' : 'bg-red-400'}`} />
                      <span className={connected ? 'text-slate-700' : 'text-slate-500'}>{tool}</span>
                      {!connected && (
                        <span className="text-[11px] text-red-400 ml-auto">Not connected</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-[12px] text-slate-400">No specific tools required.</p>
            )}

            {/* Pre-check status */}
            {checking && (
              <div className="mt-3 text-[12px] text-slate-400 flex items-center gap-2">
                <div className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                Checking connections…
              </div>
            )}
            {preCheck && !preCheck.canExecute && !simulate && (
              <div className="mt-3 p-2.5 rounded-lg bg-amber-50 border border-amber-100 text-[12px] text-amber-700">
                {preCheck.reason || 'Some tools are not connected.'}
                {preCheck.missingTools && (
                  <div className="mt-1 text-[11px] text-amber-600">
                    Missing: {preCheck.missingTools.join(', ')}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Steps preview */}
          <div className="card p-4">
            <h3 className="text-[13px] font-semibold text-slate-900 mb-3">Execution Steps</h3>
            <div className="space-y-2">
              {skill.steps.map((step, i) => (
                <div key={step.id} className="flex items-start gap-2.5">
                  <div className="flex flex-col items-center">
                    <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-[11px] font-medium text-slate-500">{i + 1}</div>
                    {i < skill.steps.length - 1 && <div className="w-px h-4 bg-slate-200 mt-0.5" />}
                  </div>
                  <div>
                    <div className="text-[13px] text-slate-700">{step.name}</div>
                    {step.tool && <div className="text-[11px] text-slate-400">via {step.tool}</div>}
                    {step.requiresApproval && (
                      <span className="inline-block text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded mt-0.5">Approval required</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Simulate toggle + Run button */}
          <div className="card p-4 space-y-3">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={simulate}
                onChange={e => setSimulate(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <div className="text-[13px] text-slate-700 font-medium">Simulation mode</div>
                <div className="text-[11px] text-slate-400">Run without real tool connections</div>
              </div>
            </label>

            <button
              onClick={() => onRun({ ...inputs, ...Object.fromEntries(skill.inputFields.filter(field => field.type === 'file' && artifacts[field.key]?.length).map(field => [field.key, field.multiple ? artifacts[field.key] : artifacts[field.key]?.[0]])) }, [], simulate)}
              disabled={!canRun}
              className="btn btn-primary w-full py-2.5 text-[14px] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {simulate ? 'Simulate Execution' : skill.executableType === 'workflow' ? 'Run Workflow' : 'Run Skill'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Execution View (Timeline + Output) ─────────────────────────────────────

function ExecutionView({ execution, onBack, onRerun }: {
  execution: Execution;
  onBack: () => void;
  onRerun: () => void;
}) {
  const isRunning = execution.status === 'running' || execution.status === 'queued';
  const isDone = execution.status === 'completed' || execution.status === 'simulated';
  const isFailed = isTerminalExecutionStatus(execution.status) && !isDone;

  const completedSteps = execution.steps.filter(s => s.status === 'completed' || s.status === 'simulated').length;
  const totalSteps = execution.steps.length;
  const progressPct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  const duration = execution.completedAt
    ? ((new Date(execution.completedAt).getTime() - new Date(execution.startedAt).getTime()) / 1000).toFixed(1)
    : ((Date.now() - new Date(execution.startedAt).getTime()) / 1000).toFixed(0);

  // Tab: 'timeline' | 'output' | 'report'
  const [tab, setTab] = useState<'timeline' | 'output' | 'report'>(isDone ? 'output' : 'timeline');

  // After-Action Report state
  const [aar, setAAR] = useState<any>(null);

  // Switch to output tab when execution completes
  useEffect(() => {
    if (isDone) setTab('output');
  }, [isDone]);

  // Fetch AAR when execution is done
  useEffect(() => {
    if (!isDone && !isFailed) return;
    fetch(`${GATEWAY}/api/aar/${execution.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.report) setAAR(data.report); })
      .catch(() => {});
  }, [isDone, isFailed, execution.id]);

  return (
    <div>
      {/* Header bar */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-slate-400 hover:text-slate-700 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-[18px] font-semibold text-slate-900">{execution.skillName}</h1>
            <div className="flex items-center gap-3 mt-0.5">
              <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${
                isRunning ? 'text-blue-600' : execution.status === 'simulated' ? 'text-purple-600' : isDone ? 'text-emerald-600' : 'text-red-600'
              }`}>
                <span className={`w-2 h-2 rounded-full ${
                  isRunning ? 'bg-blue-500 animate-pulse' : execution.status === 'simulated' ? 'bg-purple-500' : isDone ? 'bg-emerald-500' : 'bg-red-500'
                }`} />
                {STEP_LABEL[execution.status] ?? execution.status}
              </span>
              <span className="text-[12px] text-slate-400">{duration}s</span>
              <span className="text-[12px] text-slate-400">{completedSteps}/{totalSteps} steps</span>
              {execution.executionMode === 'dag' && (
                <span className="text-[11px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded font-medium">DAG</span>
              )}
              {execution.simulate && (
                <span className="text-[11px] px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded font-medium">Sandbox</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isDone && (
            <button onClick={onRerun} className="btn btn-secondary text-[13px]">
              Edit & Re-run
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {isRunning && (
        <div className="h-1 bg-slate-100 rounded-full mb-5 overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 border-b border-slate-200">
        <button
          onClick={() => setTab('timeline')}
          className={`px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${
            tab === 'timeline' ? 'text-blue-600 border-blue-600' : 'text-slate-500 border-transparent hover:text-slate-700'
          }`}
        >
          Timeline
        </button>
        <button
          onClick={() => setTab('output')}
          className={`px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${
            tab === 'output' ? 'text-blue-600 border-blue-600' : 'text-slate-500 border-transparent hover:text-slate-700'
          }`}
        >
          Output
          {isDone && (
            <span className="ml-1.5 w-2 h-2 rounded-full bg-emerald-500 inline-block" />
          )}
        </button>
        {(isDone || isFailed) && aar && (
          <button
            onClick={() => setTab('report')}
            className={`px-4 py-2.5 text-[13px] font-medium border-b-2 transition-colors ${
              tab === 'report' ? 'text-blue-600 border-blue-600' : 'text-slate-500 border-transparent hover:text-slate-700'
            }`}
          >
            Report
          </button>
        )}
      </div>

      {/* Timeline tab */}
      {tab === 'timeline' && (
        <div className="card p-5">
          <div className="space-y-1">
            {execution.steps.map((step, i) => (
              <div key={step.stepId} className="flex items-start gap-3 py-2.5">
                {/* Connector line + dot */}
                <div className="flex flex-col items-center pt-0.5">
                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${STEP_DOT[step.status]}`} />
                  {i < execution.steps.length - 1 && (
                    <div className={`w-px flex-1 min-h-[20px] mt-1 ${
                      step.status === 'completed' ? 'bg-emerald-200' : 'bg-slate-200'
                    }`} />
                  )}
                </div>

                {/* Step content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className={`text-[13px] ${STEP_TEXT[step.status]}`}>{step.stepName}</span>
                    <span className={`text-[11px] ${STEP_TEXT[step.status]}`}>{STEP_LABEL[step.status]}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-[11px] text-slate-400">{step.agent}</span>
                    {step.tool && <span className="text-[11px] text-slate-400">via {step.tool}</span>}
                    {step.durationMs && <span className="text-[11px] text-slate-400">{(step.durationMs / 1000).toFixed(1)}s</span>}
                    {step.dependsOn && step.dependsOn.length > 0 && (
                      <span className="text-[11px] text-slate-400">
                        after {step.dependsOn.map(d => {
                          const dep = execution.steps.find(s => s.stepId === d);
                          return dep?.stepName ?? d;
                        }).join(', ')}
                      </span>
                    )}
                  </div>
                  {step.error && (
                    <div className="mt-1.5 p-2 rounded bg-red-50 text-[12px] text-red-700">{step.error}</div>
                  )}
                  {step.outputPreview && (step.status === 'completed' || step.status === 'simulated') && (
                    <div className="mt-1.5 p-2.5 rounded-lg bg-slate-50 text-[12px] text-slate-600 border border-slate-100 line-clamp-3">
                      {step.outputPreview}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Output tab */}
      {tab === 'output' && (
        <OutputViewer
          execution={execution}
          isRunning={isRunning}
        />
      )}

      {/* After-Action Report tab */}
      {tab === 'report' && aar && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="card p-5">
            <h3 className="text-[14px] font-semibold text-slate-900 mb-2">After-Action Report</h3>
            <div className="flex items-center gap-2 mb-3">
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                aar.outcome === 'success' ? 'bg-emerald-50 text-emerald-700' :
                aar.outcome === 'partial' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
              }`}>
                {aar.outcome === 'success' ? '✓ Success' : aar.outcome === 'partial' ? '⚠ Partial' : '✗ Failed'}
              </span>
              <span className="text-[12px] text-slate-400">{(aar.totalDurationMs / 1000).toFixed(1)}s</span>
              <span className="text-[12px] text-slate-400">${aar.totalTokenCost.toFixed(4)}</span>
            </div>
            <p className="text-[13px] text-slate-600">{aar.summary}</p>
          </div>

          {/* Agent Performance */}
          <div className="card p-5">
            <h4 className="text-[13px] font-semibold text-slate-900 mb-3">Agent Performance</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left py-2 font-medium text-slate-500">Agent</th>
                    <th className="text-left py-2 font-medium text-slate-500">Step</th>
                    <th className="text-center py-2 font-medium text-slate-500">Quality</th>
                    <th className="text-center py-2 font-medium text-slate-500">Duration</th>
                    <th className="text-center py-2 font-medium text-slate-500">Handoff</th>
                    <th className="text-center py-2 font-medium text-slate-500">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {aar.agentPerformance.map((ap: any, i: number) => (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-slate-700">{ap.callSign}</span>
                          {ap.wasRouted && <span className="text-[10px] px-1 bg-blue-50 text-blue-600 rounded">routed</span>}
                        </div>
                        <span className="text-[11px] text-slate-400">{ap.rank}</span>
                      </td>
                      <td className="py-2 text-slate-600">{ap.stepName}</td>
                      <td className="py-2 text-center">
                        {/* Absence is not zero. A step that failed produced no
                            output to score, so it renders as an em-dash rather
                            than a red 0.0 that claims the agent scored badly. */}
                        {ap.qualityScore === undefined ? (
                          <span className="text-slate-400" title="Not measured — this step produced no output to score">—</span>
                        ) : (
                          <span className={`font-medium ${
                            ap.qualityScore >= 7 ? 'text-emerald-600' :
                            ap.qualityScore >= 5 ? 'text-amber-600' : 'text-red-600'
                          }`}>{ap.qualityScore.toFixed(1)}</span>
                        )}
                      </td>
                      <td className="py-2 text-center text-slate-500">{(ap.durationMs / 1000).toFixed(1)}s</td>
                      <td className="py-2 text-center">
                        {ap.handoffValid
                          ? <span className="text-emerald-500">✓</span>
                          : <span className="text-red-500">✗</span>}
                      </td>
                      <td className="py-2 text-center">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          ap.status === 'completed' ? 'bg-emerald-50 text-emerald-700' :
                          ap.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'
                        }`}>{ap.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Issues & Recommendations */}
          {(aar.issues.length > 0 || aar.recommendations.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {aar.issues.length > 0 && (
                <div className="card p-5">
                  <h4 className="text-[13px] font-semibold text-red-700 mb-2">Issues ({aar.issues.length})</h4>
                  <ul className="space-y-1.5">
                    {aar.issues.map((issue: string, i: number) => (
                      <li key={i} className="text-[12px] text-red-600 flex items-start gap-1.5">
                        <span className="mt-0.5 flex-shrink-0">•</span>
                        <span>{issue}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {aar.recommendations.length > 0 && (
                <div className="card p-5">
                  <h4 className="text-[13px] font-semibold text-blue-700 mb-2">Recommendations</h4>
                  <ul className="space-y-1.5">
                    {aar.recommendations.map((rec: string, i: number) => (
                      <li key={i} className="text-[12px] text-blue-600 flex items-start gap-1.5">
                        <span className="mt-0.5 flex-shrink-0">→</span>
                        <span>{rec}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
