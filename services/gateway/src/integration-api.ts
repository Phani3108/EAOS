import { z } from 'zod';
import { isOwnedSecretPath } from '@agentos/secrets';
import { isDemoPrincipal, localDemoUser, type AuthUser } from './auth.js';
import type { PostgresWorkspaceRepository } from '@agentos/db/workspace-repository';
import type { ArtifactRetention, PostgresIntegrationRepository } from '@agentos/db/integration-repository';
import { ConnectorService, publicConnection, validateConnectionConfig } from './connector-service.js';
import { extractArtifact } from './artifact-ingestion.js';
import { validate } from './validation.js';

const connection = /^\/api\/connections(?:\/([a-z][a-z0-9_-]{0,99})\/(connect|disconnect|status|test))?$/;
const artifact = /^\/api\/artifacts(?:\/(artifact-[a-zA-Z0-9-]+)(\/content)?)?$/;
/**
 * Public demo visitors are minted per browser session (POST /api/auth/demo), so a
 * per-owner quota bounds nothing in aggregate. Their uploads share one tenant-wide
 * pool — one ordinary owner's worth of bytes — with a small cap per visitor, and
 * expire after a day. Every demo principal except the single local developer one is
 * treated this way whatever the current mode, so a demo session that outlives a mode
 * change stays bounded too. Everyone else keeps the repository's per-owner default.
 */
export const DEMO_ARTIFACT_RETENTION: ArtifactRetention = { owner: { files: 20, bytes: 2_000_000 }, ephemeral: { ttlSeconds: 86_400, pool: { files: 5_000, bytes: 64_000_000 } } };
export function artifactRetention(principal: AuthUser): ArtifactRetention | undefined {
  return isDemoPrincipal(principal) && principal.id !== localDemoUser().id ? DEMO_ARTIFACT_RETENTION : undefined;
}
export function isIntegrationRoute(path: string, method: string): boolean { return ['GET','POST','DELETE'].includes(method) && (connection.test(path) || artifact.test(path) || path === '/api/marketing/upload' && method === 'POST'); }
export async function integrationRequest(workspace: PostgresWorkspaceRepository | undefined, repository: PostgresIntegrationRepository | undefined, connectors: ConnectorService | undefined, principal: AuthUser, url: URL, method: string, readBody: () => Promise<Record<string, unknown>>): Promise<{ status: number; data?: unknown; download?: { bytes: Buffer; filename: string; mimeType: string } }> {
  if (!workspace || !repository || !connectors) return { status: 422, data: { error: 'Integration evidence requires durable PostgreSQL storage', code: 'durable_runtime_required' } };
  const owner = { tenantId: principal.tenantId, userId: principal.id };
  const connector = url.pathname.match(connection);
  if (connector) {
    if (!['admin','operator'].includes(principal.role)) return { status: 403, data: { error: 'Operator role required' } };
    const id = connector[1];
    if (!id && method === 'GET') return { status: 200, data: { connections: Object.fromEntries((await workspace.listConnections(owner)).map(row => [row.connectorId, publicConnection(row)])) } };
    if (!id) return { status: 405, data: { error: 'Unsupported connection operation' } };
    if (connector[2] === 'connect' && method === 'POST') {
      const input = validate(z.object({ secretRef: z.object({ provider: z.enum(['vault','aws','gcp','azure']), path: z.string().min(1).max(500), key: z.string().max(200).optional(), version: z.string().max(100).optional() }).strict(), config: z.record(z.string(), z.unknown()).optional() }).strict(), await readBody());
      if (!isOwnedSecretPath(input.secretRef.path, owner)) return { status: 400, data: { error: 'Secret reference is outside the owner namespace' } };
      let config: Record<string, unknown> = {};
      try { if (input.config) config = validateConnectionConfig(id, input.config); } catch { return { status: 400, data: { error: 'Unsupported or invalid connector resource policy' } }; }
      return { status: 200, data: publicConnection(await workspace.saveConnection(owner, id, input.secretRef, config)) };
    }
    if (connector[2] === 'disconnect' && method === 'POST') return { status: 200, data: { disconnected: await workspace.revokeConnection(owner, id) } };
    if (connector[2] === 'status' && method === 'GET') { const record = await workspace.getConnection(owner, id); return { status: 200, data: record ? publicConnection(record) : { connectorId: id, status: 'unavailable' } }; }
    if (connector[2] === 'test' && method === 'POST') { const record = await connectors.probe(owner, id); return { status: record.status === 'verified' ? 200 : 422, data: { ...record, ok: record.status === 'verified', ...(record.status === 'verified' ? {} : { error: 'Connection was not verified' }) } }; }
    return { status: 405, data: { error: 'Unsupported connection operation' } };
  }
  const match = url.pathname.match(artifact);
  if (method === 'POST' && (url.pathname === '/api/artifacts' || url.pathname === '/api/marketing/upload')) {
    // 255 is the common filesystem limit for a File.name; the stored name is sanitised and bounded by extractArtifact.
    const body = validate(z.object({ fileName: z.string().max(255), mimeType: z.string().max(100), contentBase64: z.string().min(1).max(683_000) }).strict(), await readBody());
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.contentBase64)) return { status: 400, data: { error: 'Invalid base64 artifact content' } };
    let extracted;
    try { extracted = extractArtifact(body.fileName, body.mimeType, Buffer.from(body.contentBase64, 'base64')); } catch (error) { return { status: 415, data: { error: error instanceof Error ? error.message : 'Artifact extraction failed' } }; }
    const stored = await repository.putArtifact(owner, extracted, artifactRetention(principal));
    return { status: 201, data: { artifactId: stored.id, fileId: stored.id, fileName: stored.filename, mimeType: stored.mimeType, digest: stored.digest, size: stored.bytes.length, status: 'ready' } };
  }
  if (match?.[1]) {
    const value = await repository.getArtifact(owner, match[1]);
    if (!value) return { status: 404, data: { error: 'Artifact not found' } };
    if (method === 'DELETE') return { status: 200, data: { archived: await repository.archiveArtifact(owner, value.id) } };
    if (method === 'GET' && match[2]) return { status: 200, download: { bytes: value.bytes, filename: value.filename, mimeType: value.mimeType } };
    if (method === 'GET') return { status: 200, data: { artifact: { artifactId: value.id, fileName: value.filename, mimeType: value.mimeType, digest: value.digest, size: value.bytes.length, text: value.text } } };
  }
  return { status: 405, data: { error: 'Unsupported artifact operation' } };
}
