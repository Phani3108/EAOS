/**
 * Product Section Views — Roadmap, PRDs, Epics, User Research, Competitive Intel,
 * Analytics, Launch Planning, Stakeholder Reports, OKRs, Feedback.
 * Each section provides a focused view for product management functions.
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */
'use client';

import { useState } from 'react';
import { useProductStore } from '../../store/persona-store';

// ---------------------------------------------------------------------------
// Roadmap
// ---------------------------------------------------------------------------

export function ProductRoadmapView() {
  const quarters = [
    {
      label: 'Q1 2026 (Current)',
      status: 'active' as const,
      items: [
        { name: 'AI Copilot Feature', status: 'in-progress', priority: 'P0', team: 'Team A', progress: 65 },
        { name: 'Enterprise Tier', status: 'in-progress', priority: 'P0', team: 'Platform', progress: 35 },
        { name: 'Mobile App Redesign', status: 'completed', priority: 'P1', team: 'Mobile', progress: 100 },
        { name: 'Performance Optimization', status: 'in-progress', priority: 'P1', team: 'Infrastructure', progress: 50 },
      ],
    },
    {
      label: 'Q2 2026',
      status: 'planned' as const,
      items: [
        { name: 'Collaboration Suite', status: 'planned', priority: 'P0', team: 'Team A', progress: 0 },
        { name: 'Analytics Dashboard v2', status: 'planned', priority: 'P0', team: 'Team B', progress: 0 },
        { name: 'API Platform v2', status: 'planned', priority: 'P1', team: 'Platform', progress: 0 },
        { name: 'Marketplace Launch', status: 'planned', priority: 'P2', team: 'Ecosystem', progress: 0 },
      ],
    },
    {
      label: 'Q3 2026',
      status: 'future' as const,
      items: [
        { name: 'AI Workflow Automation', status: 'ideation', priority: 'P0', team: 'TBD', progress: 0 },
        { name: 'Multi-tenant Architecture', status: 'ideation', priority: 'P1', team: 'Platform', progress: 0 },
        { name: 'Advanced Reporting', status: 'ideation', priority: 'P2', team: 'TBD', progress: 0 },
      ],
    },
  ];

  const STATUS_COLORS: Record<string, string> = {
    'completed': 'bg-emerald-500',
    'in-progress': 'bg-violet-500',
    'planned': 'bg-slate-300',
    'ideation': 'bg-slate-200',
  };

  const PRIORITY_STYLES: Record<string, { bg: string; text: string }> = {
    P0: { bg: 'bg-red-100', text: 'text-red-700' },
    P1: { bg: 'bg-amber-100', text: 'text-amber-700' },
    P2: { bg: 'bg-blue-100', text: 'text-blue-700' },
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Product Roadmap</h2>
        <p className="text-sm text-slate-600">Quarterly roadmap with priorities, progress, and team assignments.</p>
      </div>

      <div className="space-y-6">
        {quarters.map(q => (
          <div key={q.label} className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 mb-4">
              <h3 className="text-sm font-bold text-slate-900">{q.label}</h3>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                q.status === 'active' ? 'bg-violet-100 text-violet-700' :
                q.status === 'planned' ? 'bg-blue-100 text-blue-700' :
                'bg-slate-100 text-slate-600'
              }`}>{q.status}</span>
            </div>
            <div className="space-y-3">
              {q.items.map(item => {
                const pri = PRIORITY_STYLES[item.priority] ?? PRIORITY_STYLES.P2;
                return (
                  <div key={item.name} className="flex items-center gap-3">
                    <span className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${STATUS_COLORS[item.status]}`} />
                    <span className="text-sm font-medium text-slate-900 flex-1">{item.name}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${pri.bg} ${pri.text}`}>{item.priority}</span>
                    <span className="text-[11px] text-slate-400 w-20 text-right">{item.team}</span>
                    <div className="w-24 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full bg-violet-500 rounded-full" style={{ width: `${item.progress}%` }} />
                      </div>
                      <span className="text-[10px] text-slate-400 tabular-nums w-8 text-right">{item.progress}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PRDs & Specs
// ---------------------------------------------------------------------------

export function ProductPRDsView() {
  const prds = [
    { id: 'PRD-045', title: 'AI Copilot — In-App Assistant', status: 'approved' as const, author: 'Emma Zhang', updated: '2026-02-18', version: 'v2.1', pages: 24 },
    { id: 'PRD-044', title: 'Enterprise SSO & SAML Integration', status: 'approved' as const, author: 'Michael Torres', updated: '2026-02-10', version: 'v1.3', pages: 18 },
    { id: 'PRD-043', title: 'Collaboration Suite — Real-time Editing', status: 'in-review' as const, author: 'Emma Zhang', updated: '2026-02-20', version: 'v1.0', pages: 32 },
    { id: 'PRD-042', title: 'Analytics Dashboard v2', status: 'draft' as const, author: 'Sophia Lee', updated: '2026-02-15', version: 'v0.5', pages: 20 },
    { id: 'PRD-041', title: 'API Platform v2 — GraphQL Layer', status: 'draft' as const, author: 'Michael Torres', updated: '2026-02-12', version: 'v0.3', pages: 15 },
    { id: 'PRD-040', title: 'Marketplace & Integrations Platform', status: 'ideation' as const, author: 'Emma Zhang', updated: '2026-02-01', version: 'v0.1', pages: 8 },
  ];

  const STATUS: Record<string, { bg: string; text: string; label: string }> = {
    'approved': { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Approved' },
    'in-review': { bg: 'bg-amber-100', text: 'text-amber-700', label: 'In Review' },
    'draft': { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Draft' },
    'ideation': { bg: 'bg-violet-100', text: 'text-violet-700', label: 'Ideation' },
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">PRDs & Specifications</h2>
        <p className="text-sm text-slate-600">Product Requirements Documents, feature specs, and technical designs.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {[
          { label: 'Total PRDs', value: prds.length, color: 'text-slate-900' },
          { label: 'Approved', value: prds.filter(p => p.status === 'approved').length, color: 'text-emerald-600' },
          { label: 'In Review', value: prds.filter(p => p.status === 'in-review').length, color: 'text-amber-600' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[11px] text-slate-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {prds.map(prd => {
          const st = STATUS[prd.status];
          return (
            <div key={prd.id} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-slate-400">{prd.id}</span>
                  <h4 className="text-sm font-semibold text-slate-900">{prd.title}</h4>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-400 font-mono">{prd.version}</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${st.bg} ${st.text}`}>{st.label}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-500">
                <span>👤 {prd.author}</span>
                <span>📅 {prd.updated}</span>
                <span>📄 {prd.pages} pages</span>
              </div>
            </div>
          );
        })}
      </div>

      <button className="w-full py-3 rounded-xl border border-dashed border-slate-300 text-sm text-slate-500 hover:border-slate-400 hover:bg-slate-50 transition-colors">
        + Generate PRD with AI
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Epics & User Stories
// ---------------------------------------------------------------------------

export function ProductEpicsView() {
  const epics = [
    { id: 'EPIC-120', title: 'AI Copilot Integration', stories: 12, completed: 5, points: 42, sprint: 'Sprint 24', team: 'Team A' },
    { id: 'EPIC-119', title: 'Enterprise SSO', stories: 8, completed: 6, points: 34, sprint: 'Sprint 23', team: 'Platform' },
    { id: 'EPIC-118', title: 'Real-time Collaboration', stories: 15, completed: 0, points: 55, sprint: 'Backlog', team: 'Team A' },
    { id: 'EPIC-117', title: 'Audit Logging & Compliance', stories: 6, completed: 6, points: 21, sprint: 'Sprint 22', team: 'Platform' },
    { id: 'EPIC-116', title: 'Mobile App Redesign', stories: 10, completed: 10, points: 38, sprint: 'Sprint 21', team: 'Mobile' },
    { id: 'EPIC-115', title: 'Analytics Dashboard v2', stories: 9, completed: 0, points: 33, sprint: 'Backlog', team: 'Team B' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Epics & User Stories</h2>
        <p className="text-sm text-slate-600">Track epics, user stories, story points, and sprint assignments.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Active Epics', value: epics.filter(e => e.completed < e.stories).length, color: 'text-violet-600' },
          { label: 'Total Stories', value: epics.reduce((s, e) => s + e.stories, 0), color: 'text-slate-900' },
          { label: 'Completed', value: epics.reduce((s, e) => s + e.completed, 0), color: 'text-emerald-600' },
          { label: 'Total Points', value: epics.reduce((s, e) => s + e.points, 0), color: 'text-blue-600' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[11px] text-slate-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {epics.map(epic => {
          const pct = epic.stories > 0 ? Math.round((epic.completed / epic.stories) * 100) : 0;
          const done = epic.completed === epic.stories;
          return (
            <div key={epic.id} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 transition-colors">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-slate-400">{epic.id}</span>
                  <h4 className="text-sm font-semibold text-slate-900">{epic.title}</h4>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  done ? 'bg-emerald-100 text-emerald-700' : 'bg-violet-100 text-violet-700'
                }`}>{done ? 'Completed' : 'Active'}</span>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-violet-500 rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[11px] text-slate-500 tabular-nums w-8 text-right">{pct}%</span>
              </div>
              <div className="flex items-center gap-4 text-[11px] text-slate-500">
                <span>📦 {epic.completed}/{epic.stories} stories</span>
                <span>🎯 {epic.points} pts</span>
                <span>🏃 {epic.sprint}</span>
                <span>👥 {epic.team}</span>
              </div>
            </div>
          );
        })}
      </div>

      <button className="w-full py-3 rounded-xl border border-dashed border-slate-300 text-sm text-slate-500 hover:border-slate-400 hover:bg-slate-50 transition-colors">
        + Generate User Stories with AI
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// User Research
// ---------------------------------------------------------------------------

export function ProductUserResearchView() {
  const studies = [
    { id: 'UR-034', title: 'AI Copilot Usability Testing', type: 'Usability', participants: 8, status: 'completed', date: '2026-02-15', keyFinding: '87% task completion rate, avg 3.2s for first action' },
    { id: 'UR-033', title: 'Enterprise Buyer Journey Mapping', type: 'Journey Map', participants: 12, status: 'completed', date: '2026-02-05', keyFinding: 'Security & compliance are top 2 decision factors' },
    { id: 'UR-032', title: 'Dashboard UX Card Sort', type: 'Card Sort', participants: 15, status: 'in-progress', date: '2026-02-18', keyFinding: 'Users group analytics by time period, not feature' },
    { id: 'UR-031', title: 'Churn Analysis Interviews', type: 'Interview', participants: 6, status: 'in-progress', date: '2026-02-20', keyFinding: 'Lack of team collaboration is #1 churn reason' },
    { id: 'UR-030', title: 'Onboarding Funnel Analysis', type: 'Analytics', participants: 0, status: 'completed', date: '2026-01-28', keyFinding: '45% drop-off at step 3 (team invite)' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">User Research</h2>
        <p className="text-sm text-slate-600">Research studies, usability tests, customer interviews, and insights.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Active Studies', value: studies.filter(s => s.status === 'in-progress').length, color: 'text-violet-600' },
          { label: 'Completed', value: studies.filter(s => s.status === 'completed').length, color: 'text-emerald-600' },
          { label: 'Total Participants', value: studies.reduce((s, st) => s + st.participants, 0), color: 'text-slate-900' },
          { label: 'Key Insights', value: studies.length, color: 'text-blue-600' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[11px] text-slate-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {studies.map(study => (
          <div key={study.id} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 transition-colors">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-slate-400">{study.id}</span>
                <h4 className="text-sm font-semibold text-slate-900">{study.title}</h4>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">{study.type}</span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  study.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-violet-100 text-violet-700'
                }`}>{study.status}</span>
              </div>
            </div>
            <div className="rounded-lg bg-violet-50 border border-violet-100 p-3 mt-2">
              <p className="text-[11px] text-violet-800"><span className="font-semibold">Key Finding:</span> {study.keyFinding}</p>
            </div>
            <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-500">
              <span>👥 {study.participants} participants</span>
              <span>📅 {study.date}</span>
            </div>
          </div>
        ))}
      </div>

      <button className="w-full py-3 rounded-xl border border-dashed border-slate-300 text-sm text-slate-500 hover:border-slate-400 hover:bg-slate-50 transition-colors">
        + Generate Research Plan with AI
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Competitive Intelligence
// ---------------------------------------------------------------------------

export function ProductCompetitiveView() {
  const competitors = [
    { name: 'Competitor A', strengths: ['Enterprise features', 'Market leader'], weaknesses: ['Complex UI', 'High pricing'], marketShare: '35%', threat: 'high' as const },
    { name: 'Competitor B', strengths: ['Developer ecosystem', 'API-first'], weaknesses: ['Weak analytics', 'No mobile'], marketShare: '22%', threat: 'high' as const },
    { name: 'Competitor C', strengths: ['Low price point', 'Easy onboarding'], weaknesses: ['Limited integrations', 'No enterprise'], marketShare: '15%', threat: 'medium' as const },
    { name: 'Competitor D', strengths: ['AI-native', 'Modern UX'], weaknesses: ['New entrant', 'Small team'], marketShare: '5%', threat: 'medium' as const },
  ];

  const THREAT: Record<string, { bg: string; text: string }> = {
    high: { bg: 'bg-red-100', text: 'text-red-700' },
    medium: { bg: 'bg-amber-100', text: 'text-amber-700' },
    low: { bg: 'bg-blue-100', text: 'text-blue-700' },
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Competitive Intelligence</h2>
        <p className="text-sm text-slate-600">Competitor analysis, market positioning, and strategic insights.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {competitors.map(comp => {
          const t = THREAT[comp.threat];
          return (
            <div key={comp.name} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-slate-900">{comp.name}</h4>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500">{comp.marketShare} share</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${t.bg} ${t.text}`}>{comp.threat} threat</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-semibold text-emerald-600 uppercase mb-1">Strengths</p>
                  {comp.strengths.map(s => (
                    <p key={s} className="text-[11px] text-slate-600">✓ {s}</p>
                  ))}
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-red-600 uppercase mb-1">Weaknesses</p>
                  {comp.weaknesses.map(w => (
                    <p key={w} className="text-[11px] text-slate-600">✕ {w}</p>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <button className="w-full py-3 rounded-xl border border-dashed border-slate-300 text-sm text-slate-500 hover:border-slate-400 hover:bg-slate-50 transition-colors">
        + Run AI Competitive Analysis
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Product Analytics
// ---------------------------------------------------------------------------

export function ProductAnalyticsView() {
  const metrics = [
    { label: 'Daily Active Users', value: '12,847', change: '+8.3%', trend: 'up' as const },
    { label: 'Weekly Retention', value: '68.2%', change: '+2.1%', trend: 'up' as const },
    { label: 'Activation Rate', value: '45.6%', change: '-1.2%', trend: 'down' as const },
    { label: 'NPS Score', value: '62', change: '+5', trend: 'up' as const },
    { label: 'Feature Adoption', value: '34.8%', change: '+4.5%', trend: 'up' as const },
    { label: 'Time to Value', value: '3.2 days', change: '-0.5d', trend: 'up' as const },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Product Analytics</h2>
        <p className="text-sm text-slate-600">Usage metrics, retention analysis, and product health indicators.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {metrics.map(m => (
          <div key={m.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-[11px] text-slate-500 mb-1">{m.label}</p>
            <p className="text-2xl font-bold text-slate-900">{m.value}</p>
            <p className={`text-xs font-medium mt-1 ${m.trend === 'up' ? 'text-emerald-600' : 'text-red-600'}`}>
              {m.trend === 'up' ? '↑' : '↓'} {m.change}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500 text-sm">
        Product analytics dashboards will be populated from connected analytics tools.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Launch Planning
// ---------------------------------------------------------------------------

export function ProductLaunchView() {
  const launches = [
    {
      name: 'AI Copilot GA Launch',
      date: '2026-03-15',
      status: 'in-progress' as const,
      readiness: 65,
      checklist: [
        { item: 'PRD approved', done: true },
        { item: 'Engineering complete', done: false },
        { item: 'QA sign-off', done: false },
        { item: 'Documentation ready', done: true },
        { item: 'Marketing assets created', done: false },
        { item: 'Launch blog drafted', done: true },
        { item: 'Demo video recorded', done: false },
        { item: 'Support team briefed', done: false },
        { item: 'Pricing finalized', done: true },
        { item: 'Legal review complete', done: true },
      ],
    },
    {
      name: 'Enterprise Tier Launch',
      date: '2026-04-30',
      status: 'planning' as const,
      readiness: 25,
      checklist: [
        { item: 'PRD approved', done: true },
        { item: 'Engineering complete', done: false },
        { item: 'Sales enablement ready', done: false },
        { item: 'Pricing matrix finalized', done: false },
        { item: 'Enterprise docs ready', done: false },
        { item: 'Case studies created', done: false },
      ],
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Launch Planning</h2>
        <p className="text-sm text-slate-600">Launch checklists, readiness scores, and go-to-market coordination.</p>
      </div>

      <div className="space-y-6">
        {launches.map(launch => (
          <div key={launch.name} className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">🚀 {launch.name}</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">Target: {launch.date}</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-lg font-bold text-violet-600">{launch.readiness}%</p>
                  <p className="text-[10px] text-slate-400">readiness</p>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  launch.status === 'in-progress' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'
                }`}>{launch.status}</span>
              </div>
            </div>

            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden mb-4">
              <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${launch.readiness}%` }} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              {launch.checklist.map(c => (
                <div key={c.item} className="flex items-center gap-2 text-[12px]">
                  <span className={`h-4 w-4 rounded flex items-center justify-center text-[10px] ${
                    c.done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'
                  }`}>{c.done ? '✓' : '○'}</span>
                  <span className={c.done ? 'text-slate-600' : 'text-slate-900 font-medium'}>{c.item}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stakeholder Reports
// ---------------------------------------------------------------------------

export function ProductStakeholdersView() {
  const reports = [
    { id: 'SR-024', title: 'Weekly Product Update — Feb 20', type: 'Weekly', audience: 'Leadership', date: '2026-02-20', status: 'published' },
    { id: 'SR-023', title: 'Q1 Progress Report', type: 'Quarterly', audience: 'Board', date: '2026-02-18', status: 'published' },
    { id: 'SR-022', title: 'AI Copilot Feature Brief', type: 'Feature Brief', audience: 'Sales', date: '2026-02-15', status: 'published' },
    { id: 'SR-021', title: 'Enterprise Tier GTM Plan', type: 'GTM Plan', audience: 'Marketing + Sales', date: '2026-02-10', status: 'draft' },
    { id: 'SR-020', title: 'Competitive Landscape Update', type: 'Analysis', audience: 'Leadership', date: '2026-02-05', status: 'published' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Stakeholder Reports</h2>
        <p className="text-sm text-slate-600">Status updates, feature briefs, and executive reports for stakeholders.</p>
      </div>

      <div className="space-y-2">
        {reports.map(r => (
          <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-slate-400">{r.id}</span>
                <h4 className="text-sm font-semibold text-slate-900">{r.title}</h4>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                r.status === 'published' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
              }`}>{r.status}</span>
            </div>
            <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-500">
              <span>📊 {r.type}</span>
              <span>👥 {r.audience}</span>
              <span>📅 {r.date}</span>
            </div>
          </div>
        ))}
      </div>

      <button className="w-full py-3 rounded-xl border border-dashed border-slate-300 text-sm text-slate-500 hover:border-slate-400 hover:bg-slate-50 transition-colors">
        + Generate Stakeholder Report with AI
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Product Workflows
// ---------------------------------------------------------------------------

export function ProductWorkflowsView() {
  const setActiveSection = useProductStore((s) => s.setActiveSection);
  const setSelectedSkillId = useProductStore((s) => s.setSelectedSkillId);
  // `skillSlug` maps each card to a real Product skill (gateway product-skills-data),
  // so the chosen workflow is carried into the Run view and pre-selects that skill.
  // Mirrors the Marketing pattern (selectedWorkflowId set on card click, consumed by the run form).
  const workflows = [
    { id: 'pw-1', icon: '📄', name: 'PRD Generator', description: 'Generate comprehensive PRDs from product brief', cluster: 'Discovery', skillSlug: 'prd-generator' },
    { id: 'pw-2', icon: '🔬', name: 'User Research Plan', description: 'Create research plan with methodology selection', cluster: 'Discovery', skillSlug: 'user-story-generator' },
    { id: 'pw-3', icon: '🎯', name: 'Competitive Analysis', description: 'Deep competitive landscape analysis', cluster: 'Discovery', skillSlug: 'competitor-analysis-brief' },
    { id: 'pw-4', icon: '📦', name: 'Epic Breakdown', description: 'Break features into epics and user stories', cluster: 'Planning', skillSlug: 'jira-epic-generator' },
    { id: 'pw-5', icon: '🗺️', name: 'Roadmap Planning', description: 'AI-assisted quarterly roadmap planning', cluster: 'Planning', skillSlug: 'roadmap-builder' },
    { id: 'pw-6', icon: '📊', name: 'Sprint Review Prep', description: 'Prepare sprint review with metrics and demos', cluster: 'Planning', skillSlug: 'stakeholder-update-generator' },
    { id: 'pw-7', icon: '🚀', name: 'Launch Checklist', description: 'Generate comprehensive launch checklist', cluster: 'Launch', skillSlug: 'release-notes-generator' },
    { id: 'pw-8', icon: '📈', name: 'Stakeholder Report', description: 'Generate weekly/quarterly stakeholder updates', cluster: 'Communication', skillSlug: 'stakeholder-update-generator' },
    { id: 'pw-9', icon: '💬', name: 'Release Notes', description: 'Generate user-facing release notes from JIRA', cluster: 'Communication', skillSlug: 'release-notes-generator' },
    { id: 'pw-10', icon: '🎯', name: 'OKR Setting', description: 'AI-assisted OKR creation and alignment', cluster: 'Strategy', skillSlug: 'brd-generator' },
    { id: 'pw-11', icon: '📉', name: 'Churn Analysis', description: 'Analyze churn patterns and generate retention strategies', cluster: 'Strategy', skillSlug: 'customer-feedback-synthesizer' },
    { id: 'pw-12', icon: '💰', name: 'Pricing Analysis', description: 'Competitive pricing analysis and recommendations', cluster: 'Strategy', skillSlug: 'competitor-analysis-brief' },
  ];

  const clusters = Array.from(new Set(workflows.map(w => w.cluster)));

  const handleSelect = (skillSlug: string) => {
    setSelectedSkillId(skillSlug);
    setActiveSection('run');
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">{workflows.length} Product Workflows</h2>
        <p className="text-sm text-slate-600">Automated workflows for discovery, planning, launches, and communication.</p>
      </div>
      <div className="space-y-4">
        {clusters.map(cluster => (
          <div key={cluster} className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-bold text-slate-800 mb-3">{cluster}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {workflows.filter(w => w.cluster === cluster).map(wf => (
                <button key={wf.id} onClick={() => handleSelect(wf.skillSlug)}
                  className="flex flex-col gap-1.5 p-3 rounded-lg border border-slate-100 bg-violet-50 hover:border-violet-300 hover:bg-white text-left transition-colors">
                  <span className="text-lg">{wf.icon}</span>
                  <span className="text-xs font-semibold text-slate-800">{wf.name}</span>
                  <span className="text-[11px] text-slate-500 line-clamp-2">{wf.description}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OKRs & Metrics
// ---------------------------------------------------------------------------

export function ProductMetricsView() {
  const okrs = [
    {
      objective: 'Accelerate product-led growth',
      keyResults: [
        { kr: 'Increase DAU from 10K to 15K', progress: 86, target: '15,000', current: '12,847' },
        { kr: 'Improve activation rate to 55%', progress: 83, target: '55%', current: '45.6%' },
        { kr: 'Reduce time-to-value below 2 days', progress: 40, target: '2 days', current: '3.2 days' },
      ],
    },
    {
      objective: 'Launch enterprise tier successfully',
      keyResults: [
        { kr: 'Ship SSO, audit logs, and RBAC by Q1', progress: 60, target: '3 features', current: '2 shipped' },
        { kr: 'Close 5 enterprise design partners', progress: 40, target: '5', current: '2 signed' },
        { kr: 'Achieve 90% platform uptime SLA', progress: 98, target: '99.9%', current: '99.95%' },
      ],
    },
    {
      objective: 'Build best-in-class AI features',
      keyResults: [
        { kr: 'Launch AI Copilot to GA', progress: 65, target: 'GA launch', current: 'Beta' },
        { kr: 'Achieve 80% user satisfaction for AI features', progress: 70, target: '80%', current: '72%' },
        { kr: 'Process 1M AI requests/month', progress: 45, target: '1M', current: '450K' },
      ],
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">OKRs & Metrics</h2>
        <p className="text-sm text-slate-600">Company and product OKRs with real-time progress tracking.</p>
      </div>

      <div className="space-y-6">
        {okrs.map((okr, oi) => {
          const avgProgress = Math.round(okr.keyResults.reduce((s, k) => s + k.progress, 0) / okr.keyResults.length);
          return (
            <div key={oi} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-900">🎯 {okr.objective}</h3>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                  avgProgress >= 70 ? 'bg-emerald-100 text-emerald-700' :
                  avgProgress >= 40 ? 'bg-amber-100 text-amber-700' :
                  'bg-red-100 text-red-700'
                }`}>{avgProgress}% overall</span>
              </div>
              <div className="space-y-3">
                {okr.keyResults.map((kr, ki) => (
                  <div key={ki}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[12px] text-slate-700">{kr.kr}</span>
                      <span className="text-[11px] text-slate-400">{kr.current} / {kr.target}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className={`h-full rounded-full ${
                          kr.progress >= 70 ? 'bg-emerald-500' : kr.progress >= 40 ? 'bg-amber-500' : 'bg-red-500'
                        }`} style={{ width: `${kr.progress}%` }} />
                      </div>
                      <span className="text-[10px] text-slate-500 tabular-nums w-8 text-right">{kr.progress}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Customer Feedback
// ---------------------------------------------------------------------------

export function ProductFeedbackView() {
  const feedback = [
    { id: 'FB-234', source: 'Support Ticket', title: 'Need bulk export for analytics data', votes: 45, sentiment: 'neutral' as const, category: 'Feature Request', date: '2026-02-20' },
    { id: 'FB-233', source: 'NPS Response', title: 'Love the new AI features, but onboarding is confusing', votes: 0, sentiment: 'mixed' as const, category: 'UX', date: '2026-02-19' },
    { id: 'FB-232', source: 'G2 Review', title: 'Best tool for our workflow, API could be better', votes: 0, sentiment: 'positive' as const, category: 'Praise', date: '2026-02-18' },
    { id: 'FB-231', source: 'Support Ticket', title: 'SSO setup is too complex, needs better docs', votes: 23, sentiment: 'negative' as const, category: 'Documentation', date: '2026-02-17' },
    { id: 'FB-230', source: 'Feature Request', title: 'Slack integration for notifications', votes: 67, sentiment: 'neutral' as const, category: 'Feature Request', date: '2026-02-15' },
    { id: 'FB-229', source: 'Churn Survey', title: 'Switched because no real-time collaboration', votes: 0, sentiment: 'negative' as const, category: 'Churn', date: '2026-02-14' },
  ];

  const SENTIMENT: Record<string, { bg: string; text: string; icon: string }> = {
    positive: { bg: 'bg-emerald-100', text: 'text-emerald-700', icon: '😊' },
    neutral:  { bg: 'bg-slate-100',   text: 'text-slate-600',   icon: '😐' },
    mixed:    { bg: 'bg-amber-100',   text: 'text-amber-700',   icon: '🤔' },
    negative: { bg: 'bg-red-100',     text: 'text-red-700',     icon: '😟' },
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Customer Feedback</h2>
        <p className="text-sm text-slate-600">Aggregated feedback from support, NPS, reviews, and feature requests.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Feedback', value: feedback.length, color: 'text-slate-900' },
          { label: 'Feature Requests', value: feedback.filter(f => f.category === 'Feature Request').length, color: 'text-violet-600' },
          { label: 'Positive', value: feedback.filter(f => f.sentiment === 'positive').length, color: 'text-emerald-600' },
          { label: 'Negative', value: feedback.filter(f => f.sentiment === 'negative').length, color: 'text-red-600' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[11px] text-slate-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {feedback.map(f => {
          const sent = SENTIMENT[f.sentiment];
          return (
            <div key={f.id} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{sent.icon}</span>
                  <h4 className="text-sm font-semibold text-slate-900">{f.title}</h4>
                </div>
                <div className="flex items-center gap-2">
                  {f.votes > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-violet-50 text-violet-600 rounded font-medium">👍 {f.votes}</span>
                  )}
                  <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">{f.category}</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${sent.bg} ${sent.text}`}>{f.sentiment}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-500">
                <span>📩 {f.source}</span>
                <span>📅 {f.date}</span>
              </div>
            </div>
          );
        })}
      </div>

      <button className="w-full py-3 rounded-xl border border-dashed border-slate-300 text-sm text-slate-500 hover:border-slate-400 hover:bg-slate-50 transition-colors">
        + Analyze Feedback Trends with AI
      </button>
    </div>
  );
}
