'use client';
/**
 * OpsExecutionsView — consolidated Executions section.
 * Tabs: Executions · Scheduler · Agent Collaboration
 */
import { useState } from 'react';
import { PlatformConsole } from './PlatformConsole';
import { ExecutionScheduler } from './ExecutionScheduler';
import AgentCollaboration from './AgentCollaboration';

const TABS = [
  { id: 'executions', label: 'Executions'        },
  { id: 'scheduler',  label: 'Scheduler'          },
  { id: 'collab',     label: 'Agent Collaboration'},
] as const;
type Tab = typeof TABS[number]['id'];

export function OpsExecutionsView() {
  const [tab, setTab] = useState<Tab>('executions');
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-6 pt-4 pb-0 border-b border-slate-200 bg-white flex-shrink-0">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors -mb-px ${
              tab === t.id
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-400 hover:text-slate-700'
            }`}
          >{t.label}</button>
        ))}
      </div>
      <div className="flex-1 overflow-auto">
        {tab === 'executions' && <PlatformConsole />}
        {tab === 'scheduler'  && <ExecutionScheduler />}
        {tab === 'collab'     && <AgentCollaboration />}
      </div>
    </div>
  );
}
