import type { ExecutionRequest, ExecutionSnapshot } from '@agentos/gateway/execution-api-contract';
import { authRequest } from './auth-client';

export async function uploadArtifact(file: File): Promise<{ artifactId: string }> {
  if (file.size > 512_000) throw new Error('Artifact limit is 512 KB');
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  const mimeType = extension === 'md' ? 'text/markdown' : extension === 'json' ? 'application/json' : extension === 'csv' ? 'text/csv' : 'text/plain';
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const response = await authRequest('/api/artifacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileName: file.name, mimeType, contentBase64: btoa(binary) }) });
  return { artifactId: response.artifactId };
}

/** A model a live run may name, as `GET /api/llm/models` reports it. */
export interface PricedModel {
  id: string;
  provider: NonNullable<ExecutionRequest['provider']>;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  providerDefault: boolean;
  /** The provider has credentials on the gateway. */
  available: boolean;
}

/**
 * The gateway reserves budget at a model's price before every live call, and
 * refuses a run naming a model it cannot price — so pickers offer only these.
 */
export async function fetchPricedModels(): Promise<PricedModel[]> {
  const response = await authRequest('/api/llm/models');
  return Array.isArray(response.models) ? response.models : [];
}

export async function submitExecution(request: ExecutionRequest): Promise<ExecutionSnapshot> {
  const response = await authRequest('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  return response.execution;
}

export async function fetchExecution(id: string): Promise<ExecutionSnapshot> {
  const response = await authRequest(`/api/executions/${encodeURIComponent(id)}`);
  return response.execution;
}

export async function fetchExecutions(query: { persona?: ExecutionRequest['persona']; limit?: number; offset?: number } = {}): Promise<{ executions: ExecutionSnapshot[]; total: number; limit: number; offset: number }> {
  const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
  return authRequest(`/api/executions?${params}`);
}
