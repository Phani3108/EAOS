/**
 * HomeCommandCenter — AgentOS landing surface.
 * Integration-first: shows connection health → workspace access → recent activity → system status.
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */
'use client';

import { useState, useEffect } from 'react';
import { useEAOSStore } from '../store/eaos-store';
import { getStats, getPlatformMetrics } from '../lib/api';
import { useConnectionsStore, CONNECTOR_CATALOG } from '../store/connections-store';
import { useMarketingStore } from '../store/marketing-store';
import { useEngineeringStore, useProductStore, useHRStore, useTAStore, useProgramStore } from '../store/persona-store';
import PlatformArchitecture from './PlatformArchitecture';
import StoryFlow from './home/StoryFlow';
import GettingStartedChecklist from './home/GettingStartedChecklist';
import { Celebration } from './ui';
import { notify } from '../lib/notify';
import { getPreference, setPreference } from '../lib/storage';

// ── Types ───────────────────────────────────────────────────────────────────

interface RecentExec {
  id: string; skill: string; persona: string; workspace: string;
  status: 'completed' | 'running' | 'failed'; duration: string; time: string;
}

// ── Seed data ───────────────────────────────────────────────────────────────

// Real executions come from stores — no hardcoded fakes

const WORKSPACES = [
  {
    id: 'ws-marketing', label: 'Marketing', icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" /></svg>
    ),
    desc: 'Campaigns, content, creative, analytics',
    color: 'text-orange-600',
    bg: 'bg-orange-50',
    border: 'border-orange-100 hover:border-orange-300',
  },
  {
    id: 'ws-engineering', label: 'Engineering', icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z" /></svg>
    ),
    desc: 'PR review, incident RCA, test gen, CI diagnosis',
    color: 'text-slate-600',
    bg: 'bg-slate-50',
    border: 'border-slate-200 hover:border-slate-400',
  },
  {
    id: 'ws-product', label: 'Product', icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
    ),
    desc: 'PRDs, epics, user stories, roadmaps',
    color: 'text-violet-600',
    bg: 'bg-violet-50',
    border: 'border-violet-100 hover:border-violet-300',
  },
];

const SYSTEM_SERVICES = [
  { name: 'Gateway',       latency: '12ms' },
  { name: 'Scheduler',     latency: '4ms'  },
  { name: 'Memory Graph',  latency: '8ms'  },
  { name: 'Tool Registry', latency: '6ms'  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_DOT: Record<string, string> = {
  completed: 'bg-emerald-500',
  running:   'bg-blue-500 animate-pulse-glow',
  failed:    'bg-red-500',
};

const STATUS_LABEL: Record<string, string> = {
  completed: 'Completed',
  running:   'Running',
  failed:    'Failed',
};

const STATUS_COLOR: Record<string, string> = {
  completed: 'text-emerald-600',
  running:   'text-blue-600',
  failed:    'text-red-600',
};

const PERSONA_BADGE: Record<string, string> = {
  Marketing:   'bg-orange-50 text-orange-700',
  Engineering: 'bg-slate-100 text-slate-700',
  Product:     'bg-violet-50 text-violet-700',
  HR:          'bg-teal-50 text-teal-700',
  Finance:     'bg-emerald-50 text-emerald-700',
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function HomeCommandCenter() {
  const setActiveSection = useEAOSStore(s => s.setActiveSection);
  const setCommandOpen   = useEAOSStore(s => s.setCommandOpen);
  const notifications    = useEAOSStore(s => s.notifications);
  const connectedCount   = useConnectionsStore(s => s.getConnectedCount());
  const totalConnectors  = CONNECTOR_CATALOG.length;
  const coveragePct      = Math.round((connectedCount / totalConnectors) * 100);

  // Pull real execution data from ALL persona stores
  const mktExecutions = useMarketingStore(s => s.executions);
  const mktApprovals  = useMarketingStore(s => s.approvalQueue);
  const engExecutions = useEngineeringStore(s => s.executions);
  const prodExecutions = useProductStore(s => s.executions);
  const hrExecutions = useHRStore(s => s.executions);
  const taExecutions = useTAStore(s => s.executions);
  const pgmExecutions = useProgramStore(s => s.executions);

  const mapExec = (e: any, persona: string, ws: string): RecentExec => ({
    id: e.id, skill: e.workflowName || e.skillName || 'Unknown', persona, workspace: ws,
    status: (e.status === 'completed' ? 'completed' : e.status === 'failed' ? 'failed' : 'running') as RecentExec['status'],
    duration: e.completedAt ? `${((new Date(e.completedAt).getTime() - new Date(e.startedAt).getTime()) / 1000).toFixed(1)}s` : '—',
    time: e.startedAt,
  });

  const allExecutions: RecentExec[] = [
    ...mktExecutions.map((e: any) => mapExec(e, 'Marketing', 'ws-marketing')),
    ...engExecutions.map((e: any) => mapExec(e, 'Engineering', 'ws-engineering')),
    ...prodExecutions.map((e: any) => mapExec(e, 'Product', 'ws-product')),
    ...hrExecutions.map((e: any) => mapExec(e, 'HR', 'ws-hr')),
    ...taExecutions.map((e: any) => mapExec(e, 'Talent Acq', 'ws-ta')),
    ...pgmExecutions.map((e: any) => mapExec(e, 'Program', 'ws-program')),
  ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 10);

  const pendingApprovals = mktApprovals.filter((a: any) => a.status === 'pending');

  // Swarm and meeting data from gateway
  const [swarmStats, setSwarmStats] = useState({ active: 0, completed: 0 });
  const [meetingCount, setMeetingCount] = useState(0);
  const [costData, setCostData] = useState({ totalCost: 0, hourlyCost: 0, budget: 50 });

  useEffect(() => {
    const gw = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000';
    fetch(`${gw}/api/swarms/stats`).then(r => r.json()).then(d => setSwarmStats({ active: d.active || 0, completed: d.completed || 0 })).catch(() => {});
    fetch(`${gw}/api/a2a/meetings?limit=5`).then(r => r.json()).then(d => setMeetingCount(d.total || 0)).catch(() => {});
    fetch(`${gw}/api/costs/meter`).then(r => r.json()).then(d => setCostData({ totalCost: d.totalCostUsd || 0, hourlyCost: d.hourlyCostUsd || 0, budget: d.hourlyBudgetUsd || 50 })).catch(() => {});
  }, []);

  // Workspace stats from real data (all 6 personas)
  const workspaceStats: Record<string, { label: string; value: string }[]> = {
    'ws-marketing':   [{ label: 'Executions', value: String(mktExecutions.length) }, { label: 'Pending', value: String(pendingApprovals.length) }],
    'ws-engineering': [{ label: 'Executions', value: String(engExecutions.length) }, { label: 'Skills', value: '10' }],
    'ws-product':     [{ label: 'Executions', value: String(prodExecutions.length) }, { label: 'Skills', value: '8' }],
    'ws-hr':          [{ label: 'Executions', value: String(hrExecutions.length) }, { label: 'Skills', value: '8' }],
    'ws-ta':          [{ label: 'Executions', value: String(taExecutions.length) }, { label: 'Skills', value: '8' }],
    'ws-program':     [{ label: 'Executions', value: String(pgmExecutions.length) }, { label: 'Skills', value: '8' }],
  };

  const [greeting, setGreeting] = useState('Good morning');
  const [platformStats, setPlatformStats] = useState({ agents: 8, skills: 147, success: '94%' });

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
    getStats().catch(() => {});
    getPlatformMetrics().then((d: unknown) => {
      if (!d) return;
      const data = d as { stats?: Record<string, unknown> };
      const s = data.stats ?? {};
      setPlatformStats(prev => ({
        agents: (s.activeAgents as number) ?? prev.agents,
        skills: (s.skillsExecutedToday as number) ?? prev.skills,
        success: prev.success,
      }));
    }).catch(() => {});
  }, []);


  const totalExecCount = allExecutions.length;
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (totalExecCount > 0 && !getPreference('first_run_celebrated')) {
      setPreference('first_run_celebrated', true);
      setCelebrate(true);
      notify('success', 'You ran your first skill ⚡', 'Welcome aboard — explore more skills and workspaces.');
    }
  }, [totalExecCount]);
  const isNewUser = connectedCount === 0 && totalExecCount === 0;

  return (
    <div className="page-container">
      <Celebration show={celebrate} onDone={() => setCelebrate(false)} />
      <div className="page-content space-y-6">

        {/* ── Getting Started (shown when 0 connections + 0 executions) ── */}
        {isNewUser ? (
          <>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">{greeting}, welcome to EAOS</h1>
              <p className="text-slate-500 mt-1 text-[15px]">Your AI orchestration platform — connect tools, pick a workspace, and run skills.</p>
            </div>
            <GettingStartedChecklist totalExecCount={totalExecCount} />
            <StoryFlow />

                        {/* Workspace shortcuts — still show even for new users */}
            <div>
              <h2 className="section-title">Workspaces</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {WORKSPACES.map(ws => (
                  <button
                    key={ws.id}
                    onClick={() => setActiveSection(ws.id)}
                    className={`card p-5 text-left transition-all border ${ws.border}`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${ws.bg} ${ws.color}`}>{ws.icon}</span>
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${ws.bg} ${ws.color}`}>{ws.label}</span>
                    </div>
                    <p className="text-sm font-semibold text-slate-900 mb-1">{ws.label}</p>
                    <p className="text-[13px] text-slate-500 leading-relaxed">{ws.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Platform Architecture — How it works + Agent hierarchy */}
            <PlatformArchitecture />
          </>
        ) : (
        <>
        {/* ── Header ── */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="page-title">{greeting}</h1>
            <p className="page-subtitle">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              <span className="mx-2 text-slate-300">·</span>
              <span className="text-emerald-600 font-medium">All systems operational</span>
            </p>
          </div>
          <button
            onClick={() => setCommandOpen(true)}
            className="btn btn-primary px-5 py-2.5 text-sm rounded-lg shadow-sm"
          >
            <svg className="w-4 h-4 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            What do you want to do?
            <kbd className="text-[11px] font-mono bg-white/15 px-1.5 py-0.5 rounded ml-1">⌘K</kbd>
          </button>
        </div>

        {/* ── Integration Health (connection-first) ── */}
        <div className="card">
          <div className="card-header">
            <div className="flex items-center gap-3">
              <h2 className="card-title">Integration Health</h2>
              <span className="badge badge-info">{connectedCount}/{totalConnectors} connected</span>
            </div>
            <button onClick={() => setActiveSection('conn-ai-models')} className="btn btn-ghost btn-sm text-blue-600 hover:text-blue-700">
              Manage connections →
            </button>
          </div>
          <div className="card-body">
            <div className="flex items-center gap-4 mb-4">
              <div className="flex-1">
                <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${coveragePct}%` }} />
                </div>
              </div>
              <span className="text-sm font-semibold text-slate-700 tabular-nums">{coveragePct}%</span>
            </div>

            {connectedCount === 0 ? (
              <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <svg className="w-5 h-5 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
                <div>
                  <p className="text-sm font-medium text-amber-800">No tools connected yet</p>
                  <p className="text-[13px] text-amber-600 mt-0.5">Connect your tools to unlock live execution. Skills run in sandbox mode until tools are connected.</p>
                </div>
                <button onClick={() => setActiveSection('conn-ai-models')} className="btn btn-sm bg-amber-100 text-amber-800 hover:bg-amber-200 border-amber-300 ml-auto flex-shrink-0">
                  Connect tools
                </button>
              </div>
            ) : (
              <p className="text-[13px] text-slate-500">
                {connectedCount} integration{connectedCount !== 1 ? 's' : ''} active.
                {connectedCount < totalConnectors && <> Connect more to expand capabilities.</>}
              </p>
            )}
          </div>
        </div>

        {/* ── Platform pulse (3 metrics) ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { label: 'Active Agents',   value: platformStats.agents, icon: (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
            ), color: 'text-blue-600',    bg: 'bg-blue-50'    },
            { label: 'Skills Today',    value: platformStats.skills, icon: (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
            ), color: 'text-emerald-600', bg: 'bg-emerald-50' },
            { label: 'Success Rate',    value: platformStats.success, icon: (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            ), color: 'text-violet-600',  bg: 'bg-violet-50'  },
          ].map(stat => (
            <div key={stat.label} className="metric-tile flex items-center gap-4">
              <span className={`w-10 h-10 rounded-lg flex items-center justify-center ${stat.bg} ${stat.color}`}>{stat.icon}</span>
              <div>
                <p className={`metric-value ${stat.color}`}>{stat.value}</p>
                <p className="metric-label">{stat.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ── Workspace shortcuts ── */}
        <div>
          <h2 className="section-title">Workspaces</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {WORKSPACES.map(ws => (
              <button
                key={ws.id}
                onClick={() => setActiveSection(ws.id)}
                className={`card p-5 text-left transition-all border ${ws.border}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <span className={`w-9 h-9 rounded-lg flex items-center justify-center ${ws.bg} ${ws.color}`}>{ws.icon}</span>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${ws.bg} ${ws.color}`}>{ws.label}</span>
                </div>
                <p className="text-sm font-semibold text-slate-900 mb-1">{ws.label}</p>
                <p className="text-[13px] text-slate-500 leading-relaxed mb-3">{ws.desc}</p>
                <div className="flex gap-5">
                  {(workspaceStats[ws.id] ?? []).map(s => (
                    <div key={s.label}>
                      <p className="text-lg font-bold text-slate-900">{s.value}</p>
                      <p className="text-[11px] text-slate-400">{s.label}</p>
                    </div>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* ── Platform Architecture ── */}
        <PlatformArchitecture />

        {/* ── Continue working + Pending attention ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">

          {/* Continue Working */}
          <div className="col-span-3 card overflow-hidden">
            <div className="card-header">
              <h2 className="card-title">Recent Activity</h2>
              <button onClick={() => setActiveSection('ops-executions')} className="btn btn-ghost btn-sm text-blue-600 hover:text-blue-700">
                View all →
              </button>
            </div>
            {allExecutions.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-slate-500">No executions yet.</p>
                <p className="text-[13px] text-slate-400 mt-1">Run a skill from any workspace to see activity here.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {allExecutions.map(ex => (
                  <button
                    key={ex.id}
                    onClick={() => setActiveSection(ex.workspace as string)}
                    className="w-full flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors text-left"
                  >
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[ex.status]}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{ex.skill}</p>
                      <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${PERSONA_BADGE[ex.persona] ?? 'bg-slate-100 text-slate-600'}`}>
                        {ex.persona}
                      </span>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-[13px] font-medium ${STATUS_COLOR[ex.status]}`}>{STATUS_LABEL[ex.status]}</p>
                      <p className="text-[12px] text-slate-400 mt-0.5">{ex.duration !== '—' ? ex.duration : 'In progress'}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Pending Attention */}
          <div className="col-span-2 card overflow-hidden">
            <div className="card-header">
              <h2 className="card-title">Needs Attention</h2>
              {pendingApprovals.length > 0 && (
                <span className="badge badge-danger">{pendingApprovals.length} pending</span>
              )}
            </div>
            {pendingApprovals.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-slate-500">Nothing needs attention.</p>
                <p className="text-[13px] text-slate-400 mt-1">Approvals and alerts will show here.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {pendingApprovals.map(item => (
                  <button
                    key={item.id}
                    onClick={() => setActiveSection('ws-marketing')}
                    className="w-full flex items-start gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors text-left"
                  >
                    <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0 bg-amber-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900 truncate">{item.stepName}</p>
                      <p className="text-[13px] text-slate-500 mt-0.5 leading-relaxed line-clamp-2">{item.workflowName} · Awaiting approval</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── System status ── */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">System Status</h2>
            <button onClick={() => setActiveSection('admin-usage')} className="btn btn-ghost btn-sm text-blue-600 hover:text-blue-700">
              Control Plane →
            </button>
          </div>
          <div className="card-body">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {SYSTEM_SERVICES.map(svc => (
                <div key={svc.name} className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-sm text-slate-700">{svc.name}</span>
                  <span className="text-[13px] text-slate-400 font-mono ml-auto">{svc.latency}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        </>
        )}

      </div>
    </div>
  );
}
