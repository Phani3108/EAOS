import { z } from 'zod';
import { createHmac } from 'node:crypto';
import { VaultKV2, type SecretReference } from '@agentos/secrets';
import { integrationDigest, type ActionProof, type PostgresIntegrationRepository } from '@agentos/db/integration-repository';
import type { PostgresWorkspaceRepository, WorkspaceOwner, ConnectionRecord } from '@agentos/db/workspace-repository';
import type { RuntimeLease } from '@agentos/db/run-repository';
import { createJsonTransport, type JsonTransport } from './outbound-http.js';
import { actionSchemas, outputSchemas, repositoryName, connectorContract, slackDisplayText, SUPPORTED_CONNECTOR_ACTIONS } from './connector-contracts.js';
export { connectorContract, compileConnectorManifest, SUPPORTED_CONNECTOR_ACTIONS } from './connector-contracts.js';

export class ConnectorError extends Error {
  constructor(readonly outcome: 'unsupported' | 'failed' | 'inconclusive', message: string) { super(message); }
}
const nativeTransportFactory = (origin: string) => createJsonTransport([origin]);
/** GitHub resolves owner/repo case-insensitively and answers with the canonical casing. Names are ASCII, so only ASCII case is folded. */
const sameRepository = (actual: unknown, expected: string) => typeof actual === 'string' && actual.replace(/[A-Z]/g, char => char.toLowerCase()) === expected.replace(/[A-Z]/g, char => char.toLowerCase());
export function validateConnectionConfig(connector: string, input: unknown): Record<string, unknown> {
  const actions = z.array(z.string().refine(action => SUPPORTED_CONNECTOR_ACTIONS.includes(`${connector}:${action}`), 'Unsupported connector action')).min(1).max(10);
  if (connector === 'github') return z.object({ repositories: z.array(repositoryName).min(1).max(20), actions: actions.default(['read:pull_request']) }).strict().parse(input);
  if (connector === 'jira') return z.object({ endpoint: z.string().url().refine(value => { const url = new URL(value); return url.protocol === 'https:' && /^[a-zA-Z0-9-]+\.atlassian\.net$/.test(url.hostname) && !url.port && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash; }), projects: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).min(1).max(20), actions: actions.default(['read:issue']) }).strict().parse(input);
  if (connector === 'slack') return z.object({ channels: z.array(z.string().regex(/^[CG][A-Z0-9]{2,40}$/)).min(1).max(20), actions: actions.default(['read:message']) }).strict().parse(input);
  throw new ConnectorError('unsupported', 'Connector has no conforming action adapter');
}
export function publicConnection(value: ConnectionRecord) { const { bindingHash: ignored, ...safe } = value; return safe; }
export interface ResolvedCredential { value: string; version: string; backend: string }
export type CredentialResolver = (owner: WorkspaceOwner, ref: SecretReference) => Promise<ResolvedCredential>;
export function vaultResolver(repository: PostgresIntegrationRepository): CredentialResolver {
  return async (owner, ref) => {
    const address = process.env.VAULT_ADDR;
    if (!address || !process.env.VAULT_TOKEN) throw new Error('Vault is not configured');
    const origin = new URL(address).origin;
    const transport = createJsonTransport([origin], origin);
    const mount = process.env.VAULT_KV_MOUNT || 'secret';
    const vault = new VaultKV2({ ...owner, address, mount, token: async () => process.env.VAULT_TOKEN ?? '', request: async request => {
      const response = await transport(request);
      if (response.status !== 200) throw new Error('Vault request was not authorized');
      return response.data;
    }, onAudit: async entry => repository.audit(owner, `secret.${entry.action}`, entry.path, entry.success) });
    const secret = await vault.get(ref);
    return { value: secret.value, version: secret.version, backend: `${origin}/v1/${mount}` };
  };
}
export class ConnectorService {
  constructor(private readonly connections: PostgresWorkspaceRepository, private readonly evidence: PostgresIntegrationRepository, private readonly resolve: CredentialResolver, private readonly transportFactory: (origin: string) => JsonTransport = nativeTransportFactory, private readonly bindingKey = process.env.API_KEY_HASH_SECRET || process.env.JWT_SECRET || process.env.AUTH_SECRET) {}
  private origin(connector: string, config: Record<string, unknown>): string { return connector === 'github' ? 'https://api.github.com' : connector === 'slack' ? 'https://slack.com' : new URL(String(config.endpoint)).origin; }
  private headers(connector: string, credential: string): Record<string, string> {
    const token = z.string().regex(/^[\x21-\x7e]{1,4096}$/);
    if (connector === 'jira') {
      const parsed = z.object({ email: z.string().email(), apiToken: token }).strict().parse(JSON.parse(credential));
      return { Authorization: `Basic ${Buffer.from(`${parsed.email}:${parsed.apiToken}`).toString('base64')}` };
    }
    return { Authorization: `Bearer ${token.parse(credential)}`, ...(connector === 'github' ? { 'User-Agent': 'EAOS', 'X-GitHub-Api-Version': '2022-11-28' } : {}) };
  }
  private async credentials(owner: WorkspaceOwner, connection: ConnectionRecord) {
    const ref = connection.secretRef as SecretReference;
    const secret = await this.resolve(owner, ref);
    if (!this.bindingKey) throw new Error('Credential binding key is not configured');
    const bindingHash = createHmac('sha256', this.bindingKey).update(integrationDigest({ backend: secret.backend, ref: { ...ref, version: secret.version }, value: secret.value })).digest('hex');
    return { ...secret, bindingHash, headers: this.headers(connection.connectorId, secret.value) };
  }
  async probe(owner: WorkspaceOwner, connectorId: string): Promise<ConnectionRecord> {
    const connection = await this.connections.getConnection(owner, connectorId);
    if (!connection || connection.status === 'revoked') throw new ConnectorError('failed', 'Connection is unavailable');
    let status: 'verified' | 'expired' | 'unsupported' | 'unavailable' = 'unavailable';
    let account: Record<string, unknown> | undefined;
    let secretVersion: string | undefined;
    let bindingHash: string | undefined;
    try {
      const config = validateConnectionConfig(connectorId, connection.config ?? {});
      const credential = await this.credentials(owner, connection);
      const origin = this.origin(connectorId, config);
      const transport = this.transportFactory(origin);
      const signal = AbortSignal.timeout(30_000);
      const path = connectorId === 'github' ? '/user' : connectorId === 'jira' ? '/rest/api/3/myself' : '/api/auth.test';
      const response = await transport({ url: origin + path, method: 'GET', headers: credential.headers, signal });
      if (response.status === 401 || response.status === 403) { status = 'expired'; throw new Error('Authentication failed'); }
      if (response.status !== 200) throw new Error('Identity probe failed');
      const data = response.data as Record<string, unknown>;
      if (connectorId === 'github') account = { id: z.number().int().positive().parse(data.id), login: z.string().parse(data.login) };
      else if (connectorId === 'jira') account = { id: z.string().min(1).parse(data.accountId) };
      else { if (data.ok !== true) { status = 'expired'; throw new Error('Slack authentication failed'); } account = { id: z.string().min(1).parse(data.user_id), teamId: z.string().min(1).parse(data.team_id) }; }
      const resources = (config.repositories ?? config.projects ?? config.channels) as string[];
      for (const resource of resources) {
        const target = connectorId === 'github' ? `/repos/${resource.split('/').map(encodeURIComponent).join('/')}` : connectorId === 'jira' ? `/rest/api/3/project/${encodeURIComponent(resource)}` : `/api/conversations.info?channel=${encodeURIComponent(resource)}`;
        const result = await transport({ url: origin + target, method: 'GET', headers: credential.headers, signal });
        if (result.status !== 200) throw new Error('Resource scope was not verified');
        const data = result.data as Record<string, any>;
        if (connectorId === 'github' && !sameRepository(data.full_name, resource) || connectorId === 'jira' && data.key !== resource || connectorId === 'slack' && (data.ok !== true || data.channel?.id !== resource || data.channel.is_archived !== false || data.channel.is_member !== true)) throw new Error('Resource identity/access differs from the configured scope');
      }
      secretVersion = credential.version; bindingHash = credential.bindingHash; status = 'verified';
    } catch (error) { if (error instanceof ConnectorError && error.outcome === 'unsupported') status = 'unsupported'; }
    if (!await this.connections.verifyConnection(owner, connectorId, connection.version, { status, account, secretVersion, bindingHash })) throw new ConnectorError('failed', 'Connection changed during verification');
    await this.evidence.audit(owner, 'connection.probe', connectorId, status === 'verified');
    return publicConnection((await this.connections.getConnection(owner, connectorId))!);
  }
  private parameters(connection: ConnectionRecord, action: string, resource: string, input: Record<string, unknown>) {
    const id = `${connection.connectorId}:${action}:${resource}`;
    const schema = actionSchemas[id as keyof typeof actionSchemas];
    if (!schema) throw new ConnectorError('unsupported', 'No conforming action/input schema exists');
    const config = validateConnectionConfig(connection.connectorId, connection.config ?? {});
    if (!(config.actions as string[]).includes(`${action}:${resource}`)) throw new ConnectorError('failed', 'Connection does not authorize this action');
    const params = schema.parse(input) as Record<string, unknown>;
    const allowed = connection.connectorId === 'github' ? (config.repositories as string[]).includes(String(params.repository)) : connection.connectorId === 'jira' ? (config.projects as string[]).includes(String(params.project ?? String(params.key).split('-')[0])) && (!params.parent || (config.projects as string[]).includes(String(params.parent).split('-')[0]!)) : (config.channels as string[]).includes(String(params.channel));
    if (!allowed) throw new ConnectorError('failed', 'Action resource is outside the connection scope');
    return { params, config };
  }
  async prepare(owner: WorkspaceOwner, connectorId: string, action: string, resource: string, input: Record<string, unknown>): Promise<ActionProof> {
    if (!SUPPORTED_CONNECTOR_ACTIONS.includes(`${connectorId}:${action}:${resource}`)) throw new ConnectorError('unsupported', 'No conforming action/input schema exists');
    const connection = await this.connections.getConnection(owner, connectorId);
    if (!connection || connection.status !== 'verified') throw new ConnectorError('failed', 'A verified owner-scoped connection is required');
    const { params } = this.parameters(connection, action, resource, input);
    let credential;
    try { credential = await this.credentials(owner, connection); } catch { throw new ConnectorError('failed', 'Credential could not be resolved'); }
    if (credential.version !== connection.secretVersion || credential.bindingHash !== connection.bindingHash) {
      await this.connections.verifyConnection(owner, connectorId, connection.version, { status: 'expired' });
      throw new ConnectorError('failed', 'Credential changed; verify the connection and obtain a new approval');
    }
    const { adapterHash } = connectorContract(connectorId);
    return { connectorId, adapterHash, connectionVersion: connection.version, secretVersion: credential.version, bindingHash: credential.bindingHash, inputHash: integrationDigest({ connectorId, action, resource, input }), requestHash: integrationDigest({ connectorId, action, resource, params, adapterHash, connectionVersion: connection.version, bindingHash: credential.bindingHash }) };
  }
  async execute(owner: WorkspaceOwner, lease: RuntimeLease, stepId: string, action: string, resource: string, input: Record<string, unknown>, approved: ActionProof, signal: AbortSignal): Promise<Record<string, unknown>> {
    signal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
    signal.throwIfAborted();
    await this.evidence.assertLease(owner, lease);
    const proof = await this.prepare(owner, approved.connectorId, action, resource, input);
    if (integrationDigest(proof) !== integrationDigest(approved)) throw new ConnectorError('inconclusive', 'Approved action or connection changed');
    const connection = await this.connections.getConnection(owner, proof.connectorId);
    if (!connection || connection.status !== 'verified' || connection.version !== proof.connectionVersion || connection.bindingHash !== proof.bindingHash || connection.secretVersion !== proof.secretVersion) throw new ConnectorError('inconclusive', 'Connection changed before dispatch');
    const { config, params } = this.parameters(connection, action, resource, input);
    let credential;
    try { credential = await this.credentials(owner, connection); } catch { throw new ConnectorError('failed', 'Credential could not be resolved before dispatch'); }
    if (credential.bindingHash !== proof.bindingHash) throw new ConnectorError('inconclusive', 'Credential changed before dispatch');
    signal.throwIfAborted();
    const effect = !['read','search','list','fetch_metadata'].includes(action);
    if (effect) {
      try { const previous = await this.evidence.beginEffect(owner, lease, stepId, proof); if (previous) return previous; }
      catch { throw new ConnectorError('inconclusive', 'Effect was not admitted or requires reconciliation'); }
    }
    const origin = this.origin(connection.connectorId, config);
    const send = async (path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<Record<string, any>> => {
      signal.throwIfAborted();
      const reply = await this.transportFactory(origin)({ url: origin + path, method, headers: credential.headers, body, signal });
      if (reply.status < 200 || reply.status >= 300 || connection.connectorId === 'slack' && (reply.data as { ok?: boolean })?.ok !== true) throw new Error('Connector response did not confirm success');
      return reply.data as Record<string, any>;
    };
    try {
      let result: Record<string, unknown>;
      if (connection.connectorId === 'github') {
        const repo = String(params.repository).split('/').map(encodeURIComponent).join('/');
        if (action === 'read') {
          const pr = await send(`/repos/${repo}/pulls/${params.number}`);
          const sha = z.string().regex(/^[a-f0-9]{40}$/);
          const headSha = sha.parse(pr.head?.sha), baseSha = sha.parse(pr.base?.sha);
          if (pr.number !== params.number || !sameRepository(pr.base?.repo?.full_name, String(params.repository))) throw new Error('PR identity mismatch');
          const changedFiles = z.number().int().nonnegative().parse(pr.changed_files);
          if (changedFiles > 100) throw new ConnectorError('unsupported', 'PR exceeds the complete text-diff bound');
          const comparison = await send(`/repos/${repo}/compare/${baseSha}...${headSha}?per_page=100`);
          if (comparison.base_commit?.sha !== baseSha || comparison.commits?.at(-1)?.sha !== headSha || comparison.total_commits !== comparison.commits?.length) throw new ConnectorError('unsupported', 'Pinned comparison is incomplete');
          if (!Array.isArray(comparison.files) || comparison.files.length !== changedFiles || comparison.files.some((file: Record<string, unknown>) => typeof file.patch !== 'string')) throw new ConnectorError('unsupported', 'Complete text patches are required');
          for (const file of comparison.files) {
            const lines = file.patch.split('\n') as string[];
            if (!Number.isSafeInteger(file.additions) || !Number.isSafeInteger(file.deletions) || lines.filter(line => line.startsWith('+')).length !== file.additions || lines.filter(line => line.startsWith('-')).length !== file.deletions) throw new ConnectorError('unsupported', 'Patch line counts do not prove complete text evidence');
          }
          const files = z.array(z.object({ filename: z.string(), patch: z.string(), status: z.string() })).max(100).parse(comparison.files);
          result = { id: z.number().int().positive().parse(pr.id), number: params.number, repository: params.repository, title: z.string().parse(pr.title), body: typeof pr.body === 'string' ? pr.body : '', headSha, baseSha, files, potentiallyTruncated: false, verified: true };
        } else {
          const body = `${params.body}\n\n<!-- eaos:${proof.requestHash} -->`;
          const created = await send(`/repos/${repo}/issues/${params.number}/comments`, 'POST', { body });
          const id = z.number().int().positive().parse(created.id);
          const verified = await send(`/repos/${repo}/issues/comments/${id}`);
          // The comment must sit on the requested issue. GitHub reports it under the repository's
          // canonical casing, so only the owner/repo part may differ from the request, and only in case.
          const issuePrefix = `${origin}/repos/`, issueSuffix = `/issues/${params.number}`;
          const issueUrl = typeof verified.issue_url === 'string' ? verified.issue_url : '';
          const onIssue = issueUrl.startsWith(issuePrefix) && issueUrl.endsWith(issueSuffix) && sameRepository(issueUrl.slice(issuePrefix.length, -issueSuffix.length), repo);
          if (verified.id !== id || verified.body !== body || !onIssue) throw new Error('Comment postcondition failed');
          result = { id, repository: params.repository, number: params.number, body: params.body, verified: true };
        }
      } else if (connection.connectorId === 'jira') {
        let key = String(params.key ?? '');
        if (action === 'create') {
          const created = await send('/rest/api/3/issue', 'POST', { fields: { project: { key: params.project }, summary: params.summary, description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: params.description }] }] }, issuetype: { name: params.issueType }, ...(params.parent ? { parent: { key: params.parent } } : {}) } });
          key = z.string().regex(/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/).parse(created.key);
          if (!key.startsWith(`${params.project}-`)) throw new Error('Issue project mismatch');
        }
        const issue = await send(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,description,parent,issuetype,project`);
        const descriptionText = (node: unknown, depth = 0): string => depth > 20 ? '' : node && typeof node === 'object' && typeof (node as { text?: unknown }).text === 'string' ? (node as { text: string }).text : node && typeof node === 'object' ? Object.values(node).filter(value => value && typeof value === 'object').map(value => descriptionText(value, depth + 1)).join('') : '';
        if (issue.key !== key || issue.fields?.project?.key !== key.split('-')[0] || action === 'create' && (issue.fields?.summary !== params.summary || descriptionText(issue.fields?.description) !== params.description || issue.fields?.issuetype?.name !== params.issueType || (issue.fields?.parent?.key ?? null) !== (params.parent ?? null))) throw new Error('Issue postcondition failed');
        result = { id: z.string().min(1).parse(issue.id), key, summary: z.string().parse(issue.fields?.summary), description: issue.fields?.description ?? null, parent: issue.fields?.parent?.key ?? null, verified: true };
      } else {
        let ts = String(params.ts ?? '');
        if (action === 'create') {
          // parse=none: by default Slack rewrites bare URLs into <url> link markup in the stored
          // text. The approved text is posted as-is, so the readback can be checked against it.
          const created = await send('/api/chat.postMessage', 'POST', { channel: params.channel, text: params.text, parse: 'none', client_msg_id: `${proof.requestHash.slice(0,8)}-${proof.requestHash.slice(8,12)}-4${proof.requestHash.slice(13,16)}-8${proof.requestHash.slice(17,20)}-${proof.requestHash.slice(20,32)}` });
          ts = z.string().regex(/^\d{10,}\.\d+$/).parse(created.ts);
          if (created.channel !== params.channel) throw new Error('Channel mismatch');
        }
        const history = await send(`/api/conversations.history?channel=${encodeURIComponent(String(params.channel))}&oldest=${encodeURIComponent(ts)}&latest=${encodeURIComponent(ts)}&inclusive=true&limit=1`);
        const message = Array.isArray(history.messages) && history.messages.length === 1 && history.messages[0]?.ts === ts ? history.messages[0] : undefined;
        // Slack stores & < > as entities, so the readback is compared in display form: escaping
        // passes, any other change of content does not. Truncation never reaches here — the
        // input schema refuses any text Slack would cut short.
        if (!message || action === 'create' && (typeof message.text !== 'string' || slackDisplayText(message.text) !== slackDisplayText(String(params.text)))) throw new Error('Message postcondition failed');
        result = { channel: params.channel, ts, text: z.string().parse(message.text), verified: true };
      }
      const actionId = `${connection.connectorId}:${action}:${resource}` as keyof typeof outputSchemas;
      result = outputSchemas[actionId].parse(result);
      if (JSON.stringify(result).length > 128_000) throw new ConnectorError('unsupported', 'Connector evidence exceeds the output bound');
      const observation = { actionId, adapterHash: proof.adapterHash!, requestHash: proof.requestHash, resultHash: integrationDigest(result), transport: this.transportFactory === nativeTransportFactory ? 'native_transport' as const : 'custom_transport' as const };
      if (effect) await this.evidence.finishEffect(owner, lease, stepId, 'completed', result, observation);
      else { await this.evidence.recordObservation(owner, lease, stepId, observation); await this.evidence.audit(owner, 'connector.read', actionId, true); }
      return result;
    } catch (error) {
      if (effect) await this.evidence.finishEffect(owner, lease, stepId, 'inconclusive', { error: 'Remote effect was not verified; reconciliation required' });
      if (!effect && error instanceof ConnectorError && error.outcome === 'unsupported') throw error;
      throw new ConnectorError(effect ? 'inconclusive' : 'failed', effect ? 'Remote effect was not verified; reconciliation required' : 'Connector read failed');
    }
  }
}
