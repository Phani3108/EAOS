'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { authRequest, clearUserState, signInWithKey, type SessionUser } from '../lib/auth-client';

let initialSession: Promise<{ user: SessionUser }> | undefined;
const SessionContext = createContext<{ user: SessionUser; busy: boolean; logout: () => Promise<void>; showKey: (key: string) => void } | null>(null);
export function useAuthSession() { return useContext(SessionContext); }

export function SessionControls({ compact = false }: { compact?: boolean }) {
  const session = useContext(SessionContext);
  if (!session) return null;
  return <div className="flex items-center gap-2" title={`${session.user.tenantId} · ${session.user.role}`}>
    {!compact && <span className="hidden lg:inline text-xs max-w-40 truncate">{session.user.email || session.user.name || session.user.id}</span>}
    <button className="btn btn-secondary btn-sm whitespace-nowrap" disabled={session.busy} onClick={() => void session.logout()}>Sign out</button>
  </div>;
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState(false);
  const [credential, setCredential] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [issuedKey, setIssuedKey] = useState('');

  const accept = useCallback((principal: SessionUser, reload = true) => {
    const identity = `${principal.tenantId}:${principal.id}`;
    if (localStorage.getItem('eaos_auth_identity') !== identity) {
      clearUserState();
      localStorage.setItem('eaos_auth_identity', identity);
      if (reload) { window.location.reload(); return; }
    }
    setUser(principal);
  }, []);

  useEffect(() => {
    let active = true;
    const url = new URL(window.location.href);
    const code = url.searchParams.get('login_code');
    if (code) {
      url.searchParams.delete('login_code');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    const load = initialSession ??= (code
      ? authRequest('/api/auth/oidc/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
      : authRequest('/api/auth/me'));
    load.then(data => { if (active) accept(data.user); })
      .catch(err => { if (active && code) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accept]);

  useEffect(() => {
    if (!user || issuedKey) return;
    let active = true;
    const check = () => authRequest('/api/auth/me').catch(() => { if (active) { setUser(null); initialSession = undefined; clearUserState(); } });
    const timer = setInterval(check, 60_000);
    window.addEventListener('focus', check);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', check); };
  }, [user, issuedKey]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      let key = credential;
      if (setup) {
        const result = await authRequest('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setupToken: credential, email }) });
        key = result.apiKey;
        setIssuedKey(key);
      }
      accept(await signInWithKey(key), !setup);
    } catch (err) { setError(err instanceof Error ? err.message : 'Sign-in failed'); }
    finally { setCredential(''); setBusy(false); }
  }

  async function logout() {
    setBusy(true); setError('');
    try {
      await authRequest('/api/auth/logout', { method: 'POST' });
      clearUserState();
      window.location.assign('/');
    } catch (err) { setError(err instanceof Error ? err.message : 'Sign-out failed'); setBusy(false); }
  }

  if (loading) return <main className="p-8" aria-busy="true">Checking session…</main>;
  if (user) return <SessionContext.Provider value={{ user, busy, logout, showKey: setIssuedKey }}>
    {error && <p role="alert" className="fixed bottom-4 right-4 z-[100] rounded border bg-white p-3 text-red-700">{error}</p>}
    {issuedKey && <section className="p-4 bg-amber-50" aria-label="API key disclosure">
      <p>Save this API key. It is shown once.</p>
      <code className="break-all select-all">{issuedKey}</code>
      <button className="btn btn-secondary btn-sm ml-3" onClick={() => window.location.reload()}>I saved the key</button>
    </section>}
    {!issuedKey && children}
  </SessionContext.Provider>;
  return <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
    <form onSubmit={submit} className="w-full max-w-md rounded-xl border bg-white p-6 space-y-4">
      <h1 className="text-xl font-semibold">{setup ? 'Set up EAOS' : 'Sign in to EAOS'}</h1>
      <p className="text-sm text-slate-600">Use your organization API key or single sign-on. Credentials are not saved in browser storage.</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {issuedKey && <section><p>Save your bootstrap key before continuing:</p><code className="break-all select-all">{issuedKey}</code></section>}
      {setup && <label className="block text-sm">Administrator email<input className="input w-full mt-1" type="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>}
      <label className="block text-sm">{setup ? 'Operator setup token' : 'API key'}<input className="input w-full mt-1" type="password" autoComplete="off" required value={credential} onChange={event => setCredential(event.target.value)} /></label>
      <button className="btn btn-primary w-full" disabled={busy}>{busy ? 'Working…' : setup ? 'Create administrator' : 'Sign in'}</button>
      <a className="block text-sm underline" href="/_/gateway/api/auth/oidc/authorize">Sign in with organization SSO</a>
      <button type="button" className="text-sm underline" onClick={() => { setSetup(!setup); setError(''); setCredential(''); }}>{setup ? 'Use an existing API key' : 'First-time administrator setup'}</button>
    </form>
  </main>;
}
