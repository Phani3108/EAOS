import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PostgresRunRepository, RuntimeSnapshot } from '../packages/db/dist/run-repository.js';

export async function seedRuntimeGraph(runs: PostgresRunRepository, tenantId: string, userId: string): Promise<string> {
    const { compileDefinition } = await import('../services/gateway/dist/definition-registry.js');
    const definition = compileDefinition({
        id: 'fixture-conditional-wait', slug: 'fixture-conditional-wait', name: 'Fixture conditional wait', description: 'Fixture', icon: '', persona: 'engineering',
        executableType: 'workflow', cluster: 'Fixture', complexity: 'simple', estimatedTime: '', executionMode: 'dag',
        inputs: [{ id: 'choose', label: 'Choose', type: 'toggle', required: true, section: 'basic' }], outputs: ['final'], requiredTools: [], optionalTools: [], tags: [],
        steps: [
            { id: 'condition', order: 1, name: 'Choose', agent: 'code-reviewer', kind: 'condition', outputKey: 'decision', condition: { expression: 'inputs.choose', trueStep: 'yes', falseStep: 'no' } },
            { id: 'yes', order: 2, name: 'Selected branch', agent: 'code-reviewer', kind: 'transform', outputKey: 'yes', dependsOn: ['condition'], transform: { selected: 'yes' } },
            { id: 'no', order: 3, name: 'Unselected branch', agent: 'code-reviewer', kind: 'transform', outputKey: 'no', dependsOn: ['condition'], transform: { selected: 'no' } },
            { id: 'join', order: 4, name: 'Merge', agent: 'code-reviewer', kind: 'join', outputKey: 'joined', dependsOn: ['yes','no'] },
            { id: 'wait', order: 5, name: 'Wait', agent: 'code-reviewer', kind: 'wait', outputKey: 'waited', dependsOn: ['join'], waitMs: 1000 },
            { id: 'final', order: 6, name: 'Bind output', agent: 'code-reviewer', kind: 'transform', outputKey: 'final', dependsOn: ['wait'], transform: { selected: { $ref: 'steps.yes.output.selected' } } },
        ],
    });
    const id = randomUUID();
    const inputs = { choose: true };
    const snapshot: RuntimeSnapshot = { id, tenantId, userId, persona: 'engineering', skillId: definition.id, skillName: definition.name, status: 'queued', mode: 'live', schemaVersion: 1, definitionHash: definition.definitionHash, definitionVersion: definition.version, executionMode: 'dag', inputs, outputs: {}, startedAt: new Date().toISOString(), steps: definition.steps.map(step => ({ stepId: step.id, stepName: step.name, agent: step.agent, kind: step.kind, tool: step.tool, outputKey: step.outputKey, dependsOn: step.dependsOn, status: 'pending', provenance: 'none' })) };
    await runs.submit(snapshot, { ...definition }, { execId: id, tenantId, userId, persona: 'engineering', skill: definition, inputs, simulate: false });
    return id;
}

export async function verifyRuntimeGraph(runs: PostgresRunRepository, tenantId: string, id: string) {
    const run = await runs.get(tenantId, id);
    assert.equal(run?.status, 'completed');
    assert.deepEqual(JSON.parse(run!.outputs.final!), { selected: 'yes' });
    assert.equal(run!.steps.find(step => step.stepId === 'no')?.status, 'skipped');
    const trace = await runs.trace(tenantId, id);
    assert.equal(trace.attempts.filter(attempt => attempt.step_id === 'yes').length, 1);
    assert.equal(trace.attempts.filter(attempt => attempt.step_id === 'wait').length, 2);
    assert.equal(trace.attempts.filter(attempt => attempt.step_id === 'no').length, 0);
    console.log('PASS canonical conditional merge, structured dependency binding, durable wait continuation and no replay of completed nodes');
}
