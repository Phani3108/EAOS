import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { RuntimePool, PostgresRunRepository, RuntimeSnapshot } from '../packages/db/dist/run-repository.js';

export async function verifyIntegrationEvidence(pool: RuntimePool, runs: PostgresRunRepository, tenantId: string, foreignTenant: string) {
  const { PostgresWorkspaceRepository } = await import('../packages/db/dist/workspace-repository.js');
  const { PostgresIntegrationRepository, integrationDigest } = await import('../packages/db/dist/integration-repository.js');
  const { ConnectorService, publicConnection } = await import('../services/gateway/dist/connector-service.js');
  const { extractArtifact, resolveArtifactContext } = await import('../services/gateway/dist/artifact-ingestion.js');
  const workspace = new PostgresWorkspaceRepository(pool), evidence = new PostgresIntegrationRepository(pool);
  const owner = { tenantId, userId: `user-${tenantId}` }, stranger = { tenantId: foreignTenant, userId: `user-${foreignTenant}` };
  let version = '1', writes = 0, corrupt = false;
  const secrets = new Map([['github','fixture-github-token'],['jira',JSON.stringify({ email: 'fixture@example.invalid', apiToken: 'fixture-jira-token' })],['slack','fixture-slack-token']]);
  let comment = '', message = '', issue: any;
  const service = new ConnectorService(workspace, evidence, async (context, ref) => {
    assert.equal(context.tenantId, tenantId);
    assert.ok(ref.path.startsWith(`${owner.tenantId}/${owner.userId}/`));
    return { value: secrets.get(ref.path.split('/').at(-1)!)!, version, backend: 'fixture-vault' };
  }, () => async request => {
    const url = new URL(request.url);
    if (url.pathname === '/user') return { status: 200, data: { id: 17, login: 'fixture' } };
    if (url.pathname === '/rest/api/3/myself') return { status: 200, data: { accountId: 'fixture' } };
    if (url.pathname === '/api/auth.test') return { status: 200, data: { ok: true, user_id: 'U123', team_id: 'T123' } };
    if (url.pathname === '/repos/org/fixture') return { status: 200, data: { id: 18, full_name: 'org/fixture' } };
    if (url.pathname.startsWith('/rest/api/3/project/')) return { status: 200, data: { id: '19', key: 'TEST' } };
    if (url.pathname === '/api/conversations.info') return { status: 200, data: { ok: true, channel: { id: 'C123', is_archived: false, is_member: true } } };
    if (url.pathname.endsWith('/pulls/1')) return { status: 200, data: { id: 20, number: 1, title: 'Fixture PR', head: { sha: 'a'.repeat(40) }, base: { sha: 'b'.repeat(40), repo: { full_name: 'org/fixture' } }, changed_files: 1 } };
    if (url.pathname.includes('/compare/')) return { status: 200, data: { base_commit: { sha: 'b'.repeat(40) }, total_commits: 1, commits: [{ sha: 'a'.repeat(40) }], files: [{ filename: 'fixture.ts', patch: '@@ -0,0 +1 @@\n+fixture', status: 'added', additions: 1, deletions: 0 }] } };
    if (request.method === 'POST') {
      writes++;
      const body = request.body as any;
      if (url.pathname.includes('/comments')) { comment = body.body; return { status: 201, data: { id: 41 } }; }
      if (url.pathname === '/rest/api/3/issue') { issue = body.fields; return { status: 201, data: { id: '42', key: 'TEST-42' } }; }
      if (url.pathname === '/api/chat.postMessage') { message = body.text; return { status: 200, data: { ok: true, channel: 'C123', ts: '1700000000.001' } }; }
    }
    if (url.pathname.includes('/issues/comments/')) return { status: 200, data: { id: 41, body: corrupt ? 'wrong body' : comment, issue_url: 'https://api.github.com/repos/org/fixture/issues/1' } };
    if (url.pathname.startsWith('/rest/api/3/issue/')) return { status: 200, data: { id: '42', key: 'TEST-42', fields: issue } };
    if (url.pathname === '/api/conversations.history') return { status: 200, data: { ok: true, messages: [{ ts: '1700000000.001', text: message }] } };
    throw new Error('Unexpected fixture transport request');
  }, 'fixture-binding-key');
  for (const [connector, config] of Object.entries({ github: { repositories: ['org/fixture'], actions: ['read:pull_request','comment:pull_request'] }, jira: { endpoint: 'https://fixture.atlassian.net', projects: ['TEST'], actions: ['read:issue','create:issue'] }, slack: { channels: ['C123'], actions: ['read:message','create:message'] } })) {
    await workspace.saveConnection(owner, connector, { provider: 'vault', path: `${tenantId}/${owner.userId}/${connector}`, key: 'token' }, config);
    assert.equal((await service.probe(owner, connector)).status, 'verified');
    assert.equal(await workspace.getConnection(stranger, connector), undefined);
    assert.equal(JSON.stringify(publicConnection((await workspace.getConnection(owner, connector))!)).includes('fixture-github-token'), false);
  }
  const execute = async (connector: string, action: string, resource: string, params: Record<string, unknown>, inconclusive = false) => {
    const proof = await service.prepare(owner, connector, action, resource, params);
    const kind = action === 'read' ? 'tool_read' : 'tool_effect';
    const definition = { id: 'fixture-effect', version: '1', definitionHash: integrationDigest([connector, action, resource]), steps: [{ id: 'step', kind, toolId: connector, toolAction: { action, resourceType: resource }, outputKey: 'result' }] };
    const initial: RuntimeSnapshot = { ...owner, id: randomUUID(), persona: 'engineering', status: 'queued', mode: 'live', definitionHash: definition.definitionHash, inputs: {}, outputs: {}, steps: [{ stepId: 'step', agent: 'code-reviewer', kind, status: 'pending', outputKey: 'result', provenance: 'none' }] };
    await runs.submit(initial, definition, {});
    const claimed = (await runs.claim(tenantId, 'fixture-effect-prepare'))!;
    await runs.park(claimed.lease, { ...claimed.snapshot, steps: [{ ...claimed.snapshot.steps[0]!, status: 'approval_required', actionProof: proof, actionInput: params }] });
    await runs.decide(tenantId, initial.id, 'step', owner.userId, true);
    const resumed = (await runs.claim(tenantId, 'fixture-effect-dispatch'))!;
    const active = { ...resumed.snapshot, steps: [{ ...resumed.snapshot.steps[0]!, status: 'running' }] };
    await runs.checkpoint(resumed.lease, active);
    const before = writes;
    if (inconclusive) {
      await assert.rejects(service.execute(owner, resumed.lease, 'step', action, resource, params, proof, new AbortController().signal));
      await assert.rejects(service.execute(owner, resumed.lease, 'step', action, resource, params, proof, new AbortController().signal));
      assert.equal(writes, before + (action === 'read' ? 0 : 1));
      assert.equal((await evidence.receipt(owner, initial.id, 'step'))?.status, 'inconclusive');
      await runs.checkpoint(resumed.lease, { ...active, status: 'inconclusive', steps: [{ ...active.steps[0]!, status: 'inconclusive' }] });
    } else {
      const result = await service.execute(owner, resumed.lease, 'step', action, resource, params, proof, new AbortController().signal);
      assert.deepEqual(await service.execute(owner, resumed.lease, 'step', action, resource, params, proof, new AbortController().signal), result);
      assert.equal(writes, before + (action === 'read' ? 0 : 1));
      assert.equal(await evidence.receipt(stranger, initial.id, 'step'), undefined);
      await runs.checkpoint(resumed.lease, { ...active, status: 'completed', outputs: { result: JSON.stringify(result) }, steps: [{ ...active.steps[0]!, status: 'completed', provenance: 'live' }] });
    }
  };
  await assert.rejects(service.prepare(owner, 'github', 'comment', 'pull_request', { repository: 'other/repo', number: 1, body: 'fixture' }));
  await execute('github', 'comment', 'pull_request', { repository: 'org/fixture', number: 1, body: 'Fixture approved comment' });
  await execute('jira', 'create', 'issue', { project: 'TEST', summary: 'Fixture issue', description: 'Fixture description' });
  await execute('slack', 'create', 'message', { channel: 'C123', text: 'Fixture message' });
  await execute('github', 'read', 'pull_request', { repository: 'org/fixture', number: 1 });
  await execute('jira', 'read', 'issue', { key: 'TEST-42' });
  await execute('slack', 'read', 'message', { channel: 'C123', ts: '1700000000.001' });
  corrupt = true;
  await execute('github', 'comment', 'pull_request', { repository: 'org/fixture', number: 1, body: 'Unconfirmed fixture comment' }, true);
  const before = writes;
  version = '2';
  await assert.rejects(service.prepare(owner, 'github', 'comment', 'pull_request', { repository: 'org/fixture', number: 1, body: 'Fixture' }));
  assert.equal((await workspace.getConnection(owner, 'github'))?.status, 'expired');
  assert.equal(writes, before);
  const artifact = await evidence.putArtifact(owner, extractArtifact('brief.txt', 'text/plain', Buffer.from('Fixture evidence content')));
  assert.equal(await evidence.getArtifact(stranger, artifact.id), undefined);
  assert.equal((await resolveArtifactContext(evidence, owner, { source: { artifactId: artifact.id } }))[artifact.id]?.text, 'Fixture evidence content');
  await assert.rejects(resolveArtifactContext(evidence, stranger, { source: { artifactId: artifact.id } }));
  assert.equal(await evidence.archiveArtifact(owner, artifact.id), true);
  await assert.rejects(resolveArtifactContext(evidence, owner, { source: { artifactId: artifact.id } }));
  corrupt = false;
  await service.probe(owner, 'github');
  const { compileDefinition } = await import('../services/gateway/dist/definition-registry.js');
  const runtime = await import('../services/gateway/dist/persona-api.js');
  runtime.configureRuntimeRepository(runs);
  runtime.configureIntegrationRuntime(evidence, service);
  try {
    const definition = compileDefinition({ id: 'm4-runtime-comment', slug: 'm4-runtime-comment', name: 'Fixture comment', description: '', icon: '', persona: 'engineering', executableType: 'workflow', cluster: 'Fixture', complexity: 'simple', estimatedTime: '', inputs: [], outputs: ['result'], requiredTools: ['github'], optionalTools: [], tags: [], steps: [{ id: 'comment', order: 1, name: 'Publish fixture review', agent: 'code-reviewer', tool: 'github', kind: 'tool_effect', outputKey: 'result', requiresApproval: true, toolAction: { action: 'comment', resourceType: 'pull_request', inputBindings: { repository: 'inputs.repository', number: 'inputs.number', body: 'inputs.body' } } }] });
    const prepared = runtime.preparePersonaExecution(tenantId, 'engineering', definition, { repository: 'org/fixture', number: 1, body: 'Runtime bound fixture comment' }, owner.userId, false);
    await runs.submit(prepared.exec as unknown as RuntimeSnapshot, { ...definition }, prepared.payload);
    const first = (await runs.claim(tenantId, 'm4-runtime-first'))!;
    await runtime.runDurableExecution(first, new AbortController().signal);
    assert.equal((await runs.get(tenantId, prepared.exec.id))?.status, 'paused');
    const priorWrites = writes;
    await runs.decide(tenantId, prepared.exec.id, 'comment', owner.userId, true);
    const resumed = (await runs.claim(tenantId, 'm4-runtime-approved'))!;
    await runtime.runDurableExecution(resumed, new AbortController().signal);
    const result = await runs.get(tenantId, prepared.exec.id);
    assert.equal(result?.status, 'completed');
    assert.equal(writes, priorWrites + 1);
    assert.equal(JSON.parse(result!.outputs.result!).body, 'Runtime bound fixture comment');
    const { PlatformRepository } = await import('../packages/db/dist/platform-repository.js');
    const { platformRequest } = await import('../services/gateway/dist/platform-api.js');
    const platform = new PlatformRepository(pool);
    const channel = await workspace.putRecord(owner, 'notification_channel', randomUUID(), { name: 'Fixture delivery', channel: 'slack', enabled: true, config: { connectionId: 'slack', destination: 'C123' } }, 0);
    await service.probe(owner, 'slack');
    const principal = { id: owner.userId, tenantId, name: 'Fixture', email: 'fixture@example.invalid', role: 'admin' as const, teams: [], personaScopes: ['*' as const] };
    const notificationInput = { channelId: channel.id, sourceRunId: prepared.exec.id, deliveryKey: 'fixture-delivery', simulate: false };
    const accepted = await platformRequest(platform, runs, principal, new URL('http://localhost/api/operations/notifications'), 'POST', async () => notificationInput, () => {});
    assert.equal(accepted.status, 201);
    const notificationId = (accepted.data as { execution: { id: string } }).execution.id;
    const queued = (await runs.claim(tenantId, 'notification-prepare'))!;
    await runtime.runDurableExecution(queued, new AbortController().signal);
    assert.equal((await runs.get(tenantId, notificationId))?.status, 'paused');
    await runs.decide(tenantId, notificationId, 'deliver', owner.userId, true);
    await runtime.runDurableExecution((await runs.claim(tenantId, 'notification-delivery'))!, new AbortController().signal);
    const deliveries = await platform.notifications({ ...owner, role: 'admin', personaScopes: ['*'] });
    assert.equal(deliveries.find(row => row.executionId === notificationId)?.status, 'delivered');
    const repeated = await platformRequest(platform, runs, principal, new URL('http://localhost/api/operations/notifications'), 'POST', async () => notificationInput, () => {});
    assert.equal((repeated.data as { execution: { id: string } }).execution.id, notificationId);
  } finally { runtime.configureIntegrationRuntime(undefined, undefined); runtime.configureRuntimeRepository(undefined); }
  console.log('PASS scoped secret binding, connection verification, GitHub/Jira/Slack readback, no duplicate writes, rotation invalidation, artifact ACLs and canonical approved action dispatch');
}
