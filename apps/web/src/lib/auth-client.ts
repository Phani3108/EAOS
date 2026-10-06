export interface SessionUser {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: 'user' | 'operator' | 'admin';
  personaScopes?: string[];
  /** True for demo principals (EAOS_DEMO_MODE local/public): runs are labelled, public ones simulated. */
  demo?: boolean;
}

export interface AuthConfig {
  demoMode: 'off' | 'local' | 'public';
  sso: boolean;
  llmConfigured: boolean;
}

const BASE = '/_/gateway';

/** The gateway could not be reached — distinct from "reached it and was told no". */
export class GatewayUnavailableError extends Error {
  constructor() { super('The EAOS gateway is not reachable'); this.name = 'GatewayUnavailableError'; }
}

export class GatewayRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'GatewayRequestError'; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- callers own the response shape (as before)
export async function authRequest(path: string, init?: RequestInit): Promise<any> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { ...init, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new GatewayUnavailableError();
  }
  // Status first: a proxy that cannot reach the gateway answers with an HTML error
  // page, and parsing that as JSON used to surface as a sign-in failure.
  const text = await response.text();
  let data: Record<string, any> = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON body */ }
  if (!response.ok) {
    if (response.status >= 500 && typeof data.error !== 'string') throw new GatewayUnavailableError();
    throw new GatewayRequestError(data.error ?? `Authentication request failed (${response.status})`, response.status);
  }
  return data;
}

export async function getAuthConfig(): Promise<AuthConfig> {
  return await authRequest('/api/auth/config') as AuthConfig;
}

/** Start an isolated, simulation-only demo session (EAOS_DEMO_MODE=public). */
export async function startDemoSession(): Promise<SessionUser> {
  const result = await authRequest('/api/auth/demo', { method: 'POST' });
  return result.user;
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
