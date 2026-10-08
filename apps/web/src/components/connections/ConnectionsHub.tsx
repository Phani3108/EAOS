'use client';

/**
 * ConnectionsHub — top-level integrations management view
 * Browse all connectors by category, connect/disconnect/test each one.
 */

import { useState, useEffect } from 'react';
import {
  CONNECTOR_CATALOG,
  CATEGORY_META,
  ConnectorDef,
  ConnectorCategory,
  useConnectionsStore,
} from '../../store/connections-store';
import { ConnectorCard } from './ConnectorCard';
import { useEAOSStore } from '../../store/eaos-store';

const SECTION_TO_CATEGORY: Record<string, ConnectorCategory | 'all'> = {
  'conn-ai-models': 'ai-models',
  'conn-storage':   'storage',
  'conn-design':    'design',
  'conn-crm':       'crm-ads',
  'conn-devtools':  'dev-tools',
  'conn-cms':       'cms',
  'conn-messaging': 'messaging',
  'conn-data':      'data',
};

const CATEGORIES: Array<ConnectorCategory | 'all'> = [
  'all', 'ai-models', 'storage', 'design', 'crm-ads', 'dev-tools', 'cms', 'messaging', 'data',
];

export function ConnectionsHub() {
  const { connections, activeCategory, setActiveCategory } = useConnectionsStore();
  const activeSection = useEAOSStore(s => s.activeSection);
  const setActiveSection = useEAOSStore(s => s.setActiveSection);
  const [search, setSearch] = useState('');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/_/gateway/api/connections', { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('Connection state could not be loaded');
      return response.json();
    }).then(data => {
      if (!active) return;
      const next = Object.fromEntries(CONNECTOR_CATALOG.map(connector => {
        const record = data.connections?.[connector.id];
        const status = record?.status === 'verified' ? 'connected' as const : record?.status === 'configured' ? 'configured' as const : 'not-connected' as const;
        return [connector.id, { connectorId: connector.id, status }];
      }));
      useConnectionsStore.setState({ connections: next });
    }).catch(error => {
      if (!active) return;
      setConnectionError(error.message);
      useConnectionsStore.setState({ connections: Object.fromEntries(CONNECTOR_CATALOG.map(connector => [connector.id, { connectorId: connector.id, status: 'error' as const }])) });
    });
    return () => { active = false; };
  }, []);

  // Sync sidebar nav item → category filter
  useEffect(() => {
    const cat = SECTION_TO_CATEGORY[activeSection];
    if (cat) setActiveCategory(cat);
  }, [activeSection, setActiveCategory]);

  const connectedCount = Object.values(connections).filter(connection => connection.status === 'connected').length;
  const totalCount = CONNECTOR_CATALOG.length;
  const coveragePct = Math.round((connectedCount / totalCount) * 100);

  const filtered = CONNECTOR_CATALOG.filter(c => {
    if (activeCategory !== 'all' && c.category !== activeCategory) return false;
    if (search) {
      const q = search.toLowerCase();
      return c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q) || c.capabilities.some(cap => cap.includes(q));
    }
    return true;
  });

  // Group by category for "all" view
  const grouped: Partial<Record<ConnectorCategory, ConnectorDef[]>> = {};
  for (const c of filtered) {
    if (!grouped[c.category]) grouped[c.category] = [];
    grouped[c.category]!.push(c);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b border-slate-200 px-6 py-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="page-title">Connections</h1>
            <p className="page-subtitle">Save tenant-owned secret references. Live execution requires a verified adapter; simulation must be selected explicitly.</p>
            {connectionError && <p role="alert" className="text-sm text-red-600">{connectionError}</p>}
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm font-semibold text-slate-900 tabular-nums">{connectedCount} / {totalCount}</div>
              <div className="text-[12px] text-slate-400">connected</div>
            </div>
            <div className="w-28 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${coveragePct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search connectors by name or capability…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input pl-9"
          />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Category sidebar */}
        <div className="flex-shrink-0 w-52 bg-white border-r border-slate-200 overflow-y-auto py-3 px-2">
          {CATEGORIES.map(cat => {
            const meta = cat === 'all' ? null : CATEGORY_META[cat];
            const count = cat === 'all'
              ? CONNECTOR_CATALOG.length
              : CONNECTOR_CATALOG.filter(c => c.category === cat).length;
            const connCount = cat === 'all'
              ? connectedCount
              : CONNECTOR_CATALOG.filter(c => c.category === cat && (connections[c.id]?.status === 'connected' || connections[c.id]?.status === 'sandbox')).length;

            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left transition-colors ${
                  activeCategory === cat
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className="text-base leading-none">{meta?.icon ?? '🔌'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium truncate">{meta?.label ?? 'All Connectors'}</div>
                  <div className="text-[12px] text-slate-400">{connCount}/{count}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
          {filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🔍</div>
              <p className="empty-state-text">No connectors match your search</p>
            </div>
          ) : activeCategory === 'all' ? (
            <div className="space-y-8">
              {(Object.keys(grouped) as ConnectorCategory[]).map(cat => {
                const items = grouped[cat] ?? [];
                if (items.length === 0) return null;
                const meta = CATEGORY_META[cat];
                return (
                  <div key={cat}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-lg">{meta.icon}</span>
                      <h2 className="text-sm font-semibold text-slate-800">{meta.label}</h2>
                      <span className="text-[13px] text-slate-400">— {meta.description}</span>
                    </div>
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                      {items.map(conn => (
                        <ConnectorCard
                          key={conn.id}
                          connector={conn}
                          state={connections[conn.id] ?? { connectorId: conn.id, status: 'not-connected' }}
                          onClick={() => setActiveSection(`connector-detail-${conn.id}`)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-xl">{CATEGORY_META[activeCategory as ConnectorCategory]?.icon}</span>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{CATEGORY_META[activeCategory as ConnectorCategory]?.label}</h2>
                  <p className="text-[13px] text-slate-500">{CATEGORY_META[activeCategory as ConnectorCategory]?.description}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {filtered.map(conn => (
                  <ConnectorCard
                    key={conn.id}
                    connector={conn}
                    state={connections[conn.id] ?? { connectorId: conn.id, status: 'not-connected' }}
                    onClick={() => setActiveSection(`connector-detail-${conn.id}`)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Setup prompt if few connections */}
          {connectedCount <= 1 && (
            <div className="mt-8 card p-6 text-center border-dashed">
              <svg className="w-8 h-8 text-slate-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
              <h3 className="text-sm font-semibold text-slate-700 mb-1">Connect your tools to unlock live execution</h3>
              <p className="text-[13px] text-slate-500 mb-4 max-w-md mx-auto">
                Skills and workflows run in Sandbox mode until you connect real tools. Start with AI models and dev tools.
              </p>
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => setActiveCategory('ai-models')}
                  className="btn btn-primary"
                >
                  Start with AI Models
                </button>
                <button
                  onClick={() => setActiveCategory('dev-tools')}
                  className="btn btn-secondary"
                >
                  Connect Dev Tools
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
