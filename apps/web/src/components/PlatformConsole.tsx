'use client';

import { useCallback, useEffect, useState } from 'react';
import { authRequest } from '../lib/auth-client';

type Tab = 'operations' | 'evaluations' | 'registry' | 'knowledge' | 'members' | 'notifications';
interface Summary { http: { requests: number; errors: number; meanLatencyMs: number | null }; usage: { spentMicros: number; reservedMicros: number }; evaluations: { sampleCount: number; passRate: number | null }; runs: Array<{ mode: string; status: string; count: number }> }
interface RecoveryRun { id: string; status: string; mode: string; attempts: number; workerId?: string; error?: string }
interface Member { id: string; name: string; email: string; role: string; state: string; version: number; personaScopes: string[] | null }
interface PackageVersion { id: string; name: string; kind: string; hash: string; status: string; revision: number; activeHash: string | null; publisherId: string }
export function PlatformConsole({ initialTab = 'operations' }: { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [jobs, setJobs] = useState<RecoveryRun[]>([]);
  const [packages, setPackages] = useState<PackageVersion[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [datasets, setDatasets] = useState<Array<{ id: string; name: string; version: number }>>([]);
  const [body, setBody] = useState('{}');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setError(null);
    try {
      if (tab === 'operations') {
        const [metrics, recovery] = await Promise.all([authRequest('/api/operations/summary'), authRequest('/api/operations/jobs')]);
        setSummary(metrics); setJobs(recovery.jobs ?? []);
      } else if (tab === 'registry') setPackages((await authRequest('/api/registry/packages')).packages ?? []);
      else if (tab === 'members') setMembers((await authRequest('/api/admin/members')).members ?? []);
      else if (tab === 'evaluations') setDatasets((await authRequest('/api/evaluations/datasets')).datasets ?? []);
      else if (tab === 'notifications') setResult(await authRequest('/api/operations/notifications'));
      else if (tab === 'knowledge') setResult(await authRequest('/api/knowledge/governance'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Platform state unavailable'); }
  }, [tab]);
  useEffect(() => { void load(); }, [load]);
  const act = async (path: string, method: string, input: unknown) => {
    setBusy(true); setError(null);
    try { const response = await authRequest(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); setResult(response); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Operation was not acknowledged'); }
    finally { setBusy(false); }
  };
  const submitJson = (path: string) => {
    try { void act(path, 'POST', JSON.parse(body)); }
    catch { setError('Enter a valid JSON request. No changes were sent.'); }
  };
  const inspect = async (runId: string) => {
    try { setResult(await authRequest(`/api/executions/${encodeURIComponent(runId)}/trace`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Trace unavailable'); }
  };
  return <section className="p-6 space-y-4" data-testid="platform-console">
    <div className="flex items-center justify-between"><div><h1 className="text-lg font-semibold">Operating Platform</h1><p className="text-xs text-slate-500">Measured state, explicit evidence and human-controlled promotion. No synthetic quality scores.</p></div><button className="btn btn-secondary" onClick={() => void load()} disabled={busy}>Refresh</button></div>
    <nav className="flex flex-wrap gap-2" aria-label="Platform sections">{(['operations','evaluations','registry','knowledge','members','notifications'] as Tab[]).map(value => <button key={value} className={`px-3 py-2 rounded text-sm ${tab === value ? 'bg-slate-900 text-white' : 'bg-slate-100'}`} onClick={() => { setTab(value); setResult(null); setBody('{}'); }}>{value}</button>)}</nav>
    {error && <p role="alert" className="bg-red-50 text-red-700 rounded p-3 text-sm">{error}</p>}
    {tab === 'operations' && <>
      {summary && <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[
        ['Authenticated requests / 24h', summary.http.requests], ['HTTP errors / 24h', summary.http.errors], ['Spent / reserved USD', `${(summary.usage.spentMicros / 1e6).toFixed(4)} / ${(summary.usage.reservedMicros / 1e6).toFixed(4)}`], ['Labeled live cases / pass rate', `${summary.evaluations.sampleCount} / ${summary.evaluations.passRate === null ? 'not measured' : `${Math.round(summary.evaluations.passRate * 100)}%`}`],
      ].map(([label, value]) => <div key={String(label)} className="border rounded p-3"><p className="text-xs text-slate-500">{label}</p><p className="font-semibold mt-1">{value}</p></div>)}</div>}
      <h2 className="font-semibold">Recovery queue</h2>
      {!jobs.length && <p className="text-sm text-slate-500">No unresolved runs in the authorized recovery view.</p>}
      {jobs.map(run => <article key={run.id} className="border rounded p-3 space-y-2"><div className="flex flex-wrap justify-between gap-2"><div><code className="text-xs">{run.id}</code><p className="text-sm">{run.mode} · {run.status} · {run.attempts} attempt(s)</p></div><div className="flex gap-2"><button className="btn btn-secondary" onClick={() => void inspect(run.id)}>Trace</button><button className="btn btn-secondary" disabled={busy || run.status !== 'failed'} onClick={() => void act(`/api/operations/runs/${encodeURIComponent(run.id)}/retry`, 'POST', {})}>Retry eligible work</button><button className="btn btn-secondary" disabled={busy || !['queued','running','paused'].includes(run.status)} onClick={() => void act(`/api/operations/runs/${encodeURIComponent(run.id)}/cancel`, 'POST', {})}>Cancel remaining</button></div></div>{run.error && <p className="text-xs text-red-700">{run.error}</p>}{run.status === 'inconclusive' && <p className="text-xs text-amber-700">Remote verification is required. This screen cannot force uncertain effects to complete.</p>}</article>)}
    </>}
    {tab === 'evaluations' && <>
      <p className="text-sm text-slate-600">Datasets are owner-scoped and versioned. Evidence must cover every labeled case with matching run inputs. Simulation stays separate from live evaluation.</p>
      <ul className="space-y-1">{datasets.map(dataset => <li key={dataset.id} className="text-sm border rounded p-2">{dataset.name} · version {dataset.version} · <code>{dataset.id}</code></li>)}</ul>
      <label className="block text-sm">Dataset or evaluation evidence JSON<textarea className="w-full border rounded p-3 font-mono text-xs mt-1" rows={10} value={body} onChange={event => setBody(event.target.value)} /></label>
      <div className="flex gap-2"><button className="btn btn-primary" disabled={busy} onClick={() => submitJson('/api/evaluations/datasets')}>Create labeled dataset</button><button className="btn btn-secondary" disabled={busy} onClick={() => submitJson('/api/evaluations')}>Record reviewed evidence</button></div>
    </>}
    {tab === 'registry' && <>
      <p className="text-sm text-slate-600">Immutable versions require origin/license metadata. Live activation requires independent review and current evidence; a simulated run cannot qualify a release.</p>
      {packages.map(version => <article key={`${version.id}:${version.hash}`} className="border rounded p-3"><strong>{version.name}</strong><p className="text-xs">{version.kind} · {version.status} · revision {version.revision}</p><code className="block text-xs break-all">{version.hash}</code><p className="text-xs">Package: {version.id}</p><button className="btn btn-secondary mt-2" disabled={busy || version.kind === 'connector' || version.status !== 'approved'} onClick={() => void act(`/api/registry/packages/${encodeURIComponent(version.id)}/activate`, 'POST', { hash: version.hash, expectedRevision: version.revision })}>Activate reviewed version</button>{version.kind === 'connector' && <><p className="text-xs text-amber-700 mt-2">Connector activation remains blocked pending vendor conformance and independent review.</p><button className="btn btn-secondary mt-2" disabled={busy} onClick={() => { authRequest(`/api/registry/packages/${encodeURIComponent(version.id)}/conformance?hash=${encodeURIComponent(version.hash)}`).then(setResult).catch(cause => setError(cause.message)); }}>Inspect conformance blockers</button></>}</article>)}
      <label className="block text-sm">Candidate JSON<textarea className="w-full border rounded p-3 font-mono text-xs mt-1" rows={10} value={body} onChange={event => setBody(event.target.value)} /></label><button className="btn btn-primary" disabled={busy} onClick={() => submitJson('/api/registry/packages')}>Stage immutable candidate</button>
    </>}
    {tab === 'knowledge' && <>
      <p className="text-sm text-slate-600">Only current, unexpired, owner-authorized reviewed sources are retrieved. Editing or archiving a source invalidates its prior approval.</p>
      <div className="flex gap-2"><input className="input flex-1" aria-label="Governed knowledge query" value={query} onChange={event => setQuery(event.target.value)} /><button className="btn btn-primary" onClick={() => { authRequest(`/api/knowledge/search?q=${encodeURIComponent(query)}`).then(setResult).catch(cause => setError(cause.message)); }}>Search governed sources</button></div>
      <label className="block text-sm">Review request or decision JSON<textarea className="w-full border rounded p-3 font-mono text-xs mt-1" rows={8} value={body} onChange={event => setBody(event.target.value)} /></label><div className="flex gap-2"><button className="btn btn-secondary" disabled={busy} onClick={() => submitJson('/api/knowledge/governance/request')}>Request independent review</button><button className="btn btn-secondary" disabled={busy} onClick={() => submitJson('/api/knowledge/governance/approve')}>Approve requested source</button></div>
    </>}
    {tab === 'notifications' && <>
      <p className="text-sm text-slate-600">Queue a notification for an owned terminal run using an enabled Slack channel. Live delivery requires explicit approval and remote readback; simulation cannot send a real notification. Email, Teams and billing remain disabled.</p>
      <label className="block text-sm">Notification request JSON (channelId, sourceRunId, deliveryKey, simulate)<textarea className="w-full border rounded p-3 font-mono text-xs mt-1" rows={6} value={body} onChange={event => setBody(event.target.value)} /></label>
      <button className="btn btn-primary" disabled={busy} onClick={() => submitJson('/api/operations/notifications')}>Queue authorized notification</button>
    </>}
    {tab === 'members' && <>
      <p className="text-sm text-slate-600">Membership changes revoke issued sessions and constrain future execution. The last active administrator cannot be removed.</p>
      {members.map(member => <article key={member.id} className="border rounded p-3 flex justify-between gap-3"><div><strong>{member.name}</strong><p className="text-xs">{member.email} · {member.role} · {member.state}</p><code className="text-xs">{member.id}</code></div><button className="btn btn-secondary" disabled={busy || member.state !== 'active'} onClick={() => { if (window.confirm(`Suspend ${member.name} and revoke their issued sessions?`)) void act(`/api/admin/members/${encodeURIComponent(member.id)}`, 'PATCH', { version: member.version, role: member.role, state: 'suspended', personaScopes: member.personaScopes ?? [] }); }}>Suspend access</button></article>)}
    </>}
    {result !== null && <details open className="border rounded p-3"><summary className="font-medium">Server acknowledgement / evidence</summary><pre className="text-xs whitespace-pre-wrap break-all max-h-96 overflow-auto mt-2">{JSON.stringify(result, null, 2)}</pre></details>}
  </section>;
}
