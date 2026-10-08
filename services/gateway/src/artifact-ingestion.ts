import { createHash } from 'node:crypto';
import { collectArtifactIds } from '@agentos/db/run-repository';
import type { PostgresIntegrationRepository } from '@agentos/db/integration-repository';
import type { WorkspaceOwner } from '@agentos/db/workspace-repository';

const MIME_EXTENSIONS: Record<string, string[]> = { 'text/plain': ['txt','log','ts','js','py','go','rs','java','sql'], 'text/markdown': ['md'], 'text/csv': ['csv'], 'application/json': ['json'] };
const MAX_FILENAME = 160;
/**
 * Browsers upload the file's own name (File.name), so ordinary names — 'data (1).csv',
 * 'Q3 plan (final).md', 'résumé.txt' — have to be accepted. The name is never used as
 * a filesystem path: it is stored as data and returned through an RFC 8187-encoded
 * header. So it is sanitised rather than rejected, and only what could act as a path
 * or hide/spoof part of a name is changed:
 *   - any directory part is dropped ('../../x.txt' is stored as 'x.txt');
 *   - control, format (bidi overrides, zero-width), surrogate and line/paragraph
 *     separator characters, and the characters Windows reserves, become '_';
 *   - '..' collapses to '.', and leading dots or trailing dots/spaces are trimmed;
 *   - an over-long name keeps its extension and loses the end of its stem.
 * The result is idempotent, so a stored name re-validates unchanged on every read.
 */
export function sanitizeArtifactFilename(raw: string): string {
  let name = (raw.normalize('NFC').split(/[/\\]/).at(-1) ?? '')
    .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}<>:"|?*]/gu, '_')
    .replace(/\p{Zs}/gu, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/^[\s.]+|[\s.]+$/gu, '');
  const characters = Array.from(name);
  if (characters.length > MAX_FILENAME) {
    const extension = /\.[^.]{1,16}$/u.exec(name)?.[0] ?? '';
    name = characters.slice(0, MAX_FILENAME - Array.from(extension).length).join('').replace(/[\s.]+$/u, '') + extension;
  }
  if (!name) throw new Error('Invalid artifact filename');
  return name;
}
/** `filename*` per RFC 6266/8187. encodeURIComponent leaves ' ( ) * as-is, but they are not attr-chars — an apostrophe would end the value — so they are encoded too. */
export function attachmentDisposition(filename: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
export function extractArtifact(rawFilename: string, mimeType: string, bytes: Buffer) {
  const filename = sanitizeArtifactFilename(rawFilename);
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
