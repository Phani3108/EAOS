'use client';
/**
 * Regiment Review — run an artifact through the collaborative multi-role review chain
 * (Strategy → Design → Engineering → DevEx). POST /api/review/run.
 */
import { useState, useEffect } from 'react';

const API = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000';

interface Reviewer {
  role: string;
  label: string;
  persona: string;
  verdict: 'approve' | 'changes_requested';
  summary: string;
  findings: string[];
  simulated: boolean;
}
interface ReviewResult {
  finalVerdict: 'approve' | 'changes_requested';
  reviewers: Reviewer[];
  consolidatedFindings: string[];
  simulated: boolean;
}

export function RegimentReview() {
  const [chain, setChain] = useState<Array<{ role: string; label: string }>>([]);
  const [artifact, setArtifact] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/api/review/chain`).then((r) => r.json()).then((d) => setChain(d.chain || [])).catch(() => {});
  }, []);

  const run = async () => {
    if (!artifact.trim()) return;
    setRunning(true); setError(null); setResult(null);
    try {
      const res = await fetch(`${API}/api/review/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifact }),
      });
      if (!res.ok) throw new Error(`Review failed (${res.status})`);
      setResult(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review failed');
    } finally {
      setRunning(false);
    }
  };

  const verdictBadge = (v: string) =>
    v === 'approve'
      ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
      : 'text-amber-700 bg-amber-50 border-amber-200';

  return (
    <div className="flex-1 overflow-auto bg-slate-50 p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Regiment Review</h1>
        <p className="text-slate-500 mb-5">
          Run a plan, PRD, design doc, or diff through the collaborative review chain. Each reviewer sees the prior verdicts.
        </p>

        <div className="flex flex-wrap gap-2 mb-4">
          {chain.map((c) => (
            <span key={c.role} className="text-xs font-medium text-slate-600 bg-white border border-slate-200 px-2.5 py-1 rounded-full">{c.label}</span>
          ))}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm mb-5">
          <textarea
            value={artifact}
            onChange={(e) => setArtifact(e.target.value)}
            placeholder="Paste the plan / PRD / design doc / diff to review…"
            rows={6}
            className="w-full text-sm text-slate-900 placeholder-slate-400 border border-slate-200 rounded-lg p-3 outline-none focus:border-blue-400 resize-y"
          />
          <div className="flex items-center justify-between mt-3">
            <span className="text-xs text-slate-400">{artifact.length} chars</span>
            <button
              onClick={run}
              disabled={running || !artifact.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-40"
            >
              {running ? 'Reviewing…' : 'Run Review'}
            </button>
          </div>
        </div>

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 mb-4">{error}</div>}

        {result && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className={`text-sm font-semibold px-3 py-1 rounded-full border ${verdictBadge(result.finalVerdict)}`}>
                {result.finalVerdict === 'approve' ? '✓ Approved' : '✎ Changes Requested'}
              </span>
              {result.simulated && <span className="text-xs text-slate-400">simulated (set an LLM key for real reviews)</span>}
            </div>
            {result.reviewers.map((rv) => (
              <div key={rv.role} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-semibold text-slate-900">{rv.label}</span>
                  <span className="text-[11px] text-slate-400">{rv.persona}</span>
                  <span className={`ml-auto text-[11px] font-medium px-2 py-0.5 rounded-full border ${verdictBadge(rv.verdict)}`}>
                    {rv.verdict === 'approve' ? 'approve' : 'changes requested'}
                  </span>
                </div>
                <p className="text-sm text-slate-600 mb-2">{rv.summary}</p>
                {rv.findings.length > 0 && (
                  <ul className="space-y-1">
                    {rv.findings.map((f, i) => (
                      <li key={i} className="text-[13px] text-slate-600 flex gap-2">
                        <span className="text-amber-500 flex-shrink-0">→</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default RegimentReview;
