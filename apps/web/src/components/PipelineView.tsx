/**
 * PipelineView — Functional DAG pipeline visualization connected to backend pipeline-engine.
 * Shows phases, nodes, quality gates, checkpoints, feedback loops, and execution status.
 * Triggers pipeline runs via POST /api/pipeline/execute and polls status via GET /api/pipeline/:id.
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { isTerminalExecutionStatus, type ExecutionStatus } from '@agentos/skills/schema';

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000';
const POLL_MS = 2500;

// ---------------------------------------------------------------------------
// Types matching backend pipeline-engine.ts
// ---------------------------------------------------------------------------

interface GraphNode {
  id: string;
  agent: string;
  depends_on: string[];
  phase: string;
  parallel_group: string | null;
}

interface Phase {
  label: string;
  order: number;
  description: string;
}

interface QualityGate {
  id: string;
  after_node: string;
  validation: Record<string, unknown>;
  on_fail: string;
  max_retries: number;
  retry_instructions: string;
}

interface Checkpoint {
  id: string;
  after_node?: string;
  before_node?: string;
  within_node?: string;
  type: string;
  timeout_hours: number;
  notify?: string[];
  condition?: string;
}

interface FeedbackLoop {
  id: string;
  from: string;
  trigger: { condition: string; thresholds: Record<string, unknown> };
  to: string[];
  circuit_breaker: Record<string, unknown>;
}

interface GraphConfig {
  graph_id: string;
  name: string;
  description: string;
  nodes: GraphNode[];
  phases: Record<string, Phase>;
  quality_gates: QualityGate[];
  checkpoints: Checkpoint[];
  feedback_loops: FeedbackLoop[];
  shared_state: Record<string, unknown>[];
}

interface PipelineExecution {
  id: string;
  status: ExecutionStatus;
  execution?: { steps: Array<{ stepId: string; stepName: string; status: string; approvalFields?: string[] }> };
  intent: string;
  totalTokensUsed: number;
  totalCostUsd: number;
  afterActionReport?: Record<string, unknown>;
  statusReports?: Array<{ nodeId: string; status: string; output?: string; error?: string }>;
}

interface PipelineListItem {
  id: string;
  status: string;
  intent: string;
  startedAt?: string;
  completedAt?: string;
  totalTokensUsed: number;
  totalCostUsd: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  pending:           'bg-slate-200 text-slate-600',
  running:           'bg-blue-100 text-blue-700 animate-pulse',
  completed:         'bg-emerald-100 text-emerald-700',
  failed:            'bg-red-100 text-red-700',
  waiting_approval:  'bg-amber-100 text-amber-700',
  retrying:          'bg-orange-100 text-orange-700',
  cancelled:         'bg-slate-300 text-slate-600',
  initializing:      'bg-blue-50 text-blue-600',
};

const PHASE_COLORS: Record<string, string> = {
  intelligence:  'border-sky-300 bg-sky-50',
  planning:      'border-violet-300 bg-violet-50',
  production:    'border-emerald-300 bg-emerald-50',
  activation:    'border-orange-300 bg-orange-50',
  measurement:   'border-blue-300 bg-blue-50',
  optimization:  'border-rose-300 bg-rose-50',
};

function nodeStatus(nodeId: string, reports?: PipelineExecution['statusReports']): string {
  if (!reports) return 'pending';
  const r = reports.find(r => r.nodeId === nodeId);
  return r?.status ?? 'pending';
}

// ---------------------------------------------------------------------------
// Component: PipelineView
// ---------------------------------------------------------------------------

interface PipelineViewProps {
  persona: string;           // 'marketing' | 'engineering' | 'product' | 'hr'
  accentColor?: string;
}

export function PipelineView({ persona, accentColor = 'blue-600' }: PipelineViewProps) {
  const [graphConfig, setGraphConfig] = useState<GraphConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Execution state
  const [executing, setExecuting] = useState(false);
  const [activeExecution, setActiveExecution] = useState<PipelineExecution | null>(null);
  const [intent, setIntent] = useState('');
  const [history, setHistory] = useState<PipelineListItem[]>([]);
  const [confirmations, setConfirmations] = useState<Record<string, boolean>>({});

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load graph config from backend
  useEffect(() => {
    fetch(`${GATEWAY_URL}/api/${persona}/pipeline/graph`)
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(data => { setGraphConfig(data); setLoading(false); })
      .catch(() => {
        // Fallback: load marketing graph config directly
        fetch(`${GATEWAY_URL}/api/pipeline/graph?persona=${encodeURIComponent(persona)}`)
          .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
          .then(data => { setGraphConfig(data); setLoading(false); })
          .catch(err => { setError(String(err)); setLoading(false); });
      });
  }, [persona]);

  // Load pipeline execution history
  useEffect(() => {
    fetch(`${GATEWAY_URL}/api/pipelines`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setHistory(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [activeExecution?.status]);

  // Poll active execution
  const startPolling = useCallback((execId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${GATEWAY_URL}/api/pipeline/${encodeURIComponent(execId)}`);
        if (!r.ok) return;
        const data: PipelineExecution = await r.json();
        setActiveExecution(data);
        if (isTerminalExecutionStatus(data.status)) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setExecuting(false);
        }
      } catch { /* retry next interval */ }
    }, POLL_MS);
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Execute pipeline
  const handleExecute = async () => {
    if (!graphConfig || !intent.trim()) return;
    setExecuting(true);
    setError(null);
    setConfirmations({});

    try {
      // Resolve orchestrator and agent identities through the canonical server adapter
      const body = {
        intent: intent.trim(),
        persona,
        context: { persona, timestamp: new Date().toISOString() },
        graphConfig,
      };

      const r = await fetch(`${GATEWAY_URL}/api/pipeline/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
        throw new Error(err.error ?? `HTTP ${r.status}`);
      }

      const exec: PipelineExecution = await r.json();
      setActiveExecution(exec);

      if (!isTerminalExecutionStatus(exec.status)) {
        startPolling(exec.id);
      } else {
        setExecuting(false);
      }
    } catch (err: any) {
      setError(err.message ?? 'Pipeline execution failed');
      setExecuting(false);
    }
  };

  const decide = async (stepId: string, approved: boolean, fields: string[] = []) => {
    if (!activeExecution) return;
    try {
      const response = await fetch(`${GATEWAY_URL}/api/executions/${encodeURIComponent(activeExecution.id)}/${approved ? 'approve' : 'reject'}/${encodeURIComponent(stepId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmations: Object.fromEntries(fields.map(field => [field, confirmations[`${stepId}:${field}`] === true])) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Approval decision was not accepted');
      startPolling(activeExecution.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Approval decision failed'); }
  };

  // Cancel pipeline
  const handleCancel = async () => {
    if (!activeExecution) return;
    try {
      const response = await fetch(`${GATEWAY_URL}/api/pipeline/${encodeURIComponent(activeExecution.id)}/cancel`, { method: 'POST' });
      if (!response.ok || !(await response.json()).cancelled) throw new Error('Cancellation was not acknowledged');
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      setExecuting(false);
      setActiveExecution(prev => prev ? { ...prev, status: 'cancelled' } : null);
    } catch (cause) { /* Preserve authoritative state on failure */ setError(cause instanceof Error ? cause.message : 'Cancellation failed'); }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin w-6 h-6 border-2 border-slate-300 border-t-blue-600 rounded-full" />
        <span className="ml-3 text-sm text-slate-500">Loading pipeline configuration…</span>
      </div>
    );
  }

  if (!graphConfig) {
    return (
      <div className="p-8 text-center">
        <div className="text-4xl mb-3">🔧</div>
        <h3 className="text-lg font-bold text-slate-900 mb-1">Pipeline Not Configured</h3>
        <p className="text-sm text-slate-500 mb-4">
          No DAG pipeline graph found for the {persona} workspace.
          {error && <span className="block text-red-500 mt-1 text-xs">{error}</span>}
        </p>
        <p className="text-xs text-slate-400">
          Expected: <code className="bg-slate-100 px-1.5 py-0.5 rounded">agents/{persona}/graph_runtime/graph.json</code>
        </p>
      </div>
    );
  }

  const phases = Object.entries(graphConfig.phases).sort(([, a], [, b]) => a.order - b.order);
  const gateMap = new Map(graphConfig.quality_gates.map(g => [g.after_node, g]));
  const checkpointMap = new Map(graphConfig.checkpoints.map(c => [c.before_node ?? c.within_node ?? c.after_node, c]));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-slate-900">Pipeline — {graphConfig.name}</h2>
        <p className="text-sm text-slate-500">{graphConfig.description}</p>
      </div>

      {/* Intent Input + Execute */}
      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Pipeline Intent</label>
          <input
            type="text"
            value={intent}
            onChange={e => setIntent(e.target.value)}
            placeholder="e.g. Launch Q2 product campaign for enterprise segment"
            disabled={executing}
            className="mt-1.5 w-full px-3.5 py-2.5 text-sm border border-slate-200 rounded-lg focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none disabled:bg-slate-50 disabled:text-slate-400"
          />
        </div>
        {executing ? (
          <button
            onClick={handleCancel}
            className="px-5 py-2.5 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors flex-shrink-0"
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={handleExecute}
            disabled={!intent.trim()}
            className={`px-5 py-2.5 text-sm font-semibold rounded-lg transition-colors flex-shrink-0 ${
              intent.trim() ? `bg-${accentColor} text-white hover:opacity-90` : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
            style={intent.trim() ? { backgroundColor: `var(--color-${accentColor}, #2563eb)` } : undefined}
          >
            Execute Pipeline →
          </button>
        )}
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</div>
      )}

      {activeExecution?.execution?.steps.filter(step => step.status === 'approval_required').map(step => (
        <div key={step.stepId} className="border border-amber-200 rounded-xl p-4 bg-amber-50">
          <p className="font-medium">Approval required: {step.stepName}</p>
          {(step.approvalFields ?? []).map(field => (
            <label key={field} className="flex gap-2 text-sm mt-2">
              <input type="checkbox" checked={confirmations[`${step.stepId}:${field}`] === true} onChange={event => setConfirmations(previous => ({ ...previous, [`${step.stepId}:${field}`]: event.target.checked }))} />
              {field.replace(/_/g, ' ')}
            </label>
          ))}
          <div className="flex gap-2 mt-3">
            <button className="btn btn-primary" disabled={(step.approvalFields ?? []).some(field => !confirmations[`${step.stepId}:${field}`])} onClick={() => decide(step.stepId, true, step.approvalFields)}>Approve</button>
            <button className="btn btn-secondary" onClick={() => decide(step.stepId, false)}>Reject</button>
          </div>
        </div>
      ))}

      {/* Active Execution Status */}
      {activeExecution && (
        <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_COLORS[activeExecution.status] ?? 'bg-slate-100 text-slate-600'}`}>
                {activeExecution.status.toUpperCase()}
              </span>
              <span className="text-xs text-slate-500 font-mono">{activeExecution.id.slice(0, 12)}…</span>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span>{activeExecution.totalTokensUsed.toLocaleString()} tokens</span>
              <span>${activeExecution.totalCostUsd.toFixed(4)}</span>
            </div>
          </div>
          <p className="text-sm text-slate-700 mb-3">Intent: <strong>{activeExecution.intent}</strong></p>

          {/* After-action report */}
          {activeExecution.afterActionReport && (
            <details className="mt-2">
              <summary className="text-xs font-semibold text-slate-500 cursor-pointer hover:text-slate-700">After-Action Report</summary>
              <pre className="mt-2 text-[11px] bg-white border border-slate-200 rounded-lg p-3 overflow-x-auto max-h-48 text-slate-700">
                {JSON.stringify(activeExecution.afterActionReport, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}

      {/* DAG Visualization — Phase columns with nodes */}
      <div className="space-y-4">
        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Pipeline Phases</h3>
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${phases.length}, minmax(140px, 1fr))` }}>
          {phases.map(([phaseId, phase]) => {
            const phaseNodes = graphConfig.nodes.filter(n => n.phase === phaseId);
            return (
              <div key={phaseId} className={`rounded-xl border-2 p-3 ${PHASE_COLORS[phaseId] ?? 'border-slate-200 bg-slate-50'}`}>
                <div className="mb-3">
                  <h4 className="text-xs font-bold text-slate-800">{phase.label}</h4>
                  <p className="text-[10px] text-slate-500 leading-tight mt-0.5">{phase.description}</p>
                </div>
                <div className="space-y-2">
                  {phaseNodes.map(node => {
                    const status = nodeStatus(node.id, activeExecution?.statusReports);
                    const gate = gateMap.get(node.id);
                    const checkpoint = checkpointMap.get(node.id);
                    const report = activeExecution?.statusReports?.find(r => r.nodeId === node.id);

                    return (
                      <div key={node.id} className="bg-white rounded-lg border border-slate-200 p-2.5 shadow-sm">
                        {/* Node header */}
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-slate-900 capitalize">{node.id}</span>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${STATUS_COLORS[status] ?? ''}`}>
                            {status}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 mb-1.5">{node.agent}</p>

                        {/* Dependencies */}
                        {node.depends_on.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-1.5">
                            {node.depends_on.map(dep => (
                              <span key={dep} className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">← {dep}</span>
                            ))}
                          </div>
                        )}

                        {/* Quality Gate */}
                        {gate && (
                          <div className="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-slate-100">
                            <span className="text-[10px]">🛡️</span>
                            <span className="text-[10px] text-slate-600 font-medium">Gate: {gate.id.replace('gate_', '')}</span>
                            <span className="text-[9px] text-slate-400">(retry ×{gate.max_retries})</span>
                          </div>
                        )}

                        {/* Checkpoint */}
                        {checkpoint && (
                          <div className="flex items-center gap-1.5 mt-1 pt-1 border-t border-slate-100">
                            <span className="text-[10px]">⏸️</span>
                            <span className="text-[10px] text-amber-700 font-medium">{checkpoint.id.replace('approve_', 'Approve: ')}</span>
                            <span className="text-[9px] text-slate-400">({checkpoint.timeout_hours}h timeout)</span>
                          </div>
                        )}

                        {/* Output preview */}
                        {report?.output && (
                          <details className="mt-1.5">
                            <summary className="text-[10px] text-emerald-600 font-medium cursor-pointer">View Output</summary>
                            <pre className="mt-1 text-[10px] bg-slate-50 rounded p-1.5 overflow-x-auto max-h-20 text-slate-600">
                              {typeof report.output === 'string' ? report.output.slice(0, 300) : JSON.stringify(report.output, null, 2).slice(0, 300)}
                            </pre>
                          </details>
                        )}

                        {/* Error */}
                        {report?.error && (
                          <p className="text-[10px] text-red-600 mt-1.5 bg-red-50 rounded px-1.5 py-1">{report.error}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Feedback Loops */}
      {graphConfig.feedback_loops.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Feedback Loops</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {graphConfig.feedback_loops.map(loop => (
              <div key={loop.id} className="border border-rose-200 bg-rose-50/50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-sm">🔄</span>
                  <span className="text-xs font-bold text-slate-800">{loop.id}</span>
                </div>
                <p className="text-[11px] text-slate-600">
                  Trigger: <strong>{loop.from}</strong> → Re-invoke: {loop.to.join(', ')}
                </p>
                <p className="text-[10px] text-slate-400 mt-1">
                  Circuit breaker: {JSON.stringify(loop.circuit_breaker)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pipeline History */}
      {history.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Execution History</h3>
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-3 py-2 text-slate-500 font-semibold">ID</th>
                  <th className="text-left px-3 py-2 text-slate-500 font-semibold">Intent</th>
                  <th className="text-left px-3 py-2 text-slate-500 font-semibold">Status</th>
                  <th className="text-right px-3 py-2 text-slate-500 font-semibold">Tokens</th>
                  <th className="text-right px-3 py-2 text-slate-500 font-semibold">Cost</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 10).map(item => (
                  <tr
                    key={item.id}
                    className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                    onClick={() => {
                      fetch(`${GATEWAY_URL}/api/pipeline/${encodeURIComponent(item.id)}`)
                        .then(r => r.ok ? r.json() : null)
                        .then(data => { if (data) setActiveExecution(data); })
                        .catch(() => {});
                    }}
                  >
                    <td className="px-3 py-2.5 font-mono text-slate-600">{item.id.slice(0, 10)}…</td>
                    <td className="px-3 py-2.5 text-slate-800 max-w-[200px] truncate">{item.intent}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_COLORS[item.status] ?? ''}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-600">{item.totalTokensUsed.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right text-slate-600">${item.totalCostUsd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
