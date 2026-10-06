export interface SessionUser {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: 'user' | 'operator' | 'admin';
  personaScopes?: string[];
}

const BASE = '/_/gateway';

export async function authRequest(path: string, init?: RequestInit) {
  const response = await fetch(`${BASE}${path}`, { ...init, credentials: 'same-origin', cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `Authentication request failed (${response.status})`);
  return data;
}

export async function signInWithKey(apiKey: string): Promise<SessionUser> {
  const result = await authRequest('/api/auth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey }, body: JSON.stringify({ browser: true }),
  });
  return result.user;
}

export function clearUserState(): void {
  for (const key of ['eaos-store', 'execution-store', 'connections-store', 'marketing-store', 'prompt-store', 'eaos_auth_identity']) localStorage.removeItem(key);
}
