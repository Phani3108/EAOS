import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { RuntimePool, PostgresRunRepository, RuntimeSnapshot } from '../packages/db/dist/run-repository.js';

export async function verifyPlatformGovernance(pool: RuntimePool, runs: PostgresRunRepository, tenantId: string, foreignTenant: string, reviewerId: string) {
  const { PlatformRepository } = await import('../packages/db/dist/platform-repository.js');
  const repository = new PlatformRepository(pool);
  const owner = { tenantId, userId: `user-${tenantId}`, role: 'admin' as const, personaScopes: ['*'] };
  const reviewer = { ...owner, userId: reviewerId };
  const foreign = { ...owner, tenantId: foreignTenant, userId: `user-${foreignTenant}` };
  await repository.recordRequest(tenantId, 'GET', '/api/executions', 200, 12);
  await repository.recordRequest(foreignTenant, 'GET', '/api/executions', 200, 99);
  assert.equal((await repository.summary(owner)).http.requests, 1);
  assert.equal((await repository.summary(foreign)).http.requests, 1);
  const definition = { id: 'governed-fixture', version: '1', definitionHash: 'f'.repeat(64), persona: 'engineering', steps: [{ id: 'step', kind: 'transform', outputKey: 'result' }], inputs: [] };
  const dataset = await repository.createDataset(owner, { name: 'Reviewed fixture dataset', cases: [1,2,3].map(id => ({ id: String(id), inputs: { value: id }, expected: `fixture-${id}` })) });
  await assert.rejects(repository.getDataset(foreign, dataset.id));
  await repository.shareDataset(owner, dataset.id, dataset.version, [reviewerId]);
  const observations: Array<{ caseId: string; runId: string; passed: boolean; reason: string }> = [];
  for (const id of [1,2,3]) {
    const snapshot: RuntimeSnapshot = { id: randomUUID(), tenantId, userId: owner.userId, persona: 'engineering', definitionHash: definition.definitionHash, status: 'queued', mode: 'live', inputs: { value: id }, outputs: {}, steps: [{ stepId: 'step', kind: 'transform', agent: 'code-reviewer', outputKey: 'result', status: 'pending', provenance: 'none' }] };
    await runs.submit(snapshot, definition, {});
    const claimed = (await runs.claim(tenantId, `eval-${id}`))!;
    await runs.checkpoint(claimed.lease, { ...claimed.snapshot, status: 'completed', outputs: { result: `fixture-${id}` }, steps: [{ ...claimed.snapshot.steps[0]!, status: 'completed', provenance: 'live' }] });
    observations.push({ caseId: String(id), runId: snapshot.id, passed: true, reason: 'Compared with the labeled fixture output' });
  }
  const shared = await repository.getDataset(reviewer, dataset.id);
  const evaluation = await repository.recordEvaluation(reviewer, { datasetId: dataset.id, datasetVersion: shared.version, definitionHash: definition.definitionHash, observations });
  assert.equal(evaluation.sampleCount, 3);
  assert.equal(evaluation.passRate, 1);
  const staged = await repository.stageVersion(owner, { name: 'fixture.workflow', kind: 'workflow', definition, origin: 'local:fixture', license: 'MIT', visibility: 'tenant' });
  await assert.rejects(repository.reviewVersion(owner, staged.packageId, staged.hash, evaluation.id, true, 'Self approval must fail'));
  await assert.rejects(repository.activateVersion(owner, staged.packageId, staged.hash, staged.revision));
  await repository.reviewVersion(reviewer, staged.packageId, staged.hash, evaluation.id, true, 'Independent fixture review');
  const active = await repository.activateVersion(owner, staged.packageId, staged.hash, staged.revision);
  assert.equal(active.activeHash, staged.hash);
  await assert.rejects(repository.activateVersion(owner, staged.packageId, staged.hash, staged.revision));
  await assert.rejects(repository.getActiveVersion(foreign, staged.packageId));
  assert.equal((await repository.getActiveVersion(reviewer, staged.packageId)).hash, staged.hash);
  const metric = await repository.summary(owner);
  assert.equal(metric.evaluations.sampleCount, 3);
  assert.equal(metric.evaluations.passRate, 1);
  const simulationDefinition = { ...definition, id: 'simulation-only', definitionHash: '9'.repeat(64) };
  const simulationDataset = await repository.createDataset(owner, { name: 'Simulation-only evidence', cases: [1,2,3].map(value => ({ id: String(value), inputs: { value }, expected: `fixture-${value}` })) });
  await repository.shareDataset(owner, simulationDataset.id, 1, [reviewerId]);
  const simulationObservations = [];
  for (const value of [1,2,3]) {
    const simulated: RuntimeSnapshot = { id: randomUUID(), tenantId, userId: owner.userId, persona: 'engineering', definitionHash: simulationDefinition.definitionHash, mode: 'simulation', status: 'queued', inputs: { value }, outputs: {}, steps: [{ stepId: 'step', outputKey: 'result', status: 'pending', provenance: 'none' }] };
    await runs.submit(simulated, simulationDefinition, {});
    const claimed = (await runs.claim(tenantId, 'simulation-evidence'))!;
    await runs.checkpoint(claimed.lease, { ...claimed.snapshot, status: 'simulated', outputs: { result: `fixture-${value}` }, steps: [{ ...claimed.snapshot.steps[0]!, status: 'simulated', provenance: 'simulated' }] });
    simulationObservations.push({ caseId: String(value), runId: simulated.id, passed: true, reason: 'Synthetic fixture comparison only' });
  }
  const simulatedEvaluation = await repository.recordEvaluation(reviewer, { datasetId: simulationDataset.id, datasetVersion: 2, definitionHash: simulationDefinition.definitionHash, observations: simulationObservations });
  const simulatedVersion = await repository.stageVersion(owner, { name: 'fixture.simulation', kind: 'workflow', definition: simulationDefinition, origin: 'local:fixture', license: 'MIT', visibility: 'tenant' });
  await assert.rejects(repository.reviewVersion(reviewer, simulatedVersion.packageId, simulatedVersion.hash, simulatedEvaluation.id, true, 'Simulation cannot authorize a live version'));
  assert.equal((await repository.summary(owner)).evaluations.sampleCount, 3);
  const { PostgresWorkspaceRepository } = await import('../packages/db/dist/workspace-repository.js');
  const workspace = new PostgresWorkspaceRepository(pool);
  const document = await workspace.putRecord(owner, 'knowledge', randomUUID(), { title: 'Governed fixture', content: 'governed fixture evidence' }, 0);
  const review = { family: 'knowledge' as const, id: document.id, version: document.version, ownerId: owner.userId, readers: [reviewerId], expiresAt: new Date(Date.now() + 86400_000).toISOString() };
  await assert.rejects(repository.reviewRecord(reviewer, review));
  await repository.requestRecordReview(owner, { ...review, reviewerId });
  await repository.reviewRecord(reviewer, review);
  assert.equal((await repository.searchKnowledge(reviewer, 'governed fixture')).length, 1);
  assert.equal((await repository.searchKnowledge(foreign, 'governed fixture')).length, 0);
  await workspace.putRecord(owner, 'knowledge', document.id, { title: 'Changed fixture', content: 'changed evidence' }, document.version);
  assert.equal((await repository.searchKnowledge(reviewer, 'governed fixture')).length, 0);
  await repository.shareDataset(owner, dataset.id, shared.version, []);
  await assert.rejects(repository.getActiveVersion(owner, staged.packageId));
  await assert.rejects(repository.getDataset(reviewer, dataset.id));
  // Demo principals are users (the durable runtime references them) but never
  // members: a public demo provisions one per visit, and the local administrator
  // exists only while local mode is on — so it must not count as the last admin.
  const demoAdmin = `demo:contract-${tenantId}`;
  const demoClient = await pool.connect();
  try {
    await demoClient.query('BEGIN');
    await demoClient.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    await demoClient.query("INSERT INTO users (id,email,name,role,tenant_id) VALUES ($1,$2,'Demo fixture','admin',$3)", [demoAdmin, `${demoAdmin}@demo.invalid`, tenantId]);
    await demoClient.query('COMMIT');
  } finally { demoClient.release(); }
  const members = await repository.members(owner) as Array<{ id: string }>;
  assert.ok(members.some(member => member.id === owner.userId));
  assert.ok(members.every(member => !member.id.startsWith('demo:')));
  await repository.updateMember(owner, owner.userId, 0, { role: 'admin', state: 'active', personaScopes: ['*'] });
  await assert.rejects(repository.updateMember(owner, owner.userId, 1, { role: 'user', state: 'active', personaScopes: ['*'] }));
  const pending: RuntimeSnapshot = { id: randomUUID(), tenantId, userId: reviewerId, persona: 'engineering', definitionHash: definition.definitionHash, status: 'queued', mode: 'simulation', inputs: {}, outputs: {}, steps: [{ stepId: 'step', kind: 'transform', outputKey: 'result', status: 'pending', provenance: 'none' }] };
  await runs.submit(pending, definition, {});
  await repository.updateMember(owner, reviewerId, 0, { role: 'operator', state: 'suspended', personaScopes: ['engineering'] });
  await assert.rejects(repository.summary(reviewer));
  assert.equal(await runs.claim(tenantId, 'revoked-owner-worker'), undefined);
  assert.equal((await runs.get(tenantId, pending.id))?.status, 'cancelled');
  await repository.updateMember(owner, reviewerId, 1, { role: 'operator', state: 'active', personaScopes: ['engineering'] });
  await assert.rejects(runs.submit({ ...pending, id: randomUUID(), status: 'queued', persona: 'marketing', requiredPersonas: ['marketing'] }, definition, {}));
  for (;;) {
    const events = await runs.claimEvents(tenantId, 'platform-replay-fixture', 100);
    for (const event of events) await runs.ackEvent(event, 'platform-replay-fixture');
    if (events.length < 100) break;
  }
  const firstPage = await repository.replayEvents(owner, undefined, 2);
  assert.ok(firstPage.events.length);
  const secondPage = await repository.replayEvents(owner, firstPage.cursor, 2);
  assert.ok(secondPage.events.every(event => !firstPage.events.some(first => first.id === event.id)));
  assert.ok(firstPage.events.every(event => event.data.tenantId === tenantId && event.data.schemaVersion === 1));
  console.log('PASS measured tenant operations, governed source invalidation, evaluation evidence, independent CAS promotion, membership revocation and ordered replay');
}
