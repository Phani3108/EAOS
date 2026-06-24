'use client';
/**
 * Skill Library — adopted EAOS skills loaded from skills/<persona>/<slug>/SKILL.md.
 * Lists them by persona and runs one: POST /api/skills/fs/execute, polls /api/executions/:id.
 */
import { useState, useEffect, useRef } from 'react';

const API = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000';

interface FsSkill {
  id: string;
  slug: string;
  name: string;
  description: string;
  persona: string;
  tags?: string[];
}

export function SkillLibraryHub() {
  const [skills, setSkills] = useState<FsSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<FsSkill | null>(null);
  const [request, setRequest] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch(`${API}/api/skills/fs`)
      .then((r) => r.json())
      .then((d) => setSkills(d.skills || []))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const byPersona = skills.reduce<Record<string, FsSkill[]>>((acc, s) => {
    (acc[s.persona] = acc[s.persona] || []).push(s);
    return acc;
  }, {});

  const run = async () => {
    if (!selected) return;
    setRunning(true); setStatus('queued'); setOutput('');
    try {
      const res = await fetch(`${API}/api/skills/fs/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillId: selected.id, inputs: { request } }),
      });
      if (!res.ok) throw new Error(`Run failed (${res.status})`);
      const { execution } = await res.json();
      const execId = execution.id;
      setStatus(execution.status);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const pr = await fetch(`${API}/api/executions/${execId}`).then((r) => r.json());
          const e = pr.execution;
          if (!e) return;
          setStatus(e.status);
          if (e.outputs?.result) setOutput(String(e.outputs.result));
          if (['completed', 'failed'].includes(e.status)) {
            if (pollRef.current) clearInterval(pollRef.current);
            setRunning(false);
          }
        } catch { /* ignore */ }
      }, 2000);
    } catch (e) {
      setStatus('failed'); setOutput(e instanceof Error ? e.message : 'Run failed'); setRunning(false);
    }
  };

  return (
    <div className="flex-1 overflow-auto bg-slate-50 p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Skill Library</h1>
        <p className="text-slate-500 mb-6">Adopted EAOS skills. Click one to run it; supply optional context and execute.</p>

        {loading ? (
          <p className="text-slate-400 text-sm">Loading…</p>
        ) : skills.length === 0 ? (
          <p className="text-slate-500 text-sm">No skills loaded.</p>
        ) : (
          <div className="space-y-5">
            {Object.entries(byPersona).map(([persona, list]) => (
              <div key={persona}>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">{persona}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {list.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => { setSelected(s); setRequest(''); setStatus(null); setOutput(''); }}
                      className={`text-left p-3 rounded-xl border bg-white transition-all hover:shadow-md ${selected?.id === s.id ? 'border-blue-400 ring-1 ring-blue-200' : 'border-slate-200'}`}
                    >
                      <p className="text-sm font-semibold text-slate-900">{s.name}</p>
                      <p className="text-[12px] text-slate-500 line-clamp-2 mt-0.5">{s.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {selected && (
          <div className="mt-6 bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-semibold text-slate-900">{selected.name}</span>
              <span className="text-[11px] text-slate-400">{selected.persona}</span>
              <button onClick={() => setSelected(null)} className="ml-auto text-slate-400 hover:text-slate-600 text-sm">✕</button>
            </div>
            <textarea
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder="Optional context / target for this skill…"
              rows={3}
              className="w-full text-sm text-slate-900 placeholder-slate-400 border border-slate-200 rounded-lg p-2.5 outline-none focus:border-blue-400 resize-y"
            />
            <div className="flex items-center gap-3 mt-3">
              <button onClick={run} disabled={running} className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-40">
                {running ? 'Running…' : 'Run Skill'}
              </button>
              {status && <span className="text-xs text-slate-500">status: <span className="font-medium text-slate-700">{status}</span></span>}
            </div>
            {output && (
              <pre className="mt-3 text-[13px] text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 whitespace-pre-wrap overflow-auto max-h-96">{output}</pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default SkillLibraryHub;
