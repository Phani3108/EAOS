import { describe, expect, it } from 'vitest';
import { executeWorkflow, workflowEngine } from './workflow-bridge.js';
import type { Workflow } from '@agentos/workflow-engine';

const workflow: Workflow = {
    id: 'fixture-bridge', name: 'Fixture', description: '', version: '1', variables: {}, triggers: [], edges: [],
    metadata: { createdBy: 'fixture', createdAt: new Date(), domain: 'engineering' },
    steps: [{ id: 'tool', name: 'Fixture tool', type: 'tool', config: { type: 'tool', toolId: 'github', params: {} }, retry: { maxAttempts: 1, backoffMs: 0 }, timeoutMs: 100, onError: 'fail' }],
};
describe('legacy workflow bridge containment', () => {
    it('requires a scoped canonical client before accepting a workflow', () => {
        expect(() => executeWorkflow(workflow)).toThrow('tenant-scoped canonical workflow client');
    });
    it('never reports a no-op tool as a completed live action', async () => {
        const result = await workflowEngine.execute(workflow);
        expect(result.status).toBe('failed');
        expect(result.stepStates.get('tool')?.error).toContain('No tenant-scoped tool executor');
    });
});
