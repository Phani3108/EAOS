import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import type { PostgresRunRepository, RuntimeSnapshot } from '../packages/db/dist/run-repository.js';
import type { UnifiedSkillDef, UnifiedStepDef } from '../packages/skills/dist/schema.js';

interface Harness {
    runs: PostgresRunRepository;
    pool: { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, any>[] }> };
    tenantId: string;
    foreignTenant: string;
    start(providerUrl: string): Promise<void>;
    startReplica(providerUrl: string): Promise<() => Promise<void>>;
    stop(crash?: boolean): Promise<void>;
    request(tenant: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; data: any }>;
    waitStatus(tenant: string, id: string, status: string): Promise<any>;
}

export async function verifyParallelRuntime(h: Harness): Promise<void> {
    const { compileDefinition } = await import('../services/gateway/dist/definition-registry.js');
    const { preparePersonaExecution, configureIntegrationRuntime } = await import('../services/gateway/dist/persona-api.js');
    const { PostgresIntegrationRepository } = await import('../packages/db/dist/integration-repository.js');
    configureIntegrationRuntime(new PostgresIntegrationRepository(h.pool as unknown as import('../packages/db/dist/run-repository.js').RuntimePool), undefined);
    const counts = new Map<string, number>();
    let releaseB!: () => void;
    let released = false;
    let markBStarted!: () => void;
    const bStarted = new Promise<void>(resolve => { markBStarted = resolve; });
    const barrier = new Promise<void>(resolve => { releaseB = () => { released = true; resolve(); }; });
    let releaseLoad!: () => void;
    const loadBarrier = new Promise<void>(resolve => { releaseLoad = resolve; });
    let activeLoad = 0, peakLoad = 0;
    let stopReplica: (() => Promise<void>) | undefined;
    const provider = createServer((request, response) => {
        void (async () => {
            let body = '';
            for await (const chunk of request) body += chunk.toString();
            const parsed = JSON.parse(body || '{}');
            const prompt = JSON.stringify(parsed.messages ?? []);
            const marker = ['M3_PARALLEL_A','M3_PARALLEL_B','M3_APPROVAL_A','M3_APPROVAL_B','M3_INVALID_PLAN','M3_VALID_PLAN','M4_ARTIFACT_FIRST','M4_ARTIFACT_SECOND','M6_LOAD'].find(value => prompt.includes(value)) ?? 'ordinary';
            counts.set(marker, (counts.get(marker) ?? 0) + 1);
            if (marker === 'M6_LOAD') { activeLoad++; peakLoad = Math.max(peakLoad, activeLoad); await loadBarrier; await delay(100); activeLoad--; }
            if (marker === 'M3_PARALLEL_A') await bStarted;
            if (marker === 'M3_PARALLEL_B') { markBStarted(); if (!released) await barrier; }
            const content = marker === 'M3_INVALID_PLAN' ? JSON.stringify({ tasks: [{ id: 'bad', skill: 'invented', input: {} }] })
                : marker === 'M3_VALID_PLAN' ? JSON.stringify({ tasks: [{ id: 'explain', skill: 'eng-007', persona: 'engineering', input: { code_or_module: 'fixture code' }, dependencies: [] }] })
                : JSON.stringify({ value: marker, executive_summary: 'fixture', key_findings: 'fixture', recommendations: 'fixture' });
            if (!response.destroyed) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ message: { content }, prompt_eval_count: 10, eval_count: 10 })); }
        })().catch(() => { if (!response.destroyed) response.end(); });
    });
    provider.listen(0, '127.0.0.1');
    await once(provider, 'listening');
    const port = (provider.address() as { port: number }).port;
    const providerUrl = `http://127.0.0.1:${port}`;
    const base = (id: string, steps: UnifiedStepDef[]): UnifiedSkillDef => ({ id, slug: id, name: id, description: 'Fixture', icon: '', persona: 'engineering', executableType: 'workflow', cluster: 'Fixture', complexity: 'simple', estimatedTime: '', executionMode: 'dag', inputs: [], outputs: [steps.at(-1)!.outputKey], steps, requiredTools: [], optionalTools: [], tags: [] });
    const submit = async (raw: UnifiedSkillDef, input: Record<string, unknown> = {}) => {
        const definition = compileDefinition(raw);
        const prepared = preparePersonaExecution(h.tenantId, definition.persona, definition, input, `user-${h.tenantId}`, false);
        return h.runs.submit(prepared.exec as unknown as RuntimeSnapshot, { ...prepared.definition }, prepared.payload);
    };
    try {
        await h.stop();
        await h.start(providerUrl);
        const parallel = await submit(base('parallel-fixture', [
            { id: 'a', order: 1, name: 'M3_PARALLEL_A', agent: 'code-reviewer', kind: 'llm', outputKey: 'a', dependsOn: [] },
            { id: 'b', order: 2, name: 'M3_PARALLEL_B', agent: 'code-reviewer', kind: 'llm', outputKey: 'b', dependsOn: [] },
            { id: 'join', order: 3, name: 'Join fixture', agent: 'code-reviewer', kind: 'transform', outputKey: 'result', dependsOn: ['a','b'], transform: { a: { $ref: 'steps.a.output.value' }, b: { $ref: 'steps.b.output.value' } } },
        ]));
        let checkpoint: RuntimeSnapshot | undefined;
        for (let i = 0; i < 150; i++) {
            checkpoint = await h.runs.get(h.tenantId, parallel.id);
            if (checkpoint?.steps.find(step => step.stepId === 'a')?.status === 'completed' && counts.has('M3_PARALLEL_B')) break;
            await delay(50);
        }
        assert.equal(counts.get('M3_PARALLEL_A'), 1);
        assert.equal(counts.get('M3_PARALLEL_B'), 1);
        assert.equal(checkpoint?.steps.find(step => step.stepId === 'a')?.status, 'completed');
        assert.equal(checkpoint?.steps.find(step => step.stepId === 'b')?.status, 'running');
        assert.equal(checkpoint?.steps.find(step => step.stepId === 'join')?.status, 'pending');
        await h.stop(true);
        releaseB();
        await h.pool.query("UPDATE runtime_jobs SET lease_until=NOW()-INTERVAL '1 second' WHERE tenant_id=$1 AND run_id=$2", [h.tenantId, parallel.id]);
        await h.start(providerUrl);
        const completed = await h.waitStatus(h.tenantId, parallel.id, 'completed');
        assert.deepEqual(JSON.parse(completed.outputs.result), { a: 'M3_PARALLEL_A', b: 'M3_PARALLEL_B' });
        assert.equal(counts.get('M3_PARALLEL_A'), 1);
        assert.equal(counts.get('M3_PARALLEL_B'), 2);
        const approvals = await submit(base('parallel-approvals', [
            { id: 'a', order: 1, name: 'M3_APPROVAL_A', agent: 'code-reviewer', kind: 'llm', outputKey: 'a', requiresApproval: true, dependsOn: [] },
            { id: 'b', order: 2, name: 'M3_APPROVAL_B', agent: 'code-reviewer', kind: 'llm', outputKey: 'b', requiresApproval: true, dependsOn: [] },
            { id: 'join', order: 3, name: 'Approval join', agent: 'code-reviewer', kind: 'join', outputKey: 'result', dependsOn: ['a','b'] },
        ]));
        const paused = await h.waitStatus(h.tenantId, approvals.id, 'paused');
        assert.equal(paused.steps.filter((step: { status: string }) => step.status === 'approval_required').length, 2);
        await h.stop(); await h.start(providerUrl);
        const decisions = await Promise.all(['a','b'].map(step => h.request(h.tenantId, `/api/executions/${approvals.id}/approve/${step}`, {})));
        assert.ok(decisions.every(result => result.status === 200));
        await h.waitStatus(h.tenantId, approvals.id, 'completed');
        assert.equal(counts.get('M3_APPROVAL_A'), 1);
        assert.equal(counts.get('M3_APPROVAL_B'), 1);

        const leaf = base('nested-leaf', [{ id: 'leaf', order: 1, name: 'Nested value', agent: 'code-reviewer', kind: 'transform', outputKey: 'leaf', transform: { value: { $ref: 'inputs.value' } } }]);
        const middle = base('nested-middle', [{ id: 'middle', order: 1, name: 'Nested leaf run', agent: 'code-reviewer', kind: 'subworkflow', outputKey: 'middle', subworkflow: { definition: leaf }, inputBindings: { value: { $ref: 'inputs.value' } } }]);
        const nested = await submit(base('nested-root', [
            { id: 'left', order: 1, name: 'Left child', agent: 'code-reviewer', kind: 'subworkflow', outputKey: 'left', dependsOn: [], subworkflow: { definition: middle }, inputBindings: { value: 'left' } },
            { id: 'right', order: 2, name: 'Right child', agent: 'code-reviewer', kind: 'subworkflow', outputKey: 'right', dependsOn: [], subworkflow: { definition: middle }, inputBindings: { value: 'right' } },
            { id: 'join', order: 3, name: 'Child result binding', agent: 'code-reviewer', kind: 'transform', outputKey: 'result', dependsOn: ['left','right'], transform: { left: { $ref: 'steps.left.output.middle.leaf.value' }, right: { $ref: 'steps.right.output.middle.leaf.value' } } },
        ]));
        const nestedResult = await h.waitStatus(h.tenantId, nested.id, 'completed');
        assert.deepEqual(JSON.parse(nestedResult.outputs.result), { left: 'left', right: 'right' });
        const children = await h.runs.children(h.tenantId, nested.id);
        assert.equal(children.length, 2);
        for (const child of children) assert.equal((await h.runs.children(h.tenantId, child.id)).length, 1);
        assert.equal((await h.request(h.foreignTenant, `/api/executions/${children[0]!.id}`)).status, 404);
        const validGoal = await h.request(h.tenantId, '/api/orchestrator/goal', { description: 'M3_VALID_PLAN explain fixture' });
        assert.equal(validGoal.status, 200);
        await h.waitStatus(h.tenantId, validGoal.data.id, 'completed');
        assert.equal((await h.runs.children(h.tenantId, validGoal.data.id)).length, 1);
        const invalidGoal = await h.request(h.tenantId, '/api/orchestrator/goal', { description: 'M3_INVALID_PLAN reject hallucinated skill' });
        assert.equal(invalidGoal.status, 200);
        await h.waitStatus(h.tenantId, invalidGoal.data.id, 'failed');
        assert.equal((await h.runs.children(h.tenantId, invalidGoal.data.id)).length, 0);
        const artifactOutputs: string[] = [];
        for (const content of ['M4_ARTIFACT_FIRST','M4_ARTIFACT_SECOND']) {
            const upload = await h.request(h.tenantId, '/api/artifacts', { fileName: 'source.txt', mimeType: 'text/plain', contentBase64: Buffer.from(content).toString('base64') });
            assert.equal(upload.status, 201);
            assert.equal((await h.request(h.foreignTenant, `/api/artifacts/${upload.data.artifactId}`)).status, 404);
            const raw = base('artifact-fixture', [{ id: 'read', order: 1, name: 'Read the uploaded source', agent: 'code-reviewer', kind: 'llm', outputKey: 'result' }]);
            raw.inputs = [{ id: 'source', label: 'Source', type: 'file', required: true, section: 'basic' }];
            const run = await submit(raw, { source: { artifactId: upload.data.artifactId } });
            const result = await h.waitStatus(h.tenantId, run.id, 'completed');
            artifactOutputs.push(result.outputs.result);
            assert.ok(result.outputs.result.includes(content));
        }
        assert.notEqual(artifactOutputs[0], artifactOutputs[1]);
        const { getCompiledCatalog } = await import('../services/gateway/dist/definition-registry.js');
        const { certificationInputs } = await import('./m5.certification-contract.js');
        const catalog = getCompiledCatalog();
        for (const persona of ['engineering','product','marketing','hr','ta','program']) {
            const candidate = catalog.find(definition => definition.persona === persona && definition.steps.every(step => step.kind === 'llm' && !step.requiresApproval)) ?? catalog.find(definition => definition.persona === persona && definition.steps.every(step => step.kind === 'llm'));
            assert.ok(candidate, `Missing mocked content lifecycle for ${persona}`);
            const request = await h.request(h.tenantId, '/api/execute', { persona, skillId: candidate.id, inputs: certificationInputs(candidate, 'unused'), simulate: false });
            assert.ok([200,201].includes(request.status));
            for (const step of candidate.steps.filter(step => step.requiresApproval)) {
                await h.waitStatus(h.tenantId, request.data.execution.id, 'paused');
                assert.equal((await h.request(h.tenantId, `/api/executions/${request.data.execution.id}/approve/${step.id}`, { reason: 'Synthetic fixture lifecycle approval, not human domain review' })).status, 200);
            }
            await h.waitStatus(h.tenantId, request.data.execution.id, 'completed');
        }
        stopReplica = await h.startReplica(providerUrl);
        const loadIds: string[] = [];
        const loadStarted = Date.now();
        const actors = ['code-reviewer','docs-writer','debug-specialist','tech-lead'];
        for (let i = 0; i < 24; i++) loadIds.push((await submit(base(`m6-load-${i}`, [{ id: 'load', order: 1, name: `M6_LOAD ${i}`, agent: actors[i % actors.length]!, kind: 'llm', outputKey: 'result' }]))).id);
        let instances = new Set<string>();
        for (let attempt = 0; attempt < 200 && instances.size < 2; attempt++) {
            const claims = await h.pool.query("SELECT lease_owner FROM runtime_jobs WHERE tenant_id=$1 AND run_id=ANY($2::text[]) AND status='running'", [h.tenantId, loadIds]);
            instances = new Set(claims.rows.map(row => String(row.lease_owner).split(':')[0]!));
            await delay(50);
        }
        assert.equal(instances.size, 2);
        releaseLoad();
        let completedLoad = 0;
        for (let attempt = 0; attempt < 600 && completedLoad < loadIds.length; attempt++) {
            completedLoad = Number((await h.pool.query("SELECT count(*) AS count FROM runtime_runs WHERE tenant_id=$1 AND id=ANY($2::text[]) AND status='completed'", [h.tenantId, loadIds])).rows[0]!.count);
            await delay(50);
        }
        assert.equal(completedLoad, loadIds.length);
        assert.equal(counts.get('M6_LOAD'), 24);
        assert.ok(peakLoad > 1 && peakLoad <= 8);
        await stopReplica(); stopReplica = undefined;
        console.log(`PASS M6 two-gateway load: ${completedLoad} runs, ${instances.size} instances, peak ${peakLoad} provider requests, ${Date.now() - loadStarted}ms observed; no throughput extrapolation`);
        console.log('PASS M5 six-family mocked content lifecycle; external-operation verticals and human review are not certified');
        console.log('PASS primary parallel overlap, checkpoint crash recovery, parallel approvals, recursive child execution, validated live planner and content-dependent artifact inputs');
    } finally {
        configureIntegrationRuntime(undefined, undefined);
        releaseB(); releaseLoad();
        await stopReplica?.();
        await h.stop();
        provider.closeAllConnections();
        await new Promise<void>(resolve => provider.close(() => resolve()));
    }
}
