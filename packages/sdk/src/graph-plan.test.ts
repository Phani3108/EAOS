import { describe, expect, it } from 'vitest';
import { planGraph, resolveGraphInput, validateGraph } from './graph-plan.js';
import { LegacyWorkflowRunner as WorkflowRunner, WorkflowRunner as CanonicalWorkflowRunner } from './workflow-runner.js';
import type { WorkflowDefinition, TaskResult } from './types.js';

describe('shared graph contracts', () => {
    it('waits for selected dependencies and prunes inactive branches', () => {
        const plan = planGraph([{ id: 'a', status: 'completed' },{ id: 'b', status: 'running' },{ id: 'join', status: 'pending' }], [{ from: 'a', to: 'join' },{ from: 'b', to: 'join' }]);
        expect(plan.ready).toEqual([]);
        expect(planGraph([{ id: 'a', status: 'completed' },{ id: 'unused', status: 'pending' },{ id: 'join', status: 'pending' }], [{ from: 'a', to: 'unused', enabled: false },{ from: 'a', to: 'join' },{ from: 'unused', to: 'join' }])).toEqual({ ready: ['join'], skipped: ['unused'], blocked: [] });
    });
    it('rejects cycles and unknown graph references', () => {
        expect(() => validateGraph([{ id: 'a' }], [{ from: 'missing', to: 'a' }])).toThrow();
        expect(() => validateGraph([{ id: 'a' },{ id: 'b' }], [{ from: 'a', to: 'b' },{ from: 'b', to: 'a' }])).toThrow();
    });
    it('preserves structured values and denies missing/prototype bindings', () => {
        const source = { inputs: { ids: [1,2], empty: false } };
        expect(resolveGraphInput({ items: '{{ inputs.ids }}', flag: { $ref: 'inputs.empty' } }, source)).toEqual({ items: [1,2], flag: false });
        expect(() => resolveGraphInput('{{ inputs.missing }}', source)).toThrow();
        expect(() => resolveGraphInput('{{ inputs.constructor }}', source)).toThrow();
        expect(() => resolveGraphInput('ids={{ inputs.ids }}', source)).toThrow();
    });
    it('requires a canonical client instead of creating an alternate execution', async () => {
        expect(() => new CanonicalWorkflowRunner({} as any)).toThrow('authenticated canonical workflow client');
        const remote = { id: 'server-run', workflowId: 'fixture', status: 'paused' as const, trigger: {}, stepResults: new Map(), startedAt: new Date() };
        const runner = new CanonicalWorkflowRunner({ execute: async () => remote, get: async () => remote, cancel: async () => true, decide: async () => {} });
        expect(await runner.execute({} as WorkflowDefinition, {})).toBe(remote);
        expect(await runner.get(remote.id)).toBe(remote);
    });
    it('does not retry non-retryable SDK failures', async () => {
        let calls = 0;
        const runner = new WorkflowRunner({ dispatch: async () => { calls++; return { taskId: 'fixture', status: 'failure', error: { code: 'denied', message: 'Fixture denied', retryable: false }, durationMs: 0, tokensUsed: 0, toolCallCount: 0 }; } }, { evaluate: async () => true }, { requestApproval: async () => true });
        const workflow: WorkflowDefinition = { name: 'fixture', description: '', version: '1', trigger: { event: 'manual' }, priority: 'normal', steps: [{ id: 'one', name: 'One', worker: 'fixture', retry: { maxAttempts: 3, initialDelayMs: 0, backoff: 'fixed' } }] };
        expect((await runner.execute(workflow, {})).status).toBe('failed');
        expect(calls).toBe(1);
    });
    it('validates SDK graphs before dispatch and records no false completion', async () => {
        let calls = 0;
        const runner = new WorkflowRunner({ dispatch: async (): Promise<TaskResult> => { calls++; return { taskId: 'fixture', status: 'success', durationMs: 0, tokensUsed: 0, toolCallCount: 0 }; } }, { evaluate: async () => true }, { requestApproval: async () => true });
        const result = await runner.execute({ name: 'fixture', description: '', version: '1', trigger: { event: 'manual' }, priority: 'normal', steps: [{ id: 'one', name: 'One', worker: 'fixture', dependsOn: ['one'] }] }, {});
        expect(result.status).toBe('failed');
        expect(calls).toBe(0);
    });
});
