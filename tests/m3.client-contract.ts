import assert from 'node:assert/strict';
import type { Workflow } from '../packages/workflow-engine/dist/engine.js';

export async function verifyWorkflowClients(h: { base: string; tenantId: string; headers: () => Promise<Record<string, string>>; waitStatus(tenant: string, id: string, status: string): Promise<any> }) {
    const { GatewayWorkflowClient, WorkflowRunner } = await import('../packages/sdk/dist/index.js');
    const { GatewayWorkflowBridgeClient } = await import('../services/gateway/dist/workflow-bridge.js');
    const client = new GatewayWorkflowClient({ baseUrl: h.base, headers: h.headers, simulate: true });
    const runner = new WorkflowRunner(client);
    const admitted = await runner.execute({ name: 'SDK fixture', description: 'Fixture', version: '1', trigger: { event: 'manual' }, priority: 'normal', steps: [{ id: 'explain', name: 'Explain fixture', worker: 'code-reviewer', action: 'eng-007', input: { code_or_module: '{{ trigger.code }}' } }] }, { code: 'fixture' });
    await h.waitStatus(h.tenantId, admitted.id, 'simulated');
    assert.equal((await runner.get(admitted.id))?.status, 'simulated');
    assert.equal((await runner.get(admitted.id))?.stepResults.get('explain')?.status, 'success');
    const live = new GatewayWorkflowClient({ baseUrl: h.base, headers: h.headers });
    const bridge = new GatewayWorkflowBridgeClient(() => live);
    const owner = { tenantId: h.tenantId, userId: `user-${h.tenantId}` };
    const workflow: Workflow = { id: 'bridge-fixture', name: 'Bridge fixture', description: '', version: '1', metadata: { domain: 'engineering', createdBy: 'fixture', createdAt: new Date() }, variables: { value: 3 }, triggers: [], edges: [{ from: 'value', to: 'approval' }, { from: 'approval', to: 'result' }], steps: [
        { id: 'value', name: 'Value', type: 'transform', config: { type: 'transform', expression: 'variables.value + 1' }, retry: { maxAttempts: 1, backoffMs: 0 }, timeoutMs: 1000, onError: 'fail' },
        { id: 'approval', name: 'Approve fixture', type: 'approval', config: { type: 'approval', action: 'review', sensitivity: 'high' }, retry: { maxAttempts: 1, backoffMs: 0 }, timeoutMs: 1000, onError: 'fail' },
        { id: 'result', name: 'Result', type: 'transform', config: { type: 'transform', expression: 'value_output + 1' }, retry: { maxAttempts: 1, backoffMs: 0 }, timeoutMs: 1000, onError: 'fail' },
    ] };
    const pending = await bridge.execute(owner, workflow);
    await h.waitStatus(h.tenantId, pending.id, 'paused');
    assert.equal((await bridge.get(owner, pending.id))?.stepStates.get('approval')?.status, 'waiting_approval');
    await assert.rejects(bridge.get({ ...owner, tenantId: 'foreign' }, pending.id));
    await bridge.resume(owner, pending.id, 'approval', { approved: true });
    const completed = await h.waitStatus(h.tenantId, pending.id, 'completed');
    assert.equal(JSON.parse(completed.outputs.result), 5);
    assert.equal((await bridge.get(owner, pending.id))?.status, 'complete');
    const cancelled = await bridge.execute(owner, workflow);
    await h.waitStatus(h.tenantId, cancelled.id, 'paused');
    assert.equal(await bridge.cancel(owner, cancelled.id), true);
    assert.equal((await bridge.get(owner, cancelled.id))?.status, 'cancelled');
    console.log('PASS authenticated SDK/bridge adapters, shared state, structured bindings, approval continuation and cancellation');
}
