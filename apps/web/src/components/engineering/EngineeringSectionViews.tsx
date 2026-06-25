/**
 * Engineering Section Views — Code Review, Incidents, Architecture, Testing,
 * Deployments, Documentation, Security, Pipelines, Tech Debt, On-Call.
 * Each section provides a focused view for engineering functions.
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */
'use client';

import { useState } from 'react';
import { useEngineeringStore } from '../../store/persona-store';

// ---------------------------------------------------------------------------
// Code Review Hub
// ---------------------------------------------------------------------------

const SAMPLE_PRS = [
  { id: 'PR-2341', title: 'feat: Add event bus retry logic', author: 'alex.r', status: 'ready' as const, reviewers: ['david.k', 'lisa.p'], linesAdded: 245, linesRemoved: 32, repo: 'platform-core', age: '2h', labels: ['feature', 'backend'] },
  { id: 'PR-2340', title: 'fix: Auth token refresh race condition', author: 'maya.l', status: 'changes-requested' as const, reviewers: ['alex.r'], linesAdded: 18, linesRemoved: 5, repo: 'auth-service', age: '1d', labels: ['bugfix', 'critical'] },
  { id: 'PR-2339', title: 'refactor: Migrate user service to new schema', author: 'david.k', status: 'approved' as const, reviewers: ['lisa.p', 'maya.l'], linesAdded: 892, linesRemoved: 1204, repo: 'user-service', age: '3d', labels: ['migration', 'database'] },
  { id: 'PR-2338', title: 'chore: Upgrade dependencies, fix audit warnings', author: 'ci-bot', status: 'ready' as const, reviewers: [], linesAdded: 1200, linesRemoved: 980, repo: 'platform-core', age: '5h', labels: ['dependencies'] },
  { id: 'PR-2337', title: 'feat: Real-time notification WebSocket handler', author: 'priya.k', status: 'draft' as const, reviewers: [], linesAdded: 420, linesRemoved: 0, repo: 'notification-service', age: '1d', labels: ['feature', 'websocket'] },
  { id: 'PR-2336', title: 'test: Add integration tests for billing flow', author: 'lisa.p', status: 'ready' as const, reviewers: ['david.k'], linesAdded: 380, linesRemoved: 12, repo: 'billing-service', age: '4h', labels: ['testing'] },
];

const PR_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  'ready':             { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Ready for Review' },
  'changes-requested': { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'Changes Requested' },
  'approved':          { bg: 'bg-blue-100',     text: 'text-blue-700',    label: 'Approved' },
  'draft':             { bg: 'bg-slate-100',    text: 'text-slate-600',   label: 'Draft' },
};

export function EngineeringCodeReviewView() {
  const [filter, setFilter] = useState<string | null>(null);
  const filtered = filter ? SAMPLE_PRS.filter(p => p.status === filter) : SAMPLE_PRS;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Code Review Hub</h2>
        <p className="text-sm text-slate-600">AI-assisted pull request reviews, automated suggestions, and review queue management.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Open PRs', value: SAMPLE_PRS.length, color: 'text-blue-600' },
          { label: 'Ready for Review', value: SAMPLE_PRS.filter(p => p.status === 'ready').length, color: 'text-emerald-600' },
          { label: 'Changes Requested', value: SAMPLE_PRS.filter(p => p.status === 'changes-requested').length, color: 'text-amber-600' },
          { label: 'Approved', value: SAMPLE_PRS.filter(p => p.status === 'approved').length, color: 'text-slate-900' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[11px] text-slate-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        {[null, 'ready', 'changes-requested', 'approved', 'draft'].map(f => (
          <button key={f ?? 'all'} onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
              filter === f ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}>
            {f ? PR_STATUS_STYLES[f].label : `All (${SAMPLE_PRS.length})`}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {filtered.map(pr => {
          const st = PR_STATUS_STYLES[pr.status];
          return (
            <div key={pr.id} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 transition-colors">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-slate-400">{pr.id}</span>
                    <h4 className="text-sm font-semibold text-slate-900">{pr.title}</h4>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-500">
                    <span>👤 {pr.author}</span>
                    <span>📦 {pr.repo}</span>
                    <span className="text-emerald-600">+{pr.linesAdded}</span>
                    <span className="text-red-500">-{pr.linesRemoved}</span>
                    <span>⏱ {pr.age}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    {pr.labels.map(l => (
                      <span key={l} className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded font-medium">{l}</span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${st.bg} ${st.text}`}>{st.label}</span>
                  {pr.reviewers.length > 0 && (
                    <span className="text-[10px] text-slate-400">{pr.reviewers.join(', ')}</span>
                  )}
                  <button className="text-[11px] px-3 py-1 rounded-lg bg-slate-900 text-white font-medium hover:bg-slate-800">
                    AI Review →
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Incidents & Postmortems
// ---------------------------------------------------------------------------

const SAMPLE_INCIDENTS: { id: string; title: string; severity: 'P1' | 'P2' | 'P3'; status: 'active' | 'monitoring' | 'resolved'; startedAt: string; resolvedAt: string | null; owner: string; affectedServices: string[]; rootCause: string }[] = [
  { id: 'INC-089', title: 'Database connection pool exhaustion', severity: 'P1', status: 'resolved', startedAt: '2026-02-20T03:15:00Z', resolvedAt: '2026-02-20T04:45:00Z', owner: 'David Kim', affectedServices: ['user-service', 'billing-service'], rootCause: 'Connection leak in transaction handler' },
  { id: 'INC-088', title: 'CDN cache invalidation failure', severity: 'P2', status: 'monitoring', startedAt: '2026-02-19T14:30:00Z', resolvedAt: null, owner: 'Lisa Park', affectedServices: ['cdn-proxy'], rootCause: 'Pending investigation' },
  { id: 'INC-087', title: 'Webhook delivery delays > 30min', severity: 'P2', status: 'resolved', startedAt: '2026-02-18T09:00:00Z', resolvedAt: '2026-02-18T10:30:00Z', owner: 'Alex R.', affectedServices: ['webhook-service', 'queue'], rootCause: 'Redis queue backpressure from burst traffic' },
  { id: 'INC-086', title: 'Auth service 503 errors during deploy', severity: 'P1', status: 'resolved', startedAt: '2026-02-15T16:20:00Z', resolvedAt: '2026-02-15T16:50:00Z', owner: 'Maya L.', affectedServices: ['auth-service'], rootCause: 'Rolling deploy health check misconfiguration' },
];

const SEVERITY_STYLES: Record<string, { bg: string; text: string }> = {
  'P1': { bg: 'bg-red-100', text: 'text-red-700' },
  'P2': { bg: 'bg-amber-100', text: 'text-amber-700' },
  'P3': { bg: 'bg-blue-100', text: 'text-blue-700' },
};

const INCIDENT_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  'active':     { bg: 'bg-red-100',     text: 'text-red-700',     label: 'Active' },
  'monitoring': { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'Monitoring' },
  'resolved':   { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Resolved' },
};

export function EngineeringIncidentsView() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Incidents & Postmortems</h2>
        <p className="text-sm text-slate-600">Track incidents, generate AI postmortems, and identify patterns.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Incidents', value: SAMPLE_INCIDENTS.length, color: 'text-slate-900' },
          { label: 'Active', value: SAMPLE_INCIDENTS.filter(i => i.status === 'active').length, color: 'text-red-600' },
          { label: 'Monitoring', value: SAMPLE_INCIDENTS.filter(i => i.status === 'monitoring').length, color: 'text-amber-600' },
          { label: 'MTTR (avg)', value: '82 min', color: 'text-blue-600' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[11px] text-slate-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {SAMPLE_INCIDENTS.map(inc => {
          const sev = SEVERITY_STYLES[inc.severity];
          const ist = INCIDENT_STATUS_STYLES[inc.status];
          return (
            <div key={inc.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sev.bg} ${sev.text}`}>{inc.severity}</span>
                    <span className="text-xs font-mono text-slate-400">{inc.id}</span>
                    <h4 className="text-sm font-semibold text-slate-900">{inc.title}</h4>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-1">
                    <span>👤 {inc.owner}</span>
                    <span>🕐 {new Date(inc.startedAt).toLocaleString()}</span>
                    <span>📦 {inc.affectedServices.join(', ')}</span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-2"><span className="font-semibold">Root Cause:</span> {inc.rootCause}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${ist.bg} ${ist.text}`}>{ist.label}</span>
                  <button className="text-[11px] px-3 py-1 rounded-lg bg-slate-900 text-white font-medium hover:bg-slate-800">
                    AI Postmortem →
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Architecture & ADRs
// ---------------------------------------------------------------------------

const SAMPLE_ADRS = [
  { id: 'ADR-012', title: 'Adopt event-driven architecture for inter-service communication', status: 'accepted' as const, date: '2026-02-10', author: 'David Kim', category: 'Architecture' },
  { id: 'ADR-011', title: 'Use PostgreSQL JSONB for flexible document storage', status: 'accepted' as const, date: '2026-01-25', author: 'Lisa Park', category: 'Data' },
  { id: 'ADR-010', title: 'Migrate from REST to GraphQL for frontend API layer', status: 'proposed' as const, date: '2026-02-15', author: 'Alex R.', category: 'API' },
  { id: 'ADR-009', title: 'Implement circuit breaker pattern for external service calls', status: 'accepted' as const, date: '2026-01-15', author: 'Maya L.', category: 'Resilience' },
  { id: 'ADR-008', title: 'Use OpenTelemetry for distributed tracing', status: 'accepted' as const, date: '2026-01-05', author: 'David Kim', category: 'Observability' },
  { id: 'ADR-007', title: 'Evaluate Rust for performance-critical worker services', status: 'proposed' as const, date: '2026-02-18', author: 'Priya K.', category: 'Language' },
];

export function EngineeringArchitectureView() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Architecture & ADRs</h2>
        <p className="text-sm text-slate-600">Architecture Decision Records, system design documentation, and AI-generated architecture reviews.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {[
          { label: 'Total ADRs', value: SAMPLE_ADRS.length, color: 'text-slate-900' },
          { label: 'Accepted', value: SAMPLE_ADRS.filter(a => a.status === 'accepted').length, color: 'text-emerald-600' },
          { label: 'Proposed', value: SAMPLE_ADRS.filter(a => a.status === 'proposed').length, color: 'text-amber-600' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[11px] text-slate-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {SAMPLE_ADRS.map(adr => (
          <div key={adr.id} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-slate-400">{adr.id}</span>
                <h4 className="text-sm font-semibold text-slate-900">{adr.title}</h4>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">{adr.category}</span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  adr.status === 'accepted' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                }`}>{adr.status}</span>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-500">
              <span>👤 {adr.author}</span>
              <span>📅 {adr.date}</span>
            </div>
          </div>
        ))}
      </div>

      <button className="w-full py-3 rounded-xl border border-dashed border-slate-300 text-sm text-slate-500 hover:border-slate-400 hover:bg-slate-50 transition-colors">
        + Generate AI Architecture Review
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Testing & QA
// ---------------------------------------------------------------------------

export function EngineeringTestingView() {
  const suites = [
    { name: 'Unit Tests', total: 1247, passed: 1235, failed: 8, skipped: 4, duration: '2m 14s', icon: '🧪' },
    { name: 'Integration Tests', total: 342, passed: 328, failed: 12, skipped: 2, duration: '8m 42s', icon: '🔗' },
    { name: 'E2E Tests', total: 89, passed: 82, failed: 5, skipped: 2, duration: '15m 30s', icon: '🌐' },
    { name: 'Performance Tests', total: 24, passed: 22, failed: 2, skipped: 0, duration: '45m 10s', icon: '⚡' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Testing & QA</h2>
        <p className="text-sm text-slate-600">Test suite results, coverage reports, and AI-generated test suggestions.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Tests', value: suites.reduce((s, t) => s + t.total, 0), color: 'text-slate-900' },
          { label: 'Passing', value: suites.reduce((s, t) => s + t.passed, 0), color: 'text-emerald-600' },
          { label: 'Failing', value: suites.reduce((s, t) => s + t.failed, 0), color: 'text-red-600' },
          { label: 'Coverage', value: '87.4%', color: 'text-blue-600' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[11px] text-slate-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        {suites.map(suite => {
          const passRate = Math.round((suite.passed / suite.total) * 100);
          return (
            <div key={suite.name} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{suite.icon}</span>
                  <h4 className="text-sm font-bold text-slate-900">{suite.name}</h4>
                </div>
                <span className="text-[11px] text-slate-400">{suite.duration}</span>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden flex">
                  <div className="bg-emerald-500 h-full" style={{ width: `${(suite.passed/suite.total)*100}%` }} />
                  <div className="bg-red-500 h-full" style={{ width: `${(suite.failed/suite.total)*100}%` }} />
                  <div className="bg-slate-300 h-full" style={{ width: `${(suite.skipped/suite.total)*100}%` }} />
                </div>
                <span className="text-[11px] font-medium text-slate-600 tabular-nums w-10 text-right">{passRate}%</span>
              </div>
              <div className="flex items-center gap-4 text-[11px]">
                <span className="text-emerald-600">✓ {suite.passed} passed</span>
                <span className="text-red-600">✕ {suite.failed} failed</span>
                <span className="text-slate-400">◦ {suite.skipped} skipped</span>
              </div>
            </div>
          );
        })}
      </div>

      <button className="w-full py-3 rounded-xl border border-dashed border-slate-300 text-sm text-slate-500 hover:border-slate-400 hover:bg-slate-50 transition-colors">
        + Generate AI Test Suggestions
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deployments & CI/CD
// ---------------------------------------------------------------------------

const SAMPLE_DEPLOYS = [
  { id: 'deploy-234', service: 'platform-core', version: 'v3.2.1', env: 'production' as const, status: 'success' as const, triggeredBy: 'david.k', timestamp: '2026-02-20T14:30:00Z', duration: '4m 22s' },
  { id: 'deploy-233', service: 'auth-service', version: 'v2.8.0', env: 'staging' as const, status: 'success' as const, triggeredBy: 'maya.l', timestamp: '2026-02-20T12:15:00Z', duration: '3m 08s' },
  { id: 'deploy-232', service: 'notification-service', version: 'v1.5.3', env: 'production' as const, status: 'failed' as const, triggeredBy: 'ci-bot', timestamp: '2026-02-20T10:00:00Z', duration: '5m 45s' },
  { id: 'deploy-231', service: 'billing-service', version: 'v2.1.0', env: 'staging' as const, status: 'success' as const, triggeredBy: 'lisa.p', timestamp: '2026-02-19T16:45:00Z', duration: '3m 30s' },
  { id: 'deploy-230', service: 'platform-core', version: 'v3.2.0', env: 'production' as const, status: 'rolled-back' as const, triggeredBy: 'david.k', timestamp: '2026-02-19T11:00:00Z', duration: '4m 10s' },
];

const DEPLOY_STATUS: Record<string, { bg: string; text: string; label: string }> = {
  'success':     { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Success' },
  'failed':      { bg: 'bg-red-100',     text: 'text-red-700',     label: 'Failed' },
  'in-progress': { bg: 'bg-blue-100',    text: 'text-blue-700',    label: 'Deploying' },
  'rolled-back': { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'Rolled Back' },
};

const ENV_STYLES: Record<string, string> = {
  'production': 'bg-red-50 text-red-600 border-red-200',
  'staging':    'bg-amber-50 text-amber-600 border-amber-200',
  'dev':        'bg-slate-50 text-slate-600 border-slate-200',
};

export function EngineeringDeploymentsView() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Deployments</h2>
        <p className="text-sm text-slate-600">Recent deployments, release tracking, and rollback management.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Deploys (7d)', value: SAMPLE_DEPLOYS.length, color: 'text-slate-900' },
          { label: 'Success Rate', value: `${Math.round((SAMPLE_DEPLOYS.filter(d => d.status === 'success').length / SAMPLE_DEPLOYS.length) * 100)}%`, color: 'text-emerald-600' },
          { label: 'Failed', value: SAMPLE_DEPLOYS.filter(d => d.status === 'failed').length, color: 'text-red-600' },
          { label: 'Avg Duration', value: '4m 03s', color: 'text-blue-600' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[11px] text-slate-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {SAMPLE_DEPLOYS.map(dep => {
          const st = DEPLOY_STATUS[dep.status];
          const env = ENV_STYLES[dep.env] ?? ENV_STYLES['dev'];
          return (
            <div key={dep.id} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${env}`}>{dep.env}</span>
                  <span className="text-sm font-semibold text-slate-900">{dep.service}</span>
                  <span className="text-xs font-mono text-slate-400">{dep.version}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${st.bg} ${st.text}`}>{st.label}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-500">
                <span>👤 {dep.triggeredBy}</span>
                <span>⏱ {dep.duration}</span>
                <span>📅 {new Date(dep.timestamp).toLocaleString()}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Documentation Hub
// ---------------------------------------------------------------------------

export function EngineeringDocumentationView() {
  const docs = [
    { title: 'API Reference v3', type: 'API Docs', updated: '2026-02-20', status: 'current', icon: '📖' },
    { title: 'System Architecture Overview', type: 'Architecture', updated: '2026-02-15', status: 'current', icon: '🏗️' },
    { title: 'Deployment Runbook', type: 'Runbook', updated: '2026-02-10', status: 'current', icon: '📋' },
    { title: 'Incident Response Playbook', type: 'Playbook', updated: '2026-01-20', status: 'needs-review', icon: '🚨' },
    { title: 'Onboarding Guide', type: 'Guide', updated: '2026-01-15', status: 'current', icon: '👋' },
    { title: 'Database Migration Guide', type: 'Guide', updated: '2026-02-18', status: 'current', icon: '🗄️' },
    { title: 'Security Best Practices', type: 'Standard', updated: '2025-12-01', status: 'needs-review', icon: '🛡️' },
    { title: 'Testing Standards', type: 'Standard', updated: '2026-01-10', status: 'current', icon: '🧪' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Documentation Hub</h2>
        <p className="text-sm text-slate-600">Technical documentation, runbooks, and AI-generated docs from code.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {docs.map(doc => (
          <div key={doc.title} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 hover:shadow-sm transition-all cursor-pointer">
            <div className="flex items-start gap-3">
              <span className="text-xl">{doc.icon}</span>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold text-slate-900 truncate">{doc.title}</h4>
                <p className="text-[11px] text-slate-400 mt-0.5">{doc.type} • Updated {doc.updated}</p>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded inline-block mt-1.5 ${
                  doc.status === 'current' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {doc.status === 'current' ? '✓ Current' : '⚠ Needs Review'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button className="w-full py-3 rounded-xl border border-dashed border-slate-300 text-sm text-slate-500 hover:border-slate-400 hover:bg-slate-50 transition-colors">
        + Generate Docs from Code (AI)
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Security & Compliance
// ---------------------------------------------------------------------------

export function EngineeringSecurityView() {
  const findings = [
    { id: 'SEC-045', title: 'SQL injection vulnerability in search endpoint', severity: 'critical' as const, status: 'open', service: 'search-service', discovered: '2026-02-19' },
    { id: 'SEC-044', title: 'Outdated TLS configuration on API gateway', severity: 'high' as const, status: 'in-progress', service: 'api-gateway', discovered: '2026-02-15' },
    { id: 'SEC-043', title: 'Missing rate limiting on auth endpoints', severity: 'high' as const, status: 'fixed', service: 'auth-service', discovered: '2026-02-10' },
    { id: 'SEC-042', title: 'Dependency vulnerability: lodash < 4.17.21', severity: 'medium' as const, status: 'fixed', service: 'platform-core', discovered: '2026-02-08' },
    { id: 'SEC-041', title: 'CORS policy too permissive in staging', severity: 'medium' as const, status: 'open', service: 'api-gateway', discovered: '2026-02-05' },
    { id: 'SEC-040', title: 'Excessive IAM permissions on CI service account', severity: 'low' as const, status: 'open', service: 'infrastructure', discovered: '2026-02-01' },
  ];

  const SEV: Record<string, { bg: string; text: string }> = {
    critical: { bg: 'bg-red-100', text: 'text-red-700' },
    high:     { bg: 'bg-orange-100', text: 'text-orange-700' },
    medium:   { bg: 'bg-amber-100', text: 'text-amber-700' },
    low:      { bg: 'bg-blue-100', text: 'text-blue-700' },
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Security & Compliance</h2>
        <p className="text-sm text-slate-600">Vulnerability tracking, dependency audits, and compliance monitoring.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Open Findings', value: findings.filter(f => f.status === 'open').length, color: 'text-red-600' },
          { label: 'In Progress', value: findings.filter(f => f.status === 'in-progress').length, color: 'text-amber-600' },
          { label: 'Fixed (30d)', value: findings.filter(f => f.status === 'fixed').length, color: 'text-emerald-600' },
          { label: 'Compliance Score', value: '92%', color: 'text-blue-600' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[11px] text-slate-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {findings.map(f => {
          const sev = SEV[f.severity];
          return (
            <div key={f.id} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sev.bg} ${sev.text}`}>{f.severity}</span>
                  <span className="text-xs font-mono text-slate-400">{f.id}</span>
                  <span className="text-sm font-semibold text-slate-900">{f.title}</span>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  f.status === 'fixed' ? 'bg-emerald-100 text-emerald-700' :
                  f.status === 'in-progress' ? 'bg-blue-100 text-blue-700' :
                  'bg-red-100 text-red-700'
                }`}>{f.status}</span>
              </div>
              <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-500">
                <span>📦 {f.service}</span>
                <span>📅 {f.discovered}</span>
              </div>
            </div>
          );
        })}
      </div>

      <button className="w-full py-3 rounded-xl border border-dashed border-slate-300 text-sm text-slate-500 hover:border-slate-400 hover:bg-slate-50 transition-colors">
        + Run AI Security Scan
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Engineering Workflows
// ---------------------------------------------------------------------------

export function EngineeringWorkflowsView() {
  const setActiveSection = useEngineeringStore((s) => s.setActiveSection);
  const setSelectedSkillId = useEngineeringStore((s) => s.setSelectedSkillId);
  // `skillSlug` maps each card to a real Engineering skill (gateway engineering-skills-data),
  // so the chosen workflow is carried into the Run view and pre-selects that skill.
  // Mirrors the Marketing pattern (selectedWorkflowId set on card click, consumed by the run form).
  const workflows = [
    { id: 'ew-1', icon: '🔍', name: 'Automated Code Review', description: 'AI-powered PR review with security and style checks', cluster: 'Code Quality', skillSlug: 'pr-review-assistant' },
    { id: 'ew-2', icon: '🧪', name: 'Test Generation', description: 'Generate unit and integration tests from code', cluster: 'Code Quality', skillSlug: 'unit-test-generator' },
    { id: 'ew-3', icon: '📝', name: 'API Documentation', description: 'Auto-generate API docs from OpenAPI specs', cluster: 'Code Quality', skillSlug: 'technical-documentation-generator' },
    { id: 'ew-4', icon: '🚨', name: 'Incident Response', description: 'Automated incident triage and escalation', cluster: 'Operations', skillSlug: 'incident-rca-draft' },
    { id: 'ew-5', icon: '📊', name: 'Postmortem Generator', description: 'AI-drafted postmortem from incident data', cluster: 'Operations', skillSlug: 'incident-rca-draft' },
    { id: 'ew-6', icon: '🔄', name: 'Dependency Audit', description: 'Scan and update outdated dependencies', cluster: 'Operations', skillSlug: 'ci-failure-diagnosis' },
    { id: 'ew-7', icon: '🏗️', name: 'Architecture Review', description: 'AI review of system architecture decisions', cluster: 'Architecture', skillSlug: 'architecture-summary-generator' },
    { id: 'ew-8', icon: '📋', name: 'Sprint Planning', description: 'AI-assisted sprint planning and estimation', cluster: 'Planning', skillSlug: 'jira-ticket-breakdown' },
    { id: 'ew-9', icon: '🎯', name: 'Tech Debt Prioritization', description: 'Score and prioritize tech debt items', cluster: 'Planning', skillSlug: 'codebase-explainer' },
    { id: 'ew-10', icon: '🚀', name: 'Release Notes', description: 'Generate release notes from git history', cluster: 'Release', skillSlug: 'pr-summary-generator' },
    { id: 'ew-11', icon: '🛡️', name: 'Security Scan', description: 'SAST/DAST analysis with AI remediation', cluster: 'Security', skillSlug: 'pr-review-assistant' },
    { id: 'ew-12', icon: '⚡', name: 'Performance Profiling', description: 'Identify bottlenecks and optimization targets', cluster: 'Performance', skillSlug: 'ci-failure-diagnosis' },
  ];

  const clusters = Array.from(new Set(workflows.map(w => w.cluster)));

  const handleSelect = (skillSlug: string) => {
    setSelectedSkillId(skillSlug);
    setActiveSection('run');
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">{workflows.length} Engineering Workflows</h2>
        <p className="text-sm text-slate-600">Automated workflows for code quality, operations, architecture, and security.</p>
      </div>
      <div className="space-y-4">
        {clusters.map(cluster => (
          <div key={cluster} className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-bold text-slate-800 mb-3">{cluster}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {workflows.filter(w => w.cluster === cluster).map(wf => (
                <button key={wf.id} onClick={() => handleSelect(wf.skillSlug)}
                  className="flex flex-col gap-1.5 p-3 rounded-lg border border-slate-100 bg-slate-50 hover:border-slate-300 hover:bg-white text-left transition-colors">
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
// CI/CD Pipelines
// ---------------------------------------------------------------------------

export function EngineeringPipelinesView() {
  const pipelines = [
    { name: 'platform-core', branch: 'main', status: 'success' as const, stages: [
      { name: 'Build', status: 'success', duration: '1m 20s' },
      { name: 'Unit Tests', status: 'success', duration: '2m 14s' },
      { name: 'Lint', status: 'success', duration: '0m 45s' },
      { name: 'Integration', status: 'success', duration: '5m 30s' },
      { name: 'Deploy Staging', status: 'success', duration: '3m 10s' },
    ]},
    { name: 'auth-service', branch: 'feat/token-refresh', status: 'running' as const, stages: [
      { name: 'Build', status: 'success', duration: '0m 55s' },
      { name: 'Unit Tests', status: 'success', duration: '1m 08s' },
      { name: 'Lint', status: 'success', duration: '0m 30s' },
      { name: 'Integration', status: 'running', duration: '...' },
      { name: 'Deploy Staging', status: 'pending', duration: '-' },
    ]},
    { name: 'notification-service', branch: 'main', status: 'failed' as const, stages: [
      { name: 'Build', status: 'success', duration: '1m 05s' },
      { name: 'Unit Tests', status: 'failed', duration: '1m 45s' },
      { name: 'Lint', status: 'skipped', duration: '-' },
      { name: 'Integration', status: 'skipped', duration: '-' },
      { name: 'Deploy Staging', status: 'skipped', duration: '-' },
    ]},
  ];

  const stageColors: Record<string, string> = {
    success: 'bg-emerald-500',
    running: 'bg-blue-500 animate-pulse',
    failed:  'bg-red-500',
    pending: 'bg-slate-300',
    skipped: 'bg-slate-200',
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">CI/CD Pipelines</h2>
        <p className="text-sm text-slate-600">Live pipeline status across services — build, test, lint, deploy.</p>
      </div>

      <div className="space-y-4">
        {pipelines.map(pl => (
          <div key={pl.name} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${
                  pl.status === 'success' ? 'bg-emerald-500' : pl.status === 'running' ? 'bg-blue-500 animate-pulse' : 'bg-red-500'
                }`} />
                <h4 className="text-sm font-bold text-slate-900">{pl.name}</h4>
                <span className="text-[11px] text-slate-400 font-mono">({pl.branch})</span>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                pl.status === 'success' ? 'bg-emerald-100 text-emerald-700' :
                pl.status === 'running' ? 'bg-blue-100 text-blue-700' :
                'bg-red-100 text-red-700'
              }`}>{pl.status}</span>
            </div>
            <div className="flex items-center gap-1">
              {pl.stages.map((stage, i) => (
                <div key={stage.name} className="flex-1 flex flex-col items-center gap-1">
                  <div className={`w-full h-2 rounded-full ${stageColors[stage.status]}`} />
                  <span className="text-[10px] text-slate-500 truncate w-full text-center">{stage.name}</span>
                  <span className="text-[9px] text-slate-400">{stage.duration}</span>
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
// Tech Debt Tracker
// ---------------------------------------------------------------------------

export function EngineeringTechDebtView() {
  const items = [
    { id: 'TD-028', title: 'Migrate from Express v4 to v5', effort: 'L', impact: 'high', category: 'Dependencies', age: '45d', assignee: null },
    { id: 'TD-027', title: 'Remove legacy v1 API endpoints', effort: 'M', impact: 'medium', category: 'API', age: '60d', assignee: 'Alex R.' },
    { id: 'TD-026', title: 'Consolidate duplicate date formatting utils', effort: 'S', impact: 'low', category: 'Code Quality', age: '30d', assignee: null },
    { id: 'TD-025', title: 'Replace custom logger with OpenTelemetry', effort: 'L', impact: 'high', category: 'Observability', age: '90d', assignee: 'David Kim' },
    { id: 'TD-024', title: 'Add TypeScript strict mode to auth-service', effort: 'M', impact: 'medium', category: 'Type Safety', age: '120d', assignee: null },
    { id: 'TD-023', title: 'Optimize N+1 queries in user list endpoint', effort: 'S', impact: 'high', category: 'Performance', age: '15d', assignee: 'Lisa Park' },
  ];

  const IMPACT: Record<string, { bg: string; text: string }> = {
    high:   { bg: 'bg-red-100', text: 'text-red-700' },
    medium: { bg: 'bg-amber-100', text: 'text-amber-700' },
    low:    { bg: 'bg-blue-100', text: 'text-blue-700' },
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">Tech Debt Tracker</h2>
        <p className="text-sm text-slate-600">Prioritized technical debt items with effort estimation and impact scoring.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Items', value: items.length, color: 'text-slate-900' },
          { label: 'High Impact', value: items.filter(i => i.impact === 'high').length, color: 'text-red-600' },
          { label: 'Assigned', value: items.filter(i => i.assignee).length, color: 'text-blue-600' },
          { label: 'Avg Age', value: '60d', color: 'text-amber-600' },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[11px] text-slate-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {items.map(item => {
          const imp = IMPACT[item.impact];
          return (
            <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-slate-400">{item.id}</span>
                  <span className="text-sm font-semibold text-slate-900">{item.title}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded font-medium">{item.category}</span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${imp.bg} ${imp.text}`}>{item.impact}</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded font-mono">Effort: {item.effort}</span>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-500">
                <span>⏱ {item.age} old</span>
                {item.assignee ? <span>👤 {item.assignee}</span> : <span className="text-amber-500">Unassigned</span>}
              </div>
            </div>
          );
        })}
      </div>

      <button className="w-full py-3 rounded-xl border border-dashed border-slate-300 text-sm text-slate-500 hover:border-slate-400 hover:bg-slate-50 transition-colors">
        + AI Prioritize Tech Debt
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// On-Call & Alerts
// ---------------------------------------------------------------------------

export function EngineeringOnCallView() {
  const schedule = [
    { name: 'David Kim', role: 'Primary', period: 'Feb 17 – Feb 23', status: 'active' as const },
    { name: 'Maya L.', role: 'Secondary', period: 'Feb 17 – Feb 23', status: 'active' as const },
    { name: 'Alex R.', role: 'Primary', period: 'Feb 24 – Mar 2', status: 'upcoming' as const },
    { name: 'Lisa Park', role: 'Secondary', period: 'Feb 24 – Mar 2', status: 'upcoming' as const },
  ];

  const alerts = [
    { id: 'ALT-312', title: 'High CPU usage on worker-3', severity: 'warning', service: 'worker-pool', time: '15 min ago', acknowledged: true },
    { id: 'ALT-311', title: 'Error rate > 1% on /api/search', severity: 'critical', service: 'search-service', time: '2h ago', acknowledged: true },
    { id: 'ALT-310', title: 'Disk usage > 85% on db-replica-2', severity: 'warning', service: 'database', time: '4h ago', acknowledged: false },
    { id: 'ALT-309', title: 'SSL certificate expiring in 14 days', severity: 'info', service: 'api-gateway', time: '1d ago', acknowledged: false },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-lg font-bold text-slate-900">On-Call & Alerts</h2>
        <p className="text-sm text-slate-600">On-call rotation, active alerts, and escalation management.</p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <h3 className="text-sm font-bold text-slate-700 mb-3">On-Call Schedule</h3>
          <div className="space-y-2">
            {schedule.map((s, i) => (
              <div key={i} className={`rounded-xl border p-4 ${
                s.status === 'active' ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'
              }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{s.name}</p>
                    <p className="text-[11px] text-slate-500">{s.role} • {s.period}</p>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    s.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                  }`}>{s.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-bold text-slate-700 mb-3">Recent Alerts</h3>
          <div className="space-y-2">
            {alerts.map(a => (
              <div key={a.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      a.severity === 'critical' ? 'bg-red-100 text-red-700' :
                      a.severity === 'warning' ? 'bg-amber-100 text-amber-700' :
                      'bg-blue-100 text-blue-700'
                    }`}>{a.severity}</span>
                    <span className="text-sm font-medium text-slate-900">{a.title}</span>
                  </div>
                  {a.acknowledged && (
                    <span className="text-[10px] text-emerald-600 font-medium">✓ ACK</span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-500">
                  <span>📦 {a.service}</span>
                  <span>🕐 {a.time}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
