import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { generateJWT, type AuthUser } from './auth.js';
import type { Store } from './db.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { withTenantContext } from './tenant-middleware.js';

type Pool = { connect(): Promise<{ query(sql: string, params?: unknown[]): Promise<any>; release(): void }> };
interface SessionRow { id: string; user: AuthUser; hash: string; used: string[]; expiresAt: number; revoked: boolean }
const TABLE = 'browser_auth_sessions';
const ACCESS_TTL = 900;
const SESSION_TTL = 14 * 86400;
let backing: Store;
let pool: Pool | undefined;
const codes = new Map<string, { user: AuthUser; binding: string; expiresAt: number }>();
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const matches = (a: string, b: string) => timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));

export function initAuthSessions(store: Store, pgPool?: Pool): void { backing = store; pool = pgPool; }

async function change<T>(id: string, fn: (row?: SessionRow) => { value: T; row?: SessionRow }): Promise<T> {
  if (!backing) throw new Error('Session storage is not initialized');
  if (!pool) {
    const result = fn(backing.get(TABLE, id) as unknown as SessionRow | undefined);
    if (result.row) backing.insert(TABLE, id, result.row as unknown as Record<string, unknown>);
    return result.value;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT data FROM browser_auth_sessions WHERE id=$1 FOR UPDATE', [id]);
    const result = fn(rows[0]?.data as SessionRow | undefined);
    if (result.row) await client.query('INSERT INTO browser_auth_sessions (id, data) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET data=$2', [id, JSON.stringify(result.row)]);
    await client.query('COMMIT');
    return result.value;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
}

let onRevoked: (user: AuthUser) => void = () => {};
export function setSessionRevocationHandler(handler: (user: AuthUser) => void): void { onRevoked = handler; }

function credentials(user: AuthUser, refreshToken: string, ttl = ACCESS_TTL) {
  return { user, refreshToken, token: generateJWT(user, ttl), expiresIn: ttl };
}

let principalResolver: (user: AuthUser) => Promise<AuthUser | undefined> = async user => user;
export function setPrincipalResolver(resolver: typeof principalResolver): void { principalResolver = resolver; }

export async function createBrowserSession(principal: AuthUser, ttl = ACCESS_TTL) {
  const current = await principalResolver(principal);
  if (!current) throw new Error('Membership is suspended');
  principal = current;
  // A session minted from an expiring API key ends when the key does, and carries
  // that bound (authorityExpiresAt stays on the stored user) into whatever it mints
  // in turn. A one-hour key used to buy a renewable 14-day session.
  const now = Date.now();
  const expiresAt = Math.min(now + SESSION_TTL * 1000, principal.authorityExpiresAt ?? Infinity);
  if (expiresAt <= now) throw Object.assign(new Error('The presenting credential has expired'), { statusCode: 401 });
  const id = randomUUID();
  const { tokenExpiresAt: _expiry, ...identity } = principal;
  const user = { ...identity, sessionId: id };
  const refreshToken = `${id}.${randomBytes(32).toString('hex')}`;
  const result = credentials(user, refreshToken, Math.max(1, Math.min(ttl, Math.floor((expiresAt - now) / 1000))));
  await change(id, () => ({ row: { id, user, hash: digest(refreshToken), used: [], expiresAt, revoked: false }, value: undefined }));
  return result;
}

export async function refreshBrowserSession(refreshToken: string): Promise<ReturnType<typeof credentials> | undefined> {
  if (refreshToken.length > 256 || !refreshToken.includes('.')) return undefined;
  const id = refreshToken.split('.')[0]!;
  let revoked: AuthUser | undefined;
  const result = await change<ReturnType<typeof credentials> | undefined>(id, row => {
    if (!row || row.revoked || row.expiresAt <= Date.now()) return { value: undefined };
    const hash = digest(refreshToken);
    if (!matches(hash, row.hash)) {
      if (row.used.includes(hash)) { revoked = row.user; return { row: { ...row, revoked: true }, value: undefined }; }
      return { value: undefined };
    }
    if (row.used.length >= 2048) { revoked = row.user; return { row: { ...row, revoked: true }, value: undefined }; }
    const next = `${id}.${randomBytes(32).toString('hex')}`;
    const result = credentials(row.user, next);
    return { row: { ...row, hash: digest(next), used: [...row.used, hash] }, value: result };
  });
  if (revoked) onRevoked(revoked);
  return result;
}

export async function getSessionUser(id: string): Promise<AuthUser | undefined> {
  return change(id, row => ({ value: row && !row.revoked && row.expiresAt > Date.now() ? { ...row.user, tokenExpiresAt: row.expiresAt } : undefined }));
}

export async function getRefreshUser(raw: string): Promise<AuthUser | undefined> {
  if (!/^[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(raw)) return undefined;
  return change(raw.split('.')[0]!, row => ({ value: row && !row.revoked && row.expiresAt > Date.now() && matches(row.hash, digest(raw))
    ? { ...row.user, tokenExpiresAt: Math.min(row.expiresAt, Date.now() + ACCESS_TTL * 1000) } : undefined }));
}

export async function revokeBrowserSession(id: string): Promise<void> {
  const user = await change(id, row => ({ row: row ? { ...row, revoked: true } : undefined, value: row?.user }));
  if (user) onRevoked(user);
}

export function revokeLocalUserSessions(user: AuthUser): void {
  if (!backing || pool) return;
  for (const raw of backing.all(TABLE)) {
    const row = raw as unknown as SessionRow;
    if (row.user?.id === user.id && row.user.tenantId === user.tenantId) backing.update(TABLE, row.id, { revoked: true });
  }
  onRevoked(user);
}

export async function persistOidcUser(user: AuthUser): Promise<AuthUser> {
  if (!backing || !user.tenantId || !user.id.startsWith('oidc:')) throw new Error('Invalid OIDC principal');
  if (pool) {
    return withTenantContext(pool, user.tenantId, async client => {
      const tenant = await client.query('SELECT id FROM tenants WHERE id=$1', [user.tenantId]) as { rows: unknown[] };
      if (!tenant.rows.length) throw new Error('Administrator setup is required before SSO');
      const result = await client.query(
        "INSERT INTO users (id,email,name,role,tenant_id,created_at) VALUES ($1,$2,$3,'user',$4,NOW()) ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email, name=EXCLUDED.name WHERE users.tenant_id=EXCLUDED.tenant_id RETURNING role",
        [user.id, user.email, user.name, user.tenantId],
      ) as { rows: Array<{ role: AuthUser['role'] }> };
      if (!result.rows[0]) throw new Error('OIDC identity belongs to another tenant');
      return { ...user, role: result.rows[0].role };
    });
  }
  if (!backing.get('tenants', user.tenantId)) throw new Error('Administrator setup is required before SSO');
  const existing = backing.get('users', user.id);
  if (existing && existing.tenantId !== user.tenantId) throw new Error('OIDC identity belongs to another tenant');
  if (backing.query('users', row => row.email === user.email && row.id !== user.id).length) throw new Error('An account with this email already exists; explicit account linking is required');
  const role = (existing?.role ?? 'user') as AuthUser['role'];
  if (!['user', 'operator', 'admin'].includes(role)) throw new Error('Invalid stored user role');
  backing.insert('users', user.id, { ...user, role });
  return { ...user, role };
}

export function issueLoginCode(user: AuthUser, binding: string): string {
  if (!binding) throw new Error('Browser binding required');
  for (const [key, value] of codes) if (value.expiresAt <= Date.now()) codes.delete(key);
  if (codes.size >= 1000) throw new Error('Too many pending logins');
  const code = randomBytes(32).toString('hex');
  codes.set(digest(code), { user, binding: digest(binding), expiresAt: Date.now() + 60_000 });
  return code;
}

export function consumeLoginCode(code: string, binding: string): AuthUser | undefined {
  const entry = codes.get(digest(code));
  codes.delete(digest(code));
  return entry && entry.expiresAt > Date.now() && matches(entry.binding, digest(binding)) ? entry.user : undefined;
}

export function readCookie(req: IncomingMessage, name: string): string {
  const values = (req.headers.cookie ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  return values.length === 1 ? values[0]!.slice(name.length + 1) : '';
}

export function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

export function setSessionCookies(res: ServerResponse, issued?: ReturnType<typeof credentials>): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Set-Cookie', [cookie('eaos_access', issued?.token ?? '', issued ? ACCESS_TTL : 0), cookie('eaos_refresh', issued?.refreshToken ?? '', issued ? SESSION_TTL : 0)]);
}
