'use client';
/**
 * MCP Servers — live view of the real Model Context Protocol servers connected to EAOS
 * (via the gateway MCP client). Polls GET /api/mcp/servers.
 */
import { useState, useEffect } from 'react';
import { useGatewayReachable } from './DemoModeBanner';

const API = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000';

interface MCPServer {
  id: string;
  transport: string;
  connected: boolean;
  toolCount: number;
  tools: string[];
  error?: string;
}

export function MCPServersHub() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);
  const gatewayOk = useGatewayReachable();

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${API}/api/mcp/servers`)
        .then((r) => r.json())
        .then((d) => { if (alive) setServers(d.servers || []); })
        .catch(() => {})
        .finally(() => { if (alive) setLoading(false); });
    load();
    const id = setInterval(load, 10000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const connected = servers.filter((s) => s.connected).length;

  return (
    <div className="flex-1 overflow-auto bg-slate-50 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold text-slate-900">MCP Servers</h1>
          <div className="flex items-center gap-3">
            {!gatewayOk && (
              <span className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">Gateway offline</span>
            )}
            <span className="text-sm text-slate-500 tabular-nums">{connected}/{servers.length} connected</span>
          </div>
        </div>
        <p className="text-slate-500 mb-6">
          Real Model Context Protocol servers connected to EAOS. The tools they expose are callable by agents through the gateway.
        </p>

        {loading ? (
          <p className="text-slate-400 text-sm">Loading…</p>
        ) : servers.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
            <p className="text-slate-700 font-medium mb-1">No MCP servers connected</p>
            <p className="text-slate-500 text-sm max-w-xl mx-auto">
              Configure servers in <code className="text-slate-700 bg-slate-100 px-1 rounded">mcp.servers.json</code> and set their
              env vars (e.g. <code className="text-slate-700 bg-slate-100 px-1 rounded">CODE_MEMORY_BIN</code>,{' '}
              <code className="text-slate-700 bg-slate-100 px-1 rounded">VOICEBOX_URL</code>), then restart the gateway.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {servers.map((s) => (
              <div key={s.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${s.connected ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  <span className="font-semibold text-slate-900">{s.id}</span>
                  <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full uppercase tracking-wide">{s.transport}</span>
                  <span className="ml-auto text-xs text-slate-400">{s.toolCount} tools</span>
                </div>
                {s.error && <p className="text-xs text-red-600 mb-2">{s.error}</p>}
                {s.tools.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {s.tools.map((t) => (
                      <span key={t} className="text-[11px] font-mono text-slate-600 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">{t}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default MCPServersHub;
