/**
 * Marketing Command Center — Launch workflows, poll execution progress, view outputs
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */
'use client';

import { useState, useEffect, useRef } from 'react';
import { notify } from '../../lib/notify';
import {
  MARKETING_WORKFLOWS,
  getWorkflowsByCluster,
  getWorkflowById,
  WORKFLOW_CLUSTERS,
  type WorkflowDef,
  type WorkflowCluster,
} from '../../lib/marketing-workflows';
import { WorkflowExecutionForm } from './WorkflowExecutionForm';
import { ExecutionTimeline } from './ExecutionTimeline';
import { useMarketingStore } from '../../store/marketing-store';
import { useEAOSStore } from '../../store/eaos-store';
import { useConnectionsStore } from '../../store/connections-store';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000';

const POLL_INTERVAL_MS = 2000; // poll every 2 seconds while running

const MKT_TOOL_DEFS = [
  { connectorId: 'anthropic' },
  { connectorId: 'hubspot' },
  { connectorId: 'salesforce' },
  { connectorId: 'linkedin-ads' },
  { connectorId: 'canva' },
  { connectorId: 'google-drive' },
  { connectorId: 'perplexity' },
  { connectorId: 'wordpress' },
];

export function MarketingCommandCenter() {
  const selectedWorkflowId = useMarketingStore((s) => s.selectedWorkflowId);
  const setSelectedWorkflowId = useMarketingStore((s) => s.setSelectedWorkflowId);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowDef | null>(() =>
    selectedWorkflowId ? getWorkflowById(selectedWorkflowId) ?? null : null
  );
  const [executing, setExecuting] = useState(false);
  const [preCheck, setPreCheck] = useState<{ canExecute: boolean; reason?: string; missingTools?: string[] } | null>(null);
  const activeExecution = useMarketingStore((s) => s.activeExecution);
  const addExecution = useMarketingStore((s) => s.addExecution);
  const updateExecution = useMarketingStore((s) => s.updateExecution);
  const updateExecutionStep = useMarketingStore((s) => s.updateExecutionStep);
  const setActiveSection = useMarketingStore((s) => s.setActiveSection);

  const byCluster = getWorkflowsByCluster();

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync from store when navigating from another section
  useEffect(() => {
    if (selectedWorkflowId && !selectedWorkflow) {
      setSelectedWorkflow(getWorkflowById(selectedWorkflowId) ?? null);
    }
  }, [selectedWorkflowId, selectedWorkflow]);

  // Pre-check tool connections when workflow is selected
  useEffect(() => {
    if (!selectedWorkflow) {
      setPreCheck(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${GATEWAY_URL}/api/marketing/execute/precheck`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflowId: selectedWorkflow.id, simulate: false }),
        });
        if (cancelled) return;
        const data = await res.json();
        setPreCheck({ canExecute: data.canExecute, reason: data.reason, missingTools: data.missingTools });
      } catch {
        if (!cancelled) setPreCheck({ canExecute: false, reason: 'Pre-check failed — is the gateway running?' });
      }
    })();
    return () => { cancelled = true; };
  }, [selectedWorkflow?.id]);

  // Poll execution status while active execution is running/queued
  useEffect(() => {
    if (!activeExecution || ['completed', 'failed'].includes(activeExecution.status)) {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    if (pollingRef.current) clearInterval(pollingRef.current);

    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${GATEWAY_URL}/api/marketing/executions/${activeExecution.id}`);
        if (!res.ok) return;
        const { execution } = await res.json();
        if (!execution) return;

        // Update overall execution status
        updateExecution(activeExecution.id, {
          status: execution.status,
          completedAt: execution.completedAt,
          outputs: execution.outputs ?? {},
        });

        // Update individual step statuses
        for (const step of execution.steps ?? []) {
          updateExecutionStep(activeExecution.id, step.stepId, {
            status: step.status,
            startedAt: step.startedAt,
            completedAt: step.completedAt,
            outputPreview: step.outputPreview,
            error: step.error,
          });
        }

        // Stop polling when done
        if (['completed', 'failed'].includes(execution.status)) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        }
      } catch {
        // Ignore polling errors
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [activeExecution?.id, activeExecution?.status]);

  const setActiveExecutionId = useEAOSStore((s) => s.setActiveExecutionId);
  const mainSetActiveSection = useEAOSStore((s) => s.setActiveSection);

  const handleExecute = async (inputs: Record<string, unknown>, fileIds?: string[], simulate?: boolean, customPrompt?: string, modelId?: string, provider?: string) => {
    if (!selectedWorkflow) return;
    setExecuting(true);
    try {
      const res = await fetch(`${GATEWAY_URL}/api/marketing/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: selectedWorkflow.id,
          inputs: { ...inputs, _fileIds: fileIds },
          simulate: simulate === true,
          customPrompt,
          provider,
          modelId,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as Record<string, string>).error ?? 'Execution failed');
      }
      const { execution } = await res.json();
      const stepEvents = (execution.steps ?? []).map((s: {
        stepId: string; stepName: string; agent: string; tool?: string;
        status: string; outputKey?: string;
      }) => ({
        id: `evt-${s.stepId}`,
        stepId: s.stepId,
        stepName: s.stepName,
        agent: s.agent,
        tool: s.tool,
        status: s.status as 'pending' | 'running' | 'completed' | 'failed' | 'approval_required',
        outputKey: s.outputKey,
      }));
      addExecution({
        id: execution.id,
        workflowId: execution.workflowId,
        workflowName: execution.workflowName,
        status: execution.status ?? 'queued',
        steps: stepEvents,
        outputs: execution.outputs ?? {},
        startedAt: execution.startedAt,
      });
      setActiveExecutionId(execution.id);
      setSelectedWorkflow(null);
      setSelectedWorkflowId(null);
    } catch (err) {
      console.error(err);
      notify('error', 'Execution failed', err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setExecuting(false);
    }
  };

  const isToolConnected = useConnectionsStore(s => s.isToolConnected);
  const connectedCount = MKT_TOOL_DEFS.filter(t => isToolConnected(t.connectorId)).length;

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      {/* Orange hero header */}
      <div className="rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 p-6 text-white shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold">Marketing Command Center</h2>
            <p className="text-orange-100 text-sm mt-1">Launch marketing workflows. Select → fill inputs → run.</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold">{connectedCount}/{MKT_TOOL_DEFS.length}</p>
            <p className="text-orange-200 text-xs">Tools connected</p>
          </div>
        </div>
        {connectedCount === 0 && (
          <div className="mt-4 flex items-center gap-3 bg-white/10 rounded-lg px-4 py-2.5 backdrop-blur-sm">
            <svg className="w-5 h-5 text-amber-200 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
            <p className="text-sm text-orange-100">No tools connected yet. Workflows will run in simulation mode.</p>
            <button
              onClick={() => mainSetActiveSection('conn-devtools')}
              className="ml-auto px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-semibold text-white transition-colors"
            >
              Connect tools
            </button>
          </div>
        )}
      </div>

      {/* Active execution panel */}
      {activeExecution && !selectedWorkflow && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {activeExecution.status === 'running' || activeExecution.status === 'queued' ? (
                <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
              ) : activeExecution.status === 'completed' ? (
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
              ) : (
                <span className="h-2 w-2 rounded-full bg-red-400" />
              )}
              <span className="text-sm font-bold text-slate-900">{activeExecution.workflowName}</span>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                activeExecution.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                activeExecution.status === 'running' ? 'bg-blue-100 text-blue-700' :
                activeExecution.status === 'queued' ? 'bg-amber-100 text-amber-700' :
                'bg-red-100 text-red-700'
              }`}>{activeExecution.status}</span>
            </div>
            <button
              onClick={() => updateExecution(activeExecution.id, { status: activeExecution.status })}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              Dismiss
            </button>
          </div>
          <ExecutionTimeline
            steps={activeExecution.steps}
            workflowName={activeExecution.workflowName}
            status={activeExecution.status}
            outputs={activeExecution.outputs}
          />
        </div>
      )}

      {/* Workflow selector */}
      {!selectedWorkflow ? (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-slate-700">30 Workflows — Select one to run</h3>
          <div className="grid gap-4">
            {(Object.keys(WORKFLOW_CLUSTERS) as WorkflowCluster[]).map((cluster) => {
              const meta = WORKFLOW_CLUSTERS[cluster];
              const workflows = byCluster[cluster] ?? [];
              return (
                <div key={cluster} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg">{meta.icon}</span>
                    <span className="text-sm font-bold text-slate-800">{meta.label}</span>
                    <span className="text-xs text-slate-400 ml-auto">{workflows.length} workflows</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {workflows.map((wf) => (
                      <button
                        key={wf.id}
                        onClick={() => setSelectedWorkflow(wf)}
                        className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50 hover:border-slate-400 hover:bg-white text-left transition-all"
                      >
                        <span>{wf.icon}</span>
                        <span className="text-xs font-medium text-slate-800 truncate">{wf.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Form panel — wider */}
          <div className="lg:col-span-3 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <span className="text-xl">{selectedWorkflow.icon}</span>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{selectedWorkflow.name}</h3>
                  <p className="text-[11px] text-slate-500">{selectedWorkflow.description}</p>
                </div>
              </div>
              <button
                onClick={() => { setSelectedWorkflow(null); setSelectedWorkflowId(null); }}
                className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >
                ← Back
              </button>
            </div>

            {/* Precheck status */}
            {preCheck && (
              <div className={`mb-4 rounded-lg border p-3 ${
                preCheck.canExecute
                  ? 'border-emerald-200 bg-emerald-50'
                  : 'border-amber-200 bg-amber-50'
              }`}>
                {preCheck.canExecute ? (
                  <p className="text-xs font-semibold text-emerald-700">All required tools connected — ready to run</p>
                ) : (
                  <div>
                    <p className="text-xs font-semibold text-amber-800">Tools not connected</p>
                    {preCheck.missingTools && preCheck.missingTools.length > 0 && (
                      <p className="text-[11px] text-amber-700 mt-0.5">
                        Missing: {preCheck.missingTools.join(', ')}
                      </p>
                    )}
                    <button
                      onClick={() => mainSetActiveSection('conn-devtools')}
                      className="text-[11px] text-blue-600 hover:text-blue-800 font-semibold mt-1.5 underline"
                    >
                      Connect tools in Connections →
                    </button>
                  </div>
                )}
              </div>
            )}

            {executing && (
              <div className="mb-4 flex items-center gap-2 text-sm text-blue-600">
                <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
                Starting execution…
              </div>
            )}

            <WorkflowExecutionForm
              workflow={selectedWorkflow}
              onExecute={handleExecute}
              onCancel={() => { setSelectedWorkflow(null); setSelectedWorkflowId(null); }}
              preCheck={preCheck}
            />
          </div>

          {/* Steps preview panel */}
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h4 className="text-xs font-bold text-slate-700 mb-3 uppercase tracking-wide">Workflow Steps</h4>
              <ol className="space-y-2">
                {selectedWorkflow.steps?.map((step, i) => (
                  <li key={step.id} className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-100 text-slate-500 text-[11px] font-bold flex items-center justify-center mt-0.5">
                      {i + 1}
                    </span>
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
