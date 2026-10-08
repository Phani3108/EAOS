import { describe, expect, it } from 'vitest';
import type { PostgresWorkspaceRepository, StoredSecretReference } from '@agentos/db/workspace-repository';
import type { ArtifactRetention, PostgresIntegrationRepository } from '@agentos/db/integration-repository';
import type { ConnectorService } from './connector-service.js';
import type { AuthUser } from './auth.js';
import { DEMO_ARTIFACT_RETENTION, artifactRetention, integrationRequest } from './integration-api.js';

// Real principal shapes: SSO users are `oidc:<sha256(iss, sub)>` (oidc-provider.ts),
// EAOS_DEMO_MODE=local acts as `demo:local`, public demo visitors are `demo:<uuid>`.
const principal = (id: string, role: AuthUser['role'] = 'admin'): AuthUser => ({ id, role, tenantId: 'default', email: 'fixture@example.invalid', name: 'Fixture', teams: [], personaScopes: ['*'] });
const SSO_ADMIN = principal(`oidc:${'3f2a'.repeat(16)}`);
const LOCAL_DEMO = principal('demo:local');
const DEMO_VISITOR = principal('demo:6f1c2b0e-8d4a-4c55-9a51-0f3e1d2c7b9a', 'user');
const SETUP_ADMIN = principal('user_0123456789abcdef');

function harness() {
  const saved: Array<{ owner: unknown; ref: StoredSecretReference }> = [];
  const stored: Array<{ filename: string; retention?: ArtifactRetention }> = [];
  const workspace = {
    saveConnection: async (owner: unknown, connectorId: string, ref: StoredSecretReference, config: Record<string, unknown>) => { saved.push({ owner, ref }); return { connectorId, secretRef: ref, status: 'configured', version: 1, config }; },
  } as unknown as PostgresWorkspaceRepository;
  const repository = {
    putArtifact: async (owner: { tenantId: string; userId: string }, value: { filename: string; mimeType: string; digest: string; bytes: Buffer; text: string }, retention?: ArtifactRetention) => { stored.push({ filename: value.filename, retention }); return { ...owner, ...value, id: 'artifact-fixture' }; },
  } as unknown as PostgresIntegrationRepository;
  const request = (user: AuthUser, path: string, body: Record<string, unknown>) => integrationRequest(workspace, repository, {} as ConnectorService, user, new URL(`http://localhost${path}`), 'POST', async () => body);
  return { saved, stored, request };
}
const connect = (path: string) => ({ secretRef: { provider: 'vault', path, key: 'token' }, config: { repositories: ['org/fixture'] } });
const upload = (fileName: string) => ({ fileName, mimeType: fileName.endsWith('.md') ? 'text/markdown' : 'text/csv', contentBase64: Buffer.from('fixture,content').toString('base64') });

describe('connector connections for every principal shape', () => {
  it.each([SSO_ADMIN, LOCAL_DEMO, SETUP_ADMIN])('lets $id connect a secret in its own namespace', async user => {
    const { saved, request } = harness();
    const result = await request(user, '/api/connections/github/connect', connect(`default/${user.id}/github`));
    expect(result.status).toBe(200);
    expect(saved).toEqual([{ owner: { tenantId: 'default', userId: user.id }, ref: expect.objectContaining({ path: `default/${user.id}/github` }) }]);
  });
  it.each([
    `default/${LOCAL_DEMO.id}/github`,
    `default/oidc/${'3f2a'.repeat(16)}/github`,
    `default/${SSO_ADMIN.id}/../${LOCAL_DEMO.id}/github`,
    `other/${SSO_ADMIN.id}/github`,
    `default/${SSO_ADMIN.id}`,
  ])('refuses an SSO principal the path %s', async path => {
    const { saved, request } = harness();
    expect(await request(SSO_ADMIN, '/api/connections/github/connect', connect(path))).toMatchObject({ status: 400, data: { error: 'Secret reference is outside the owner namespace' } });
    expect(saved).toHaveLength(0);
  });
});

describe('artifact uploads', () => {
  it('puts public demo visitors in the shared, expiring pool and nobody else', () => {
    expect(artifactRetention(DEMO_VISITOR)).toBe(DEMO_ARTIFACT_RETENTION);
    expect(DEMO_ARTIFACT_RETENTION.ephemeral).toMatchObject({ ttlSeconds: expect.any(Number), pool: expect.any(Object) });
    for (const user of [LOCAL_DEMO, SSO_ADMIN, SETUP_ADMIN, principal('anonymous', 'user')]) expect(artifactRetention(user)).toBeUndefined();
  });
  it('stores a demo visitor upload under the demo retention policy', async () => {
    const { stored, request } = harness();
    expect((await request(DEMO_VISITOR, '/api/artifacts', upload('data (1).csv'))).status).toBe(201);
    expect(stored).toEqual([{ filename: 'data (1).csv', retention: DEMO_ARTIFACT_RETENTION }]);
  });
  it.each([
    ['Q3 plan (final).md', 'Q3 plan (final).md'],
    ['résumé.csv', 'résumé.csv'],
    ['../../etc/report.csv', 'report.csv'],
    [`${'n'.repeat(250)}.csv`, `${'n'.repeat(156)}.csv`],
  ])('accepts %s and stores it as a plain file name', async (fileName, expected) => {
    const { stored, request } = harness();
    const result = await request(SSO_ADMIN, '/api/marketing/upload', upload(fileName));
    expect(result).toMatchObject({ status: 201, data: { fileName: expected } });
    expect(stored).toEqual([{ filename: expected, retention: undefined }]);
  });
});
