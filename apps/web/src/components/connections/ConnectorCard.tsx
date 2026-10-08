'use client';

import { ConnectorDef, ConnectorState, ConnectionStatus, CATEGORY_META } from '../../store/connections-store';

interface Props {
  connector: ConnectorDef;
  state: ConnectorState;
  onClick: () => void;
}

const STATUS_CONFIG: Record<ConnectionStatus, { label: string; dot: string; badge: string }> = {
  'configured':      { label: 'Not Verified', dot: 'bg-amber-400', badge: 'text-amber-700 bg-amber-50 border-amber-200' },
  'connected':       { label: 'Connected',        dot: 'bg-emerald-500', badge: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  'not-connected':   { label: 'Not Connected',    dot: 'bg-slate-300',   badge: 'text-slate-500 bg-slate-50 border-slate-200' },
  'expired':         { label: 'Expired',          dot: 'bg-amber-400',   badge: 'text-amber-700 bg-amber-50 border-amber-200' },
  'reauth-required': { label: 'Re-auth Required', dot: 'bg-amber-400',   badge: 'text-amber-700 bg-amber-50 border-amber-200' },
  'partial':         { label: 'Partial',          dot: 'bg-yellow-400',  badge: 'text-yellow-700 bg-yellow-50 border-yellow-200' },
  'error':           { label: 'Error',            dot: 'bg-red-500',     badge: 'text-red-700 bg-red-50 border-red-200' },
  'testing':         { label: 'Testing…',         dot: 'bg-blue-400',    badge: 'text-blue-700 bg-blue-50 border-blue-200' },
  'sandbox':         { label: 'Sandbox',          dot: 'bg-purple-400',  badge: 'text-purple-700 bg-purple-50 border-purple-200' },
};

export function ConnectorCard({ connector, state, onClick }: Props) {
  const cfg = STATUS_CONFIG[state.status] ?? STATUS_CONFIG['not-connected'];
  const isConnected = state.status === 'connected' || state.status === 'sandbox' || state.status === 'partial';
  const catMeta = CATEGORY_META[connector.category];

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-4 rounded-xl border border-slate-200 bg-white transition-all group hover:border-slate-300 hover:shadow-md"
    >
      <div className="flex items-center gap-3.5">
        {/* Logo / Icon */}
        <div className={`w-11 h-11 rounded-xl ${connector.color} flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-sm`}>
          {connector.icon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[14px] font-semibold text-slate-900 truncate">{connector.name}</span>
            {isConnected && (
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
            )}
          </div>
          <p className="text-[13px] text-slate-500 line-clamp-1 leading-relaxed">{connector.description}</p>
        </div>

        {/* Arrow */}
        <svg className="w-4 h-4 text-slate-300 group-hover:text-blue-500 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
      </div>

      {/* Bottom row: category + action count + sandbox */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-150">
          {catMeta?.icon} {catMeta?.label}
        </span>
        <span className="text-[11px] text-slate-400">{connector.capabilities.length} actions</span>
        {connector.sandboxAvailable && !isConnected && (
          <span className="text-[11px] text-purple-500 font-medium ml-auto">Sandbox</span>
        )}
        {isConnected && (
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ml-auto flex items-center gap-1 ${cfg.badge}`}>
            {cfg.label}
          </span>
        )}
      </div>
    </button>
  );
}
