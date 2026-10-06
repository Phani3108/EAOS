import { createHash } from 'node:crypto';
import { collectArtifactIds } from '@agentos/db/run-repository';
import type { PostgresIntegrationRepository } from '@agentos/db/integration-repository';
import type { WorkspaceOwner } from '@agentos/db/workspace-repository';

const MIME_EXTENSIONS: Record<string, string[]> = { 'text/plain': ['txt','log','ts','js','py','go','rs','java','sql'], 'text/markdown': ['md'], 'text/csv': ['csv'], 'application/json': ['json'] };
export function extractArtifact(filename: string, mimeType: string, bytes: Buffer) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,159}$/.test(filename) || filename.includes('..')) throw new Error('Invalid artifact filename');
  if (!MIME_EXTENSIONS[mimeType]?.includes(filename.split('.').at(-1)!.toLowerCase())) throw new Error('Unsupported artifact format');
  if (!bytes.length || bytes.length > 512_000) throw new Error('Artifact byte bound exceeded');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('Artifact is not UTF-8 text'); }
  if (text.includes('\0') || text.length > 128_000 || !text.trim()) throw new Error('Artifact text is invalid or too large');
  if (mimeType === 'application/json') { try { JSON.parse(text); } catch { throw new Error('Artifact JSON is invalid'); } }
  return { filename, mimeType, bytes, text, digest: createHash('sha256').update(bytes).digest('hex') };
}
export async function resolveArtifactContext(repository: PostgresIntegrationRepository, owner: WorkspaceOwner, inputs: unknown): Promise<Record<string, { artifactId: string; filename: string; digest: string; text: string }>> {
  const ids = collectArtifactIds(inputs);
  if (ids.length > 20) throw new Error('Too many input artifacts');
  const result: Record<string, { artifactId: string; filename: string; digest: string; text: string }> = {};
  let length = 0;
  for (const id of ids) {
    const artifact = await repository.getArtifact(owner, id);
    if (!artifact) throw new Error('Input artifact is unavailable to this owner');
    const extracted = extractArtifact(artifact.filename, artifact.mimeType, artifact.bytes);
    if (extracted.digest !== artifact.digest || extracted.text !== artifact.text) throw new Error('Artifact integrity check failed');
    length += extracted.text.length;
    if (length > 64_000) throw new Error('Expanded artifact context exceeds the execution bound');
    result[id] = { artifactId: id, filename: artifact.filename, digest: artifact.digest, text: artifact.text };
  }
  return result;
}
