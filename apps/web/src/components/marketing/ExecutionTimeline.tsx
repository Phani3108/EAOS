/**
 * Execution Timeline — Real-time step progress, outputs, errors
 * Shows live status, output previews, and approval actions.
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */
'use client';

import { useState } from 'react';
import type { ExecutionStepEvent } from '../../store/marketing-store';

const STATUS_DOT: Record<string, string> = {
  pending: 'bg-slate-300',
  running: 'bg-blue-500 animate-pulse',
  completed: 'bg-emerald-500',
  failed: 'bg-red-500',
  rejected: 'bg-red-500', cancelled: 'bg-slate-400', skipped: 'bg-slate-300', unsupported: 'bg-amber-500', inconclusive: 'bg-amber-500', simulated: 'bg-purple-500',
  approval_required: 'bg-amber-400',
};

const STATUS_LABEL: Record<string, { label: string; classes: string }> = {
  rejected: { label: 'Rejected', classes: 'bg-red-50 text-red-700 border-red-200' },
  cancelled: { label: 'Cancelled', classes: 'bg-slate-100 text-slate-600 border-slate-200' },
  skipped: { label: 'Skipped', classes: 'bg-slate-100 text-slate-600 border-slate-200' },
  unsupported: { label: 'Unsupported', classes: 'bg-amber-50 text-amber-700 border-amber-200' },
  inconclusive: { label: 'Inconclusive', classes: 'bg-amber-50 text-amber-700 border-amber-200' },
  simulated: { label: 'Simulated', classes: 'bg-purple-50 text-purple-700 border-purple-200' },
  pending: { label: 'Pending', classes: 'bg-slate-100 text-slate-500 border-slate-200' },
  running: { label: 'Running…', classes: 'bg-blue-100 text-blue-700 border-blue-200' },
  completed: { label: '✓ Done', classes: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  failed: { label: '✗ Failed', classes: 'bg-red-100 text-red-700 border-red-200' },
  approval_required: { label: '⏸ Review', classes: 'bg-amber-100 text-amber-700 border-amber-200' },
};

interface ExecutionTimelineProps {
  steps: ExecutionStepEvent[];
  workflowName: string;
  status: string;
  outputs?: Record<string, string>;
  onApprove?: (stepId: string) => void;
}

function StepRow({
  step,
  index,
  outputs,
  onApprove,
}: {
  step: ExecutionStepEvent;
  index: number;
  outputs: Record<string, string>;
  onApprove?: (stepId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const output = step.outputKey ? outputs[step.outputKey] : step.outputPreview;
  const statusInfo = STATUS_LABEL[step.status] ?? STATUS_LABEL.pending;
  const hasOutput = !!output;

  return (
    <div className="border-b border-slate-50 last:border-0">
      <div className="flex items-start gap-3 py-3">
        {/* Step number + dot */}
        <div className="flex flex-col items-center gap-1 pt-0.5">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[step.status] ?? STATUS_DOT.pending}`} />
        </div>

        {/* Step info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-slate-400 font-mono">#{index + 1}</span>
            <span className="text-sm font-semibold text-slate-900 truncate">{step.stepName}</span>
            <span className={`text-[11px] px-1.5 py-0.5 rounded border font-semibold flex-shrink-0 ${statusInfo.classes}`}>
              {statusInfo.label}
            </span>
          </div>

          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[11px] text-slate-500">
              {step.agentCallSign ? `${step.agentCallSign}` : step.agent}
              {step.agentRank && <span className="text-slate-400"> · {step.agentRank}</span>}
            </span>
            {step.tool && (
              <span className="text-[11px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{step.tool}</span>
            )}
            {step.qualityScore !== undefined && (
              <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${step.qualityScore >= 7 ? 'bg-emerald-50 text-emerald-700' : step.qualityScore >= 5 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                Q: {step.qualityScore}/10
              </span>
            )}
            {step.startedAt && step.completedAt && (
              <span className="text-[11px] text-slate-400">
                {Math.round((new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime()) / 1000)}s
              </span>
            )}
          </div>

          {/* Error */}
          {step.error && (
            <p className="text-[11px] text-red-600 mt-1 bg-red-50 rounded px-2 py-1">{step.error}</p>
          )}

          {/* Output preview */}
          {(step.status === 'completed' || step.status === 'simulated' || step.status === 'approval_required') && hasOutput && (
            <div className="mt-1.5">
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-[11px] text-blue-600 hover:text-blue-800 font-medium"
              >
                {expanded ? '▼ Hide output' : '▶ View output'}
              </button>
              {expanded && (
                <div className="mt-2 rounded-lg bg-slate-50 border border-slate-200 p-3 max-h-64 overflow-y-auto">
                  <pre className="text-[11px] text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                    {output}
                  </pre>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(output ?? '');
                      }}
                      className="text-[11px] text-slate-500 hover:text-slate-700 border border-slate-200 rounded px-2 py-1"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Approval action */}
          {step.status === 'approval_required' && onApprove && (
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => onApprove(step.stepId)}
                className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors"
              >
                Approve
              </button>
              <button
                className="px-3 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 transition-colors"
              >
                Reject
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ExecutionTimeline({ steps, workflowName, status, outputs = {}, onApprove }: ExecutionTimelineProps) {
  const completed = steps.filter((s) => s.status === 'completed' || s.status === 'simulated').length;
  const total = steps.length;
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
  const [showAllOutputs, setShowAllOutputs] = useState(false);

  const outputKeys = Object.keys(outputs);

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-slate-100 bg-slate-50/80">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${
              status === 'running' || status === 'queued' ? 'bg-blue-500 animate-pulse' :
              status === 'completed' ? 'bg-emerald-500' :
              status === 'failed' ? 'bg-red-500' : 'bg-slate-400'
            }`} />
            <span className="text-sm font-bold text-slate-900 truncate">{workflowName}</span>
          </div>
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold capitalize ${
            status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
            status === 'running' ? 'bg-blue-100 text-blue-700' :
            status === 'queued' ? 'bg-amber-100 text-amber-700' :
            status === 'failed' ? 'bg-red-100 text-red-700' :
            'bg-slate-100 text-slate-600'
          }`}>
            {status}
          </span>
        </div>
        {/* Progress bar */}
        {status !== 'queued' && (
          <div>
            <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${status === 'failed' ? 'bg-red-400' : 'bg-emerald-500'}`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">{completed} of {total} steps done</p>
          </div>
        )}
      </div>

      {/* Steps */}
      <div className="px-5 divide-y divide-slate-50">
        {steps.map((step, i) => (
          <StepRow
            key={step.id}
            step={step}
            index={i}
            outputs={outputs}
            onApprove={onApprove}
          />
        ))}
      </div>

      {/* All outputs panel — shown when completed */}
      {(status === 'completed' || status === 'simulated') && outputKeys.length > 0 && (
        <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/50">
          <button
            onClick={() => setShowAllOutputs(!showAllOutputs)}
            className="text-xs font-semibold text-slate-700 hover:text-slate-900 flex items-center gap-1"
          >
            {showAllOutputs ? '▼' : '▶'} All Outputs ({outputKeys.length})
          </button>
          {showAllOutputs && (
            <div className="mt-3 space-y-3">
              {outputKeys.map((key) => (
                <div key={key} className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-slate-50">
                    <span className="text-[11px] font-semibold text-slate-700">{key.replace(/_/g, ' ')}</span>
                    <button
                      onClick={() => navigator.clipboard?.writeText(outputs[key] ?? '')}
                      className="text-[11px] text-slate-400 hover:text-slate-600"
                    >
                      Copy
                    </button>
                  </div>
                  <div className="p-3 max-h-48 overflow-y-auto">
                    <pre className="text-[11px] text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
                      {outputs[key]}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
