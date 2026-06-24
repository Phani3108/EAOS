'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { useEAOSStore } from '../../store/eaos-store';
import { useConnectionsStore } from '../../store/connections-store';
import { getPreference, setPreference } from '../../lib/storage';
import { staggerContainer, staggerItem } from '../../lib/animations';

export function GettingStartedChecklist({ totalExecCount, onRunFirstSkill }: { totalExecCount: number; onRunFirstSkill?: () => void }) {
  const setActiveSection = useEAOSStore((s) => s.setActiveSection);
  const isToolConnected = useConnectionsStore((s) => s.isToolConnected);
  const connectedCount = useConnectionsStore((s) => s.getConnectedCount());
  const [dismissed, setDismissed] = useState(() => getPreference('getting_started_dismissed'));

  const hasLLM = isToolConnected('anthropic') || isToolConnected('openai') || isToolConnected('azure-openai');
  const steps = [
    { id: 'llm', title: 'Connect an LLM', why: 'Powers real agent output (otherwise runs in sandbox).', done: hasLLM, label: 'Add API key', go: () => setActiveSection('conn-ai-models') },
    { id: 'tool', title: 'Connect a tool', why: 'Let agents act in GitHub, Jira, Slack, and more.', done: connectedCount > 0, label: 'Open Integrations', go: () => setActiveSection('platform-connections') },
    { id: 'run', title: 'Run your first skill', why: 'See the magic — pick a skill, configure, execute.', done: totalExecCount > 0, label: 'Run a skill', go: () => (onRunFirstSkill ? onRunFirstSkill() : setActiveSection('platform-skills')) },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  if (dismissed) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">Get started</h2>
          <p className="text-[13px] text-slate-500">{allDone ? "You're all set — explore freely." : `${doneCount} of ${steps.length} done`}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-28 h-2 bg-slate-100 rounded-full overflow-hidden">
            <motion.div className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full" initial={{ width: 0 }} animate={{ width: `${(doneCount / steps.length) * 100}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
          </div>
          <button onClick={() => { setPreference('getting_started_dismissed', true); setDismissed(true); }} className="text-slate-400 hover:text-slate-600 text-sm" aria-label="Dismiss">×</button>
        </div>
      </div>
      <motion.div initial="hidden" animate="show" variants={staggerContainer(0.05)} className="space-y-2">
        {steps.map((s, i) => (
          <motion.div key={s.id} variants={staggerItem} className={`flex items-center gap-3 p-3 rounded-xl border ${s.done ? 'border-emerald-100 bg-emerald-50/40' : 'border-slate-200'}`}>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${s.done ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}>{s.done ? '✓' : i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${s.done ? 'text-slate-500 line-through' : 'text-slate-900'}`}>{s.title}</p>
              {!s.done && <p className="text-[12px] text-slate-400">{s.why}</p>}
            </div>
            {!s.done && <button onClick={s.go} className="text-xs font-medium text-blue-600 hover:text-blue-700 px-3 py-1.5 rounded-lg hover:bg-blue-50 flex-shrink-0">{s.label} →</button>}
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
export default GettingStartedChecklist;
