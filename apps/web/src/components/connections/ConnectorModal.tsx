'use client';

/**
 * ConnectorModal — credential form for connecting any integration
 * Supports: api-key, oauth, url-token, credentials, sandbox
 */

import { useState } from 'react';
import { ConnectorDef, ConnectorState, useConnectionsStore } from '../../store/connections-store';

interface Props {
  connector: ConnectorDef;
  currentState: ConnectorState;
  onClose: () => void;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  'configured':      { label: 'Configured, not verified', color: 'text-amber-600 bg-amber-50 border-amber-200' },
  'connected':       { label: 'Connected',          color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  'not-connected':   { label: 'Not Connected',       color: 'text-slate-500 bg-slate-50 border-slate-200' },
  'expired':         { label: 'Expired',             color: 'text-amber-600 bg-amber-50 border-amber-200' },
  'reauth-required': { label: 'Re-auth Required',    color: 'text-amber-600 bg-amber-50 border-amber-200' },
  'partial':         { label: 'Partial Access',      color: 'text-yellow-600 bg-yellow-50 border-yellow-200' },
  'error':           { label: 'Connection Error',    color: 'text-red-600 bg-red-50 border-red-200' },
  'testing':         { label: 'Testing…',            color: 'text-blue-600 bg-blue-50 border-blue-200' },
  'sandbox':         { label: 'Sandbox Mode',        color: 'text-purple-600 bg-purple-50 border-purple-200' },
};

export function ConnectorModal({ connector, currentState, onClose }: Props) {
  const { setConnectionStatus } = useConnectionsStore();
  const [formValues, setFormValues] = useState<Record<string, string>>({ provider: 'vault' });
  const [resourcePolicy, setResourcePolicy] = useState('{}');
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState<'connect' | 'test' | 'disconnect' | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const isConnected = currentState.status === 'connected' || currentState.status === 'configured' || currentState.status === 'sandbox' || currentState.status === 'partial';
  const statusMeta = STATUS_LABELS[currentState.status] ?? STATUS_LABELS['not-connected'];

  const setValue = (key: string, val: string) => setFormValues(prev => ({ ...prev, [key]: val }));
  const toggleShow = (key: string) => setShowSecrets(prev => ({ ...prev, [key]: !prev[key] }));

  const referenceFields: ConnectorDef['requiredFields'] = [
    { key: 'provider', label: 'Secret provider', type: 'text', required: true, placeholder: 'vault, aws, gcp or azure' },
    { key: 'path', label: 'Tenant/user scoped secret path', type: 'text', required: true, placeholder: 'tenant-id/user-id/connector' },
    { key: 'key', label: 'Key within the secret', type: 'text', required: false, placeholder: 'Optional key' },
    { key: 'version', label: 'Secret version', type: 'text', required: false, placeholder: 'Optional version' },
  ];
  const allRequiredFilled = referenceFields
    .filter(f => f.required)
    .every(f => (formValues[f.key] ?? '').trim().length > 0);

  async function handleConnect() {
    if (!allRequiredFilled) {
      setMessage({ type: 'error', text: 'Please fill in all required fields.' });
      return;
    }
    setLoading('connect');
    setMessage(null);
    try {
      const res = await fetch(`/_/gateway/api/connections/${encodeURIComponent(connector.id)}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secretRef: Object.fromEntries(Object.entries(formValues).filter(([, value]) => value.trim())), config: JSON.parse(resourcePolicy) }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'configured') {
          setConnectionStatus(connector.id, { status: 'configured', connectedAt: undefined, error: undefined });
          setMessage({ type: 'info', text: 'Secret reference saved. Vendor connectivity has not been verified.' });
        } else {
          setConnectionStatus(connector.id, { status: 'error', error: data.error ?? 'Connection failed' });
          setMessage({ type: 'error', text: data.error ?? 'Connection failed. Check your credentials and try again.' });
        }
      } else {
        // A rejected write must not create a local connection
        const data = await res.json().catch(() => ({}));
        setMessage({ type: 'error', text: data.error ?? `Connection was not saved (${res.status}).` });
      }
    } catch {
      // An unavailable gateway cannot confirm a saved connection
      setMessage({ type: 'error', text: 'Gateway unavailable. No connection was confirmed.' });
    } finally {
      setLoading(null);
    }
  }

  async function handleTest() {
    setLoading('test');
    setMessage(null);
    try {
      const res = await fetch(`/_/gateway/api/connections/${encodeURIComponent(connector.id)}/test`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.ok) {
          setConnectionStatus(connector.id, { status: 'connected', lastTestedAt: new Date().toISOString() });
          setMessage({ type: 'success', text: data.message ?? 'Connection test passed.' });
        } else {
          setMessage({ type: 'error', text: data.error ?? 'Test failed — credentials may be invalid or expired.' });
        }
      } else {
        // Verification requires a successful server-side probe
        const data = await res.json().catch(() => ({}));
        setMessage({ type: 'error', text: data.error ?? `Connection was not verified (${res.status}).` });
      }
    } catch {
      // An unavailable gateway cannot verify a connection
      setMessage({ type: 'error', text: 'Gateway unavailable. Connection was not verified.' });
    } finally {
      setLoading(null);
    }
  }

  async function handleDisconnect() {
    setLoading('disconnect');
    setMessage(null);
    try {
      const response = await fetch(`/_/gateway/api/connections/${encodeURIComponent(connector.id)}/disconnect`, { method: 'POST' });
      if (!response.ok) throw new Error('Revocation was not acknowledged');
    } catch { /* Keep server state authoritative */
      setMessage({ type: 'error', text: 'Revocation failed. The saved reference was not changed.' });
      setLoading(null); return;
    }
    // Update local state only after acknowledged revocation
    setConnectionStatus(connector.id, { status: 'not-connected', connectedAt: undefined, error: undefined });
    setMessage({ type: 'info', text: `Disconnected from ${connector.name}.` });
    setLoading(null);
  }

  async function handleSandbox() {
    setConnectionStatus(connector.id, { status: 'sandbox', connectedAt: new Date().toISOString() });
    setMessage({ type: 'info', text: 'Sandbox mode enabled. Skills will simulate outputs without real API calls.' });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-4 p-5 border-b border-slate-100">
          <div className={`w-10 h-10 rounded-xl ${connector.color} flex items-center justify-center text-white font-bold text-sm flex-shrink-0`}>
            {connector.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[14px] font-semibold text-slate-900">{connector.name}</h2>
              <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${statusMeta.color}`}>
                {statusMeta.label}
              </span>
            </div>
            <p className="text-[13px] text-slate-500 mt-0.5">{connector.description}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 flex-shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Capabilities */}
          <div>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Capabilities</div>
            <div className="flex flex-wrap gap-1">
              {connector.capabilities.map(cap => (
                <span key={cap} className="text-[11px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded font-mono">{cap}</span>
              ))}
            </div>
          </div>

          {/* Connected state info */}
          {isConnected && currentState.connectedAt && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3 text-xs text-emerald-700 space-y-0.5">
              <div className="font-medium">Connected</div>
              {currentState.connectedAt && (
                <div className="text-emerald-600">Since {new Date(currentState.connectedAt).toLocaleString()}</div>
              )}
              {currentState.lastTestedAt && (
                <div className="text-emerald-600">Last tested: {new Date(currentState.lastTestedAt).toLocaleString()}</div>
              )}
            </div>
          )}

          {/* Error state */}
          {currentState.status === 'error' && currentState.error && (
            <div className="rounded-lg bg-red-50 border border-red-100 p-3 text-xs text-red-700">
              <div className="font-medium mb-0.5">Connection Error</div>
              {currentState.error}
            </div>
          )}

          {/* Auth type notice */}
          <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <span>{connector.authType === 'oauth' ? '🔒 OAuth 2.0' : connector.authType === 'api-key' ? '🔑 API Key' : connector.authType === 'url-token' ? '🌐 URL + Token' : connector.authType === 'credentials' ? '👤 Credentials' : '🧪 Sandbox'}</span>
            {connector.docsUrl && <a href={connector.docsUrl} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">Docs →</a>}
          </div>

          {!isConnected && <label className="block text-xs text-slate-600">
            Resource policy (JSON; no credentials)
            <textarea className="w-full border rounded p-2 mt-1 font-mono" value={resourcePolicy} onChange={event => setResourcePolicy(event.target.value)} placeholder={'{"repositories":["org/repo"],"actions":["read:pull_request","comment:pull_request"]}'} />
            <span>GitHub uses repositories; Jira uses endpoint/projects; Slack uses channels. Explicitly list allowed actions. Vault KV v2 is the implemented resolver.</span>
          </label>}
          {/* Credential fields */}
          {!isConnected && referenceFields.length > 0 && (
            <div className="space-y-3">
              {referenceFields.map(field => (
                <div key={field.key}>
                  <label className="block text-[13px] font-medium text-slate-700 mb-1">
                    {field.label}
                    {field.required && <span className="text-red-400 ml-0.5">*</span>}
                  </label>
                  <div className="relative">
                    <input
                      type={field.type === 'password' && !showSecrets[field.key] ? 'password' : field.type === 'url' ? 'url' : 'text'}
                      placeholder={field.placeholder}
                      value={formValues[field.key] ?? ''}
                      onChange={e => setValue(field.key, e.target.value)}
                      className="w-full text-[13px] border border-slate-200 rounded-lg px-3 py-2 pr-8 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 bg-white"
                    />
                    {field.type === 'password' && (
                      <button
                        type="button"
                        onClick={() => toggleShow(field.key)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-[11px]"
                      >
                        {showSecrets[field.key] ? 'hide' : 'show'}
                      </button>
                    )}
                  </div>
                  {field.hint && <p className="text-[11px] text-slate-400 mt-0.5">{field.hint}</p>}
                </div>
              ))}
            </div>
          )}

          {/* Message */}
          {message && (
            <div className={`rounded-lg p-3 text-xs ${
              message.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
              message.type === 'error' ? 'bg-red-50 text-red-700 border border-red-100' :
              'bg-blue-50 text-blue-700 border border-blue-100'
            }`}>
              {message.text}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            {!isConnected ? (
              <>
                <button
                  onClick={handleConnect}
                  disabled={loading === 'connect' || !allRequiredFilled}
                  className="flex-1 py-2 rounded-lg text-[13px] font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {loading === 'connect' ? 'Connecting…' : 'Connect'}
                </button>
                {connector.sandboxAvailable && (
                  <button
                    onClick={handleSandbox}
                    className="px-3 py-2 rounded-lg text-[13px] font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    Use Sandbox
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  onClick={handleTest}
                  disabled={loading === 'test'}
                  className="flex-1 py-2 rounded-lg text-[13px] font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40 transition-colors"
                >
                  {loading === 'test' ? 'Testing…' : 'Test Connection'}
                </button>
                <button
                  onClick={handleDisconnect}
                  disabled={loading === 'disconnect'}
                  className="px-3 py-2 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 border border-red-100 disabled:opacity-40 transition-colors"
                >
                  {loading === 'disconnect' ? '…' : 'Disconnect'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
