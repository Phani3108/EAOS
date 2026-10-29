/**
 * OutputsView — Unified execution history & generated outputs for all personas.
 * Shows past skill executions with their outputs, status, and timeline.
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */
'use client';

import { useState } from 'react';
import { ExecutionTimeline } from '../marketing/ExecutionTimeline';
import type { ExecutionStepEvent } from '../../store/marketing-store';

// ---------------------------------------------------------------------------
// Types — generic execution shape that works for all personas
// ---------------------------------------------------------------------------

export interface OutputExecution {
  id: string;
  skillName: string;
  status: import('@agentos/skills/schema').ExecutionStatus;
  steps: {
    stepId: string;
    stepName: string;
    agent: string;
    tool?: string;
    status: string;
    startedAt?: string;
    completedAt?: string;
    outputKey?: string;
    outputPreview?: string;
    error?: string;
  }[];
  outputs: Record<string, string>;
  startedAt: string;
  completedAt?: string;
}

interface OutputsViewProps {
  executions: OutputExecution[];
  accentColor: string;      // e.g. 'blue-600', 'slate-900', 'violet-700'
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OutputsView({ executions, accentColor }: OutputsViewProps) {
  const [filter, setFilter] = useState<string | null>(null);

  const filtered = filter
    ? executions.filter(e => e.status === filter)
    : executions;

  const completedCount = executions.filter(e => e.status === 'completed').length;
  const runningCount = executions.filter(e => e.status === 'running' || e.status === 'queued').length;
  const failedCount = executions.filter(e => e.status === 'failed').length;

  const totalOutputs = executions
    .filter(e => e.status === 'completed')
    .reduce((acc, e) => acc + Object.keys(e.outputs).length, 0);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-slate-900">Outputs & History</h2>
        <p className="text-sm text-slate-600">
          All generated content, reports, and execution results from your skills.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Runs', value: executions.length, color: 'text-slate-900' },
          { label: 'Completed', value: completedCount, color: 'text-emerald-600' },
          { label: 'In Progress', value: runningCount, color: `text-${accentColor}` },
          { label: 'Outputs Generated', value: totalOutputs, color: 'text-blue-600' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[11px] text-slate-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex flex-wrap gap-2">
        {[
          { id: null, label: 'All', count: executions.length },
          { id: 'completed', label: 'Completed', count: completedCount },
          { id: 'running', label: 'Running', count: runningCount },
          { id: 'failed', label: 'Failed', count: failedCount },
        ].map(f => (
          <button
            key={f.id ?? 'all'}
            onClick={() => setFilter(f.id)}
            className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
              filter === f.id
                ? 'bg-slate-900 text-white border-slate-900'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      {/* Execution list */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
          <p className="text-3xl mb-3">📦</p>
          <p className="text-slate-500 text-sm font-medium">No executions yet</p>
          <p className="text-slate-400 text-xs mt-1">Run a skill to see outputs here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((exec) => {
            const steps: ExecutionStepEvent[] = exec.steps.map((s) => ({
              id: `evt-${s.stepId}`,
              stepId: s.stepId,
              stepName: s.stepName,
              agent: s.agent,
              tool: s.tool,
              status: s.status as ExecutionStepEvent['status'],
              startedAt: s.startedAt,
              completedAt: s.completedAt,
              outputKey: s.outputKey,
              outputPreview: s.outputPreview,
              error: s.error,
            }));

            return (
              <ExecutionTimeline
                key={exec.id}
                steps={steps}
                workflowName={exec.skillName}
                status={exec.status}
                outputs={exec.outputs}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
