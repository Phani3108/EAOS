/**
 * The secret namespace a principal owns: `<tenantId>/<userId>/…`, with both ids
 * written verbatim — that is the path operators are told to use, and the one
 * they write into Vault.
 *
 * Principal ids are not all bare tokens. SSO users are `oidc:<sha256>` and the
 * local demo principal is `demo:local`, so an owner segment admits ':' (never
 * first). That is safe to carry: Vault KV paths accept any characters, and every
 * segment is percent-encoded into the request URL, so ':' travels as %3A.
 *
 * The character set is not what isolates owners. The tenant and user segments are
 * compared for exact equality, and an owner id that could not be exactly one
 * non-traversing segment ('/', '.', '..', control characters) gets no namespace at
 * all — rather than one whose prefix overlaps another owner's.
 */
const OWNER_SEGMENT = /^[a-zA-Z0-9_-][a-zA-Z0-9_.:-]{0,199}$/;
const PATH_SEGMENT = /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,199}$/;

export function isSecretOwnerSegment(id: string): boolean {
  return typeof id === 'string' && OWNER_SEGMENT.test(id) && !id.includes('..');
}

export function isOwnedSecretPath(path: string, owner: { tenantId: string; userId: string }): boolean {
  if (typeof path !== 'string' || !isSecretOwnerSegment(owner.tenantId) || !isSecretOwnerSegment(owner.userId)) return false;
  const [tenant, user, ...rest] = path.split('/');
  return tenant === owner.tenantId && user === owner.userId && rest.length > 0 && rest.every(segment => PATH_SEGMENT.test(segment) && !segment.includes('..'));
}
