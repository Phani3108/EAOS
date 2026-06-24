import { ReactNode } from 'react';

export interface InlineErrorProps {
  problem: string;
  why?: string;
  fixLabel?: string;
  onFix?: () => void;
  tone?: 'error' | 'warning';
  extra?: ReactNode;
}

export function InlineError({ problem, why, fixLabel, onFix, tone = 'warning', extra }: InlineErrorProps) {
  const c = tone === 'error'
    ? { box: 'border-red-200 bg-red-50', title: 'text-red-800', body: 'text-red-700', btn: 'bg-red-600 hover:bg-red-700' }
    : { box: 'border-amber-200 bg-amber-50', title: 'text-amber-800', body: 'text-amber-700', btn: 'bg-amber-600 hover:bg-amber-700' };
  return (
    <div className={`rounded-lg border p-4 ${c.box}`}>
      <p className={`text-sm font-semibold ${c.title}`}>{problem}</p>
      {why && <p className={`text-xs mt-1 ${c.body}`}>{why}</p>}
      {extra}
      {fixLabel && onFix && (
        <button onClick={onFix} className={`mt-3 text-xs font-medium text-white px-3 py-1.5 rounded-lg ${c.btn}`}>{fixLabel}</button>
      )}
    </div>
  );
}
export default InlineError;
