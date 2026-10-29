import assert from 'node:assert/strict';
import type { RuntimePool } from '../packages/db/dist/run-repository.js';

export async function verifyConnectorRegistry(pool: RuntimePool, tenantId: string, foreignTenant: string, reviewerId: string) {
  const { PlatformRepository } = await import('../packages/db/dist/platform-repository.js');
  const { compileConnectorManifest } = await import('../services/gateway/dist/connector-service.js');
  const repository = new PlatformRepository(pool, compileConnectorManifest);
  const owner = { tenantId, userId: `user-${tenantId}`, role: 'admin' as const, personaScopes: ['*'] };
  const reviewer = { ...owner, userId: reviewerId };
  const input = { name: 'fixture.connector', kind: 'connector' as const, definition: { schemaVersion: 1, id: 'jira', actions: ['jira:read:issue','jira:create:issue'] }, origin: 'local:fixture', license: 'MIT', visibility: 'private' as const, reviewers: [reviewerId] };
  await assert.rejects(repository.stageVersion(owner, { ...input, definition: { ...input.definition, id: 'github' } }));
  await assert.rejects(repository.stageVersion(owner, { ...input, definition: { ...input.definition, actions: ['jira:read:issue','jira:read:issue'] } }));
  await assert.rejects(new PlatformRepository(pool).stageVersion(owner, input));
  const staged = await repository.stageVersion(owner, input);
  const report = await repository.connectorConformance(reviewer, staged.packageId, staged.hash);
  assert.equal(report.adapterCurrent, true);
  assert.equal(report.activationEligible, false);
  assert.ok(report.blockers.includes('vendor_sandbox_certification_pending'));
  assert.ok(report.actions.some(action => action.customTransport > 0));
  assert.ok(report.actions.every(action => action.nativeTransport === 0));
  await assert.rejects(repository.connectorConformance({ ...owner, tenantId: foreignTenant, userId: `user-${foreignTenant}` }, staged.packageId, staged.hash));
  await assert.rejects(repository.reviewVersion(reviewer, staged.packageId, staged.hash, 'unrelated-workflow-evaluation', true, 'Mock evidence must not authorize connector promotion'));
  await assert.rejects(repository.activateVersion(owner, staged.packageId, staged.hash, staged.revision));
  await assert.rejects(repository.candidateVersion(owner, staged.packageId, staged.hash));
  const changed = new PlatformRepository(pool, () => { throw new Error('Fixture adapter changed'); });
  assert.equal((await changed.connectorConformance(owner, staged.packageId, staged.hash)).adapterCurrent, false);
  const { PostgresRunRepository } = await import('../packages/db/dist/run-repository.js');
  const { PostgresIntegrationRepository, integrationDigest } = await import('../packages/db/dist/integration-repository.js');
  const { PostgresWorkspaceRepository } = await import('../packages/db/dist/workspace-repository.js');
  const runs = new PostgresRunRepository(pool), evidence = new PostgresIntegrationRepository(pool);
  for (const mode of ['simulation','live'] as const) {
    const definition = { id: `forged-${mode}`, version: '1', definitionHash: integrationDigest(['forged', mode]), steps: [{ id: 'step', kind: 'tool_effect', toolId: 'jira', toolAction: { action: 'create', resourceType: 'issue' }, outputKey: 'result' }] };
    const proof = { connectorId: 'jira', adapterHash: report.adapterHash!, requestHash: 'e'.repeat(64), inputHash: 'd'.repeat(64), connectionVersion: 1, secretVersion: '1', bindingHash: 'f'.repeat(64) };
    const snapshot = { id: `forged-${mode}`, tenantId, userId: owner.userId, persona: 'engineering', status: 'queued' as const, mode, definitionHash: definition.definitionHash, inputs: {}, outputs: {}, steps: [{ stepId: 'step', kind: 'tool_effect', outputKey: 'result', status: 'pending' as const, provenance: 'none' as const, actionProof: proof }] };
    await runs.submit(snapshot, definition, {});
    const claimed = (await runs.claim(tenantId, 'forged-observation-fixture'))!;
    await runs.checkpoint(claimed.lease, { ...claimed.snapshot, steps: [{ ...claimed.snapshot.steps[0]!, status: 'running' }] });
    await assert.rejects(evidence.recordObservation(owner, claimed.lease, 'step', { actionId: 'jira:create:issue', adapterHash: proof.adapterHash, requestHash: proof.requestHash, resultHash: 'a'.repeat(64), transport: 'native_transport' }));
    await runs.cancel(tenantId, snapshot.id, owner.userId);
  }
  await new PostgresWorkspaceRepository(pool).revokeConnection(owner, 'jira');
  assert.ok((await repository.connectorConformance(reviewer, staged.packageId, staged.hash)).actions.every(action => action.customTransport === 0 && action.nativeTransport === 0));
  console.log('PASS connector manifest identity, durable custom/native provenance, private evidence visibility, forged evidence denial and fail-closed marketplace gates');
}
