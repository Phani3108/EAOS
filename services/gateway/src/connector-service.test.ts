import { describe, expect, it } from 'vitest';
import * as connectors from './connector-service.js';
import { SLACK_MESSAGE_LIMIT, slackDisplayText } from './connector-contracts.js';
import type { ConnectionRecord, PostgresWorkspaceRepository } from '@agentos/db/workspace-repository';
import type { PostgresIntegrationRepository } from '@agentos/db/integration-repository';
import type { JsonRequest, JsonReply } from './outbound-http.js';

const owner = { tenantId: 'fixture-tenant', userId: 'fixture-owner' };
const lease = { tenantId: owner.tenantId, runId: 'fixture-run', workerId: 'fixture-worker', fencingToken: 1, attempt: 1 };
const configs = {
  github: { repositories: ['org/fixture'], actions: ['read:pull_request','comment:pull_request'] },
  jira: { endpoint: 'https://fixture.atlassian.net', projects: ['TEST'], actions: ['read:issue','create:issue'] },
  slack: { channels: ['C123'], actions: ['read:message','create:message'] },
};
const inputs = {
  'github:read:pull_request': { repository: 'org/fixture', number: 1 },
  'github:comment:pull_request': { repository: 'org/fixture', number: 1, body: 'Fixture comment' },
  'jira:read:issue': { key: 'TEST-42' },
  'jira:create:issue': { project: 'TEST', summary: 'Fixture issue', description: 'Fixture description' },
  'slack:read:message': { channel: 'C123', ts: '1700000000.001' },
  'slack:create:message': { channel: 'C123', text: 'Fixture message' },
};
async function fixture(id: keyof typeof configs, mutate: (request: JsonRequest, reply: JsonReply) => JsonReply = (_request, reply) => reply, credential?: () => string) {
  let connection: ConnectionRecord = { connectorId: id, status: 'configured', version: 1, secretRef: { provider: 'vault', path: 'fixture' }, config: configs[id] };
  let comment = '', postCount = 0;
  const requests: JsonRequest[] = [], observations: unknown[] = [];
  let receipt: { status: string; result?: Record<string, unknown> } | undefined;
  const workspace = {
    getConnection: async (actor: typeof owner) => actor.userId === owner.userId && actor.tenantId === owner.tenantId ? structuredClone(connection) : undefined,
    verifyConnection: async (_owner: unknown, _id: string, version: number, proof: object) => { if (version !== connection.version) return false; connection = { ...connection, ...proof, version: version + 1 }; return true; },
  } as unknown as PostgresWorkspaceRepository;
  const evidence = {
    assertLease: async () => {}, audit: async () => {},
    beginEffect: async () => { if (receipt?.status === 'completed') return receipt.result; if (receipt) throw new Error('Uncertain fixture effect'); receipt = { status: 'dispatching' }; },
    finishEffect: async (_owner: unknown, _lease: unknown, _step: unknown, status: string, result: Record<string, unknown>, observation?: unknown) => { receipt = { status, result }; if (observation) observations.push(observation); },
    recordObservation: async (...args: unknown[]) => { observations.push(args.at(-1)); },
  } as unknown as PostgresIntegrationRepository;
  const service = new connectors.ConnectorService(workspace, evidence, async () => ({ value: credential ? credential() : id === 'jira' ? JSON.stringify({ email: 'fixture@example.invalid', apiToken: 'fixture-token' }) : 'fixture-token', version: '1', backend: 'fixture' }), () => async request => {
    requests.push(request);
    const path = new URL(request.url).pathname;
    let data: unknown;
    if (path === '/user') data = { id: 17, login: 'fixture' };
    else if (path === '/repos/org/fixture') data = { id: 18, full_name: 'org/fixture' };
    else if (path === '/rest/api/3/myself') data = { accountId: 'fixture' };
    else if (path === '/rest/api/3/project/TEST') data = { id: '19', key: 'TEST' };
    else if (path === '/api/auth.test') data = { ok: true, user_id: 'U123', team_id: 'T123' };
    else if (path === '/api/conversations.info') data = { ok: true, channel: { id: 'C123', is_archived: false, is_member: true } };
    else if (request.method === 'POST') {
      postCount++;
      if (id === 'github') { comment = (request.body as { body: string }).body; data = { id: 41 }; }
      else if (id === 'jira') data = { id: '42', key: 'TEST-42' };
      else data = { ok: true, channel: 'C123', ts: '1700000000.001' };
    } else if (path.includes('/issues/comments/')) data = { id: 41, body: comment, issue_url: 'https://api.github.com/repos/org/fixture/issues/1' };
    else if (path.endsWith('/pulls/1')) data = { id: 101, number: 1, title: 'Fixture PR', body: null, head: { sha: 'a'.repeat(40) }, base: { sha: 'b'.repeat(40), repo: { full_name: 'org/fixture' } }, changed_files: 1 };
    else if (path.includes('/compare/')) data = { base_commit: { sha: 'b'.repeat(40) }, commits: [{ sha: 'a'.repeat(40) }], total_commits: 1, files: [{ filename: 'main.ts', status: 'modified', patch: '@@ -0,0 +1 @@\n+fixture', additions: 1, deletions: 0 }] };
    else if (path.endsWith('/files')) data = [{ filename: 'main.ts', status: 'modified', patch: '@@ -0,0 +1 @@\n+fixture', additions: 1, deletions: 0 }];
    else if (path.startsWith('/rest/api/3/issue/')) data = { id: '42', key: 'TEST-42', fields: { project: { key: 'TEST' }, summary: 'Fixture issue', issuetype: { name: 'Task' }, description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fixture description' }] }] } } };
    else if (path === '/api/conversations.history') data = { ok: true, messages: [{ ts: '1700000000.001', text: 'Fixture message' }] };
    else throw new Error('Unexpected fixture request');
    return mutate(request, { status: 200, data });
  }, 'fixture-binding');
  await service.probe(owner, id);
  const execute = async (key: keyof typeof inputs, signal = new AbortController().signal) => {
    const [connector, action, resource] = key.split(':') as [string, string, string];
    const proof = await service.prepare(owner, connector, action, resource, inputs[key]);
    return service.execute(owner, lease, 'step', action, resource, inputs[key], proof, signal);
  };
  return { service, execute, requests, observations, posts: () => postCount, connection: () => connection };
}

describe('native connector conformance', () => {
  it('seals unique same-connector manifests against current adapter contracts', () => {
    const manifest = connectors.compileConnectorManifest({ schemaVersion: 1, id: 'github', actions: ['github:read:pull_request'] });
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.adapterHash).toMatch(/^[a-f0-9]{64}$/);
    expect(connectors.compileConnectorManifest(manifest)).toEqual(manifest);
    expect(() => connectors.compileConnectorManifest({ ...manifest, adapterHash: '0'.repeat(64) })).toThrow();
    expect(() => connectors.compileConnectorManifest({ schemaVersion: 1, id: 'github', actions: ['slack:read:message'] })).toThrow();
    expect(() => connectors.compileConnectorManifest({ schemaVersion: 1, id: 'github', actions: ['github:read:pull_request','github:read:pull_request'] })).toThrow();
    expect(() => connectors.compileConnectorManifest({ schemaVersion: 1, id: 'unknown', actions: ['github:read:pull_request'] })).toThrow();
    expect(() => connectors.compileConnectorManifest({ ...manifest, certified: true })).toThrow();
  });
  it.each(Object.keys(inputs) as Array<keyof typeof inputs>)('validates %s and records custom-transport evidence', async key => {
    const context = await fixture(key.split(':')[0] as keyof typeof configs);
    expect(await context.execute(key)).toMatchObject({ verified: true });
    expect(context.observations).toHaveLength(1);
    expect(context.observations[0]).toMatchObject({ actionId: key, transport: 'custom_transport' });
  });
  it.each(['github','jira','slack'] as const)('rejects a mismatched %s resource probe', async id => {
    const context = await fixture(id, (request, reply) => request.url.includes('/repos/org/fixture') || request.url.includes('/project/TEST') || request.url.includes('/conversations.info') ? { status: 200, data: { id: 99, full_name: 'other/repo', key: 'OTHER', ok: true, channel: { id: 'C999' } } } : reply);
    expect(context.connection().status).not.toBe('verified');
  });
  it('binds PR evidence to the requested repository, number and immutable comparison', async () => {
    const wrong = await fixture('github', (request, reply) => request.url.endsWith('/pulls/1') ? { status: 200, data: { ...(reply.data as object), number: 2 } } : reply);
    await expect(wrong.execute('github:read:pull_request')).rejects.toThrow();
    const valid = await fixture('github');
    await valid.execute('github:read:pull_request');
    expect(valid.requests.some(request => request.url.includes(`/compare/${'b'.repeat(40)}...${'a'.repeat(40)}`))).toBe(true);
  });
  it('does not certify missing or truncated diff evidence', async () => {
    const context = await fixture('github', (request, reply) => request.url.includes('/compare/') ? { status: 200, data: { ...(reply.data as object), files: [{ filename: 'binary', status: 'modified' }] } } : reply);
    await expect(context.execute('github:read:pull_request')).rejects.toMatchObject({ outcome: 'unsupported' });
    expect(context.observations).toHaveLength(0);
  });
  it('does not confirm a comment read back from a different PR', async () => {
    const context = await fixture('github', (request, reply) => request.url.includes('/issues/comments/') ? { status: 200, data: { ...(reply.data as object), issue_url: 'https://api.github.com/repos/org/fixture/issues/2' } } : reply);
    await expect(context.execute('github:comment:pull_request')).rejects.toMatchObject({ outcome: 'inconclusive' });
    await expect(context.execute('github:comment:pull_request')).rejects.toThrow();
    expect(context.posts()).toBe(1);
  });
  it.each(['github:comment:pull_request','jira:create:issue','slack:create:message'] as const)('does not repeat an uncertain %s write', async key => {
    const context = await fixture(key.split(':')[0] as keyof typeof configs, (request, reply) => request.method === 'POST' ? { status: 503, data: {} } : reply);
    await expect(context.execute(key)).rejects.toMatchObject({ outcome: 'inconclusive' });
    await expect(context.execute(key)).rejects.toThrow();
    expect(context.posts()).toBe(1);
    expect(context.observations).toHaveLength(0);
  });
  it.each(Object.keys(inputs) as Array<keyof typeof inputs>)('rejects malformed and out-of-scope %s inputs before dispatch', async key => {
    const [id, action, resource] = key.split(':') as [keyof typeof configs, string, string];
    const context = await fixture(id);
    const before = context.requests.length;
    await expect(context.service.prepare(owner, id, action, resource, { ...inputs[key], unexpected: true })).rejects.toThrow();
    const outside = id === 'github' ? { repository: 'other/repository' } : id === 'slack' ? { channel: 'C999' } : action === 'read' ? { key: 'OTHER-1' } : { project: 'OTHER' };
    await expect(context.service.prepare(owner, id, action, resource, { ...inputs[key], ...outside })).rejects.toThrow();
    expect(context.requests).toHaveLength(before);
  });
  it.each(Object.keys(inputs) as Array<keyof typeof inputs>)('does not certify malformed %s responses', async key => {
    let responding = false;
    const context = await fixture(key.split(':')[0] as keyof typeof configs, (_request, reply) => responding ? { status: 200, data: {} } : reply);
    responding = true;
    await expect(context.execute(key)).rejects.toThrow();
    expect(context.observations).toHaveLength(0);
  });
  it.each([401,403,429])('never converts HTTP %s into a read success or a repeat write', async status => {
    for (const key of Object.keys(inputs) as Array<keyof typeof inputs>) {
      let responding = false;
      const context = await fixture(key.split(':')[0] as keyof typeof configs, (_request, reply) => responding ? { status, data: {} } : reply);
      responding = true;
      await expect(context.execute(key)).rejects.toMatchObject({ outcome: key.includes(':read:') ? 'failed' : 'inconclusive' });
      await expect(context.execute(key)).rejects.toThrow();
      expect(context.posts()).toBe(key.includes(':read:') ? 0 : 1);
      expect(context.observations).toHaveLength(0);
    }
  });
  it('redacts a credential decoding failure during the final dispatch check', async () => {
    let reads = 0;
    const context = await fixture('jira', undefined, () => ++reads === 4 ? 'PRIVATE_FIXTURE_CREDENTIAL' : JSON.stringify({ email: 'fixture@example.invalid', apiToken: 'fixture-token' }));
    await expect(context.execute('jira:create:issue')).rejects.toThrow('Credential could not be resolved before dispatch');
    expect(context.posts()).toBe(0);
  });
  it('rejects a stale adapter approval before a write', async () => {
    const context = await fixture('slack');
    const params = inputs['slack:create:message'];
    const proof = await context.service.prepare(owner, 'slack', 'create', 'message', params);
    await expect(context.service.execute(owner, lease, 'step', 'create', 'message', params, { ...proof, adapterHash: '0'.repeat(64) }, new AbortController().signal)).rejects.toThrow();
    expect(context.posts()).toBe(0);
  });
  it('does not replay a cancellation after write dispatch', async () => {
    const controller = new AbortController();
    const context = await fixture('slack', (request, reply) => { if (request.method === 'POST') { controller.abort(); throw new Error('Fixture dispatch interrupted'); } return reply; });
    await expect(context.execute('slack:create:message', controller.signal)).rejects.toMatchObject({ outcome: 'inconclusive' });
    await expect(context.execute('slack:create:message')).rejects.toThrow();
    expect(context.posts()).toBe(1);
    expect(context.observations).toHaveLength(0);
  });
  it('rejects pre-aborted work before any write', async () => {
    const context = await fixture('slack');
    await expect(context.execute('slack:create:message', AbortSignal.abort())).rejects.toThrow();
    expect(context.posts()).toBe(0);
    expect(context.observations).toHaveLength(0);
  });
});

describe('vendor normalisation in effect readback', () => {
  const run = (context: Awaited<ReturnType<typeof fixture>>, connector: string, action: string, resource: string, params: Record<string, unknown>) =>
    context.service.prepare(owner, connector, action, resource, params).then(proof => context.service.execute(owner, lease, 'step', action, resource, params, proof, new AbortController().signal));
  const slackHistory = (stored: string) => (request: JsonRequest, reply: JsonReply): JsonReply =>
    new URL(request.url).pathname === '/api/conversations.history' ? { status: 200, data: { ok: true, messages: [{ ts: '1700000000.001', text: stored }] } } : reply;
  const text = 'R&D -> <done> & shipped';

  it('decodes only the entities Slack decodes, in a single pass', () => {
    expect(slackDisplayText('R&amp;D -&gt; &lt;done&gt;')).toBe('R&D -> <done>');
    expect(slackDisplayText('&amp;lt; &quot;')).toBe('&lt; &quot;');
  });
  it('verifies a Slack message stored in its escaped form, posted with parse=none', async () => {
    const context = await fixture('slack', slackHistory('R&amp;D -&gt; &lt;done&gt; &amp; shipped'));
    expect(await run(context, 'slack', 'create', 'message', { channel: 'C123', text })).toMatchObject({ verified: true, text: 'R&amp;D -&gt; &lt;done&gt; &amp; shipped' });
    expect(context.requests.find(request => request.method === 'POST')?.body).toMatchObject({ channel: 'C123', text, parse: 'none' });
    expect(context.observations).toHaveLength(1);
  });
  it.each(['R&amp;D -&gt; done', `${text}!`, 'R&amp;amp;D -&gt; &lt;done&gt; &amp; shipped', '<https://example.invalid|R&D> -> <done> & shipped'])('does not confirm or replay a Slack message stored as %s', async stored => {
    const context = await fixture('slack', slackHistory(stored));
    await expect(run(context, 'slack', 'create', 'message', { channel: 'C123', text })).rejects.toMatchObject({ outcome: 'inconclusive' });
    await expect(run(context, 'slack', 'create', 'message', { channel: 'C123', text })).rejects.toThrow();
    expect(context.posts()).toBe(1);
    expect(context.observations).toHaveLength(0);
  });
  it('refuses Slack text that Slack would truncate before anything is sent', async () => {
    const context = await fixture('slack');
    const before = context.requests.length;
    await expect(context.service.prepare(owner, 'slack', 'create', 'message', { channel: 'C123', text: 'x'.repeat(SLACK_MESSAGE_LIMIT + 1) })).rejects.toThrow();
    // Under the limit as written, over it once Slack stores each '&' as '&amp;'.
    await expect(context.service.prepare(owner, 'slack', 'create', 'message', { channel: 'C123', text: '&'.repeat(SLACK_MESSAGE_LIMIT / 5 + 1) })).rejects.toThrow();
    await expect(context.service.prepare(owner, 'slack', 'create', 'message', { channel: 'C123', text: '&'.repeat(SLACK_MESSAGE_LIMIT / 5) })).resolves.toMatchObject({ connectorId: 'slack' });
    expect(context.requests).toHaveLength(before);
    expect(context.posts()).toBe(0);
  });
  const canonical = (issueUrl: string) => (request: JsonRequest, reply: JsonReply): JsonReply => {
    const path = new URL(request.url).pathname;
    if (path === '/repos/org/fixture') return { status: 200, data: { id: 18, full_name: 'Org/Fixture' } };
    if (path.includes('/issues/comments/')) return { status: 200, data: { ...(reply.data as object), issue_url: issueUrl } };
    return reply;
  };
  it('verifies a comment that GitHub reports under the canonical repository casing', async () => {
    const context = await fixture('github', canonical('https://api.github.com/repos/Org/Fixture/issues/1'));
    expect(context.connection().status).toBe('verified');
    expect(await context.execute('github:comment:pull_request')).toMatchObject({ verified: true, repository: 'org/fixture' });
    expect(context.observations).toHaveLength(1);
  });
  it.each([
    'https://api.github.com/repos/Org/Fixtures/issues/1',
    'https://api.github.com/repos/Org/Fixture/issues/12',
    'https://api.github.com/repos/Org/Fixture/pulls/1',
    'https://api.github.com/repos/Org/Fixture/x/issues/1',
    'https://api.github.com/repos/org/fıxture/issues/1',
    'https://other.example/repos/org/fixture/issues/1',
  ])('does not confirm or replay a comment GitHub reports on %s', async issueUrl => {
    const context = await fixture('github', canonical(issueUrl));
    await expect(context.execute('github:comment:pull_request')).rejects.toMatchObject({ outcome: 'inconclusive' });
    await expect(context.execute('github:comment:pull_request')).rejects.toThrow();
    expect(context.posts()).toBe(1);
  });
});
