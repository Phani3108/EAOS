import assert from 'node:assert/strict';
import type { PostgresRunRepository } from '../packages/db/dist/run-repository.js';

export async function verifyEntrypointParity(h: {
    runs: PostgresRunRepository; tenantId: string; foreignTenant: string;
    request(tenant: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; data: any }>;
    waitStatus(tenant: string, id: string, status: string): Promise<any>;
}) {
    const plan = { tasks: [{ id: 'explain', skill: 'eng-007', persona: 'engineering', dependencies: [], input: { code_or_module: 'fixture' } }] };
    const goal = await h.request(h.tenantId, '/api/orchestrator/goal', { description: 'Fixture structured goal', plan, simulate: true }, { 'Idempotency-Key': 'goal-fixture' });
    assert.equal(goal.status, 200);
    assert.equal((await h.request(h.tenantId, '/api/orchestrator/goal', { description: 'Fixture structured goal', plan, simulate: true }, { 'Idempotency-Key': 'goal-fixture' })).data.id, goal.data.id);
    await h.waitStatus(h.tenantId, goal.data.id, 'simulated');
    assert.equal((await h.request(h.tenantId, `/api/orchestrator/goal/${goal.data.id}`)).data.status, 'simulated');
    assert.equal((await h.request(h.foreignTenant, `/api/orchestrator/goal/${goal.data.id}`)).status, 404);
    assert.equal((await h.request(h.tenantId, '/api/orchestrator/goal', { description: 'Invalid goal', plan: { tasks: [{ ...plan.tasks[0], skill: 'invented' }] } })).status, 422);
    const graphConfig = { graph_id: 'fixture', name: 'Fixture SOMAN', nodes: [
        { id: 'a', agent: 'code-reviewer', kind: 'transform', transform: { value: 'a' }, depends_on: [], phase: 'main', parallel_group: 'parallel' },
        { id: 'b', agent: 'docs-writer', kind: 'transform', transform: { value: 'b' }, depends_on: [], phase: 'main', parallel_group: 'parallel' },
        { id: 'join', agent: 'code-reviewer', kind: 'join', depends_on: ['a','b'], phase: 'main', parallel_group: null },
    ], phases: { main: {} }, quality_gates: [], checkpoints: [], feedback_loops: [], shared_state: {} };
    // This gateway has no LLM provider: a launch that makes no run-mode choice (as the
    // UI's pipeline and swarm views do) is a labelled simulation, not a live run.
    const unchosen = await h.request(h.tenantId, '/api/pipeline/execute', { intent: 'Fixture SOMAN run without a mode choice', persona: 'engineering', graphConfig });
    assert.equal(unchosen.status, 200);
    assert.equal(unchosen.data.mode, 'simulation');
    await h.waitStatus(h.tenantId, unchosen.data.id, 'simulated');
    // A deterministic graph needs no model, so an explicit live run completes without one.
    const soman = await h.request(h.tenantId, '/api/pipeline/execute', { intent: 'Fixture SOMAN run', persona: 'engineering', graphConfig, simulate: false });
    assert.equal(soman.status, 200);
    const somanRun = await h.waitStatus(h.tenantId, soman.data.id, 'completed');
    assert.deepEqual(somanRun.steps.map((step: { status: string }) => step.status), ['completed','completed','completed']);
    assert.equal((await h.request(h.tenantId, `/api/pipeline/${soman.data.id}`)).data.status, 'completed');
    assert.equal((await h.request(h.foreignTenant, `/api/pipeline/${soman.data.id}`)).status, 404);
    const graph = await h.request(h.tenantId, '/api/marketing/pipeline/graph');
    assert.equal(graph.status, 200);
    const fullSoman = await h.request(h.tenantId, '/api/pipeline/execute', { intent: 'Fixture full marketing graph', persona: 'marketing', graphConfig: graph.data, simulate: true });
    assert.equal(fullSoman.status, 200, JSON.stringify(fullSoman.data));
    await h.waitStatus(h.tenantId, fullSoman.data.id, 'simulated');
    assert.equal((await h.request(h.tenantId, '/api/pipeline/graph?persona=../../')).status, 400);
    const approval = await h.request(h.tenantId, '/api/pipeline/execute', { intent: 'Fixture approval graph', persona: 'engineering', simulate: false, graphConfig: { ...graphConfig, checkpoints: [{ id: 'approval', before_node: 'join', type: 'human_approval', description: 'Confirm fixture', requires_fields: ['fixture_confirmed'] }] } });
    assert.equal(approval.status, 200);
    const paused = await h.waitStatus(h.tenantId, approval.data.id, 'paused');
    const gate = paused.steps.find((step: { status: string }) => step.status === 'approval_required');
    assert.ok(gate);
    assert.equal((await h.request(h.tenantId, `/api/executions/${approval.data.id}/approve/${gate.stepId}`, {})).status, 409);
    assert.equal((await h.request(h.tenantId, `/api/executions/${approval.data.id}/approve/${gate.stepId}`, { confirmations: { fixture_confirmed: true } })).status, 200);
    await h.waitStatus(h.tenantId, approval.data.id, 'completed');
    const swarm = await h.request(h.tenantId, '/api/swarms/launch', { type: 'product_launch', mission: 'Fixture product launch', simulate: true });
    assert.equal(swarm.status, 201);
    const swarmId = swarm.data.swarm.swarm_id;
    await h.waitStatus(h.tenantId, swarmId, 'simulated');
    assert.equal((await h.runs.children(h.tenantId, swarmId)).length, 5);
    assert.equal((await h.request(h.tenantId, `/api/a2a/swarms/${swarmId}`)).data.swarm.status, 'simulated');
    assert.equal((await h.request(h.tenantId, `/api/swarms/${swarmId}/advance`, {})).status, 409);
    const cancelled = await h.request(h.tenantId, '/api/swarms/launch', { type: 'campaign_pod', mission: 'Fixture cancel before activation', simulate: false });
    assert.equal(cancelled.status, 201);
    await h.waitStatus(h.tenantId, cancelled.data.id, 'paused');
    assert.equal((await h.request(h.foreignTenant, `/api/swarms/${cancelled.data.id}/dissolve`, {})).status, 404);
    assert.equal((await h.request(h.tenantId, `/api/swarms/${cancelled.data.id}/dissolve`, {})).data.cancelled, true);
    await h.waitStatus(h.tenantId, cancelled.data.id, 'cancelled');
    for (const [path, expected] of [['/api/orchestrator/goals', goal.data.id], ['/api/pipelines', soman.data.id]]) {
        const history = await h.request(h.tenantId, path);
        assert.ok(history.data.some((run: { id: string }) => run.id === expected));
    }
    console.log('PASS goal/SOMAN/swarm canonical admission, lifecycle/read/cancel parity, graph safety, confirmations and history');
}
