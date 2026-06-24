'use client';
/** Pre-flight checks — what's blocking a real, successful run, and how to fix it. */
import { useConnectionsStore } from '../store/connections-store';
import { useGatewayReachable } from '../components/DemoModeBanner';

export interface Blocker {
  id: string;
  problem: string;
  why: string;
  fixLabel: string;
  fixSection: string;
}
export interface Preflight {
  hasLLMKey: boolean;
  hasAnyConnector: boolean;
  gatewayReachable: boolean;
  blockers: Blocker[];
}

export function usePreflight(): Preflight {
  const isToolConnected = useConnectionsStore((s) => s.isToolConnected);
  const connectedCount = useConnectionsStore((s) => s.getConnectedCount());
  const gatewayReachable = useGatewayReachable();

  const hasLLMKey = isToolConnected('anthropic') || isToolConnected('openai') || isToolConnected('azure-openai');
  const hasAnyConnector = connectedCount > 0;

  const blockers: Blocker[] = [];
  if (!gatewayReachable) {
    blockers.push({ id: 'gateway', problem: 'Gateway offline', why: "The backend on :3000 is unreachable — screens show demo data and executions can't run for real.", fixLabel: 'Open Settings', fixSection: 'admin-settings' });
  }
  if (!hasLLMKey) {
    blockers.push({ id: 'llm', problem: 'No LLM connected', why: 'Executions will run in sandbox mode (simulated output) until you add an API key.', fixLabel: 'Add API key', fixSection: 'conn-ai-models' });
  }
  return { hasLLMKey, hasAnyConnector, gatewayReachable, blockers };
}
