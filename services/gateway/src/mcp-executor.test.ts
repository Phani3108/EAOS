import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./real-executor.js', () => ({ tryRealExecute: vi.fn(async () => null) }));
vi.mock('./policy-store.js', () => ({ checkPolicy: () => ({ allowed: true, matchedDenies: [] }) }));
vi.mock('@agentos/sandbox', () => ({ ToolSandbox: class { check() { return { allowed: true, requiresApproval: false }; } recordCall() {} } }));
import { tryRealExecute } from './real-executor.js';
import { createMCPAction, executeMCPAction, setMcpResolver } from './mcp-executor.js';

const params = { tool_id: 'github', action: 'read' as const, resource_type: 'pull_request', params: { id: 'fixture' }, task_ref: 'fixture', agent_id: 'code-reviewer' };
beforeEach(() => { vi.clearAllMocks(); setMcpResolver(null); });
describe('truthful tool outcomes', () => {
  it('does not fabricate success when live execution is unavailable', async () => {
    const response = await executeMCPAction(createMCPAction({ ...params, mode: 'live' }));
    expect(response.status).toBe('not_connected');
    expect(response.provenance).toBe('none');
    expect(response.data).not.toHaveProperty('found', true);
  });
  it('never calls a real connector or MCP server in explicit simulation', async () => {
    const resolver = vi.fn(async () => ({ actual: true }));
    setMcpResolver(resolver);
    const response = await executeMCPAction(createMCPAction({ ...params, mode: 'simulation' }));
    expect(response.status).toBe('simulated');
    expect(response.provenance).toBe('simulated');
    expect(tryRealExecute).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });
  it('reports unsupported action contracts instead of attempting a generic execute call', async () => {
    const response = await executeMCPAction(createMCPAction({ ...params, action: 'execute', mode: 'live' }));
    expect(response.status).toBe('unsupported');
    expect(tryRealExecute).not.toHaveBeenCalled();
  });
});
