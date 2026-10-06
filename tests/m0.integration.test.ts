import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';

async function main() {
  const databaseUrl = process.env.EAOS_TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error('EAOS_TEST_DATABASE_URL is required; refusing to skip database acceptance');
  const target = new URL(databaseUrl);
  if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname !== '/eaos_m0_fixture') throw new Error('Use a disposable local database named eaos_m0_fixture');
  process.env.DATABASE_URL = databaseUrl;
  process.env.JWT_SECRET = 'm0-fixture-signing-secret-never-use-in-production';
  const { getRawPool } = await import('../packages/db/dist/postgres-store.js');
  const { runMigrations } = await import('../packages/db/dist/migrate.js');
  const { InMemoryStore } = await import('../packages/db/dist/connection.js');
  const pool = await getRawPool() as any;
  let gateway: ChildProcess | undefined;
  try {
    await runMigrations(pool);
    assert.deepEqual(await runMigrations(pool), []);
    const role = await pool.query("SELECT 1 FROM pg_roles WHERE rolname='eaos_m0_app'");
    if (!role.rows.length) await pool.query('CREATE ROLE eaos_m0_app NOLOGIN');
    await pool.query('GRANT USAGE ON SCHEMA public TO eaos_m0_app');
    await pool.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eaos_m0_app');
    const appPool = {
      query: pool.query.bind(pool),
      connect: async () => {
        const client = await pool.connect();
        return {
          query: async (sql: string, params?: unknown[]) => {
            const result = await client.query(sql, params);
            if (sql === 'BEGIN') await client.query('SET LOCAL ROLE eaos_m0_app');
            return result;
          },
          release: () => client.release(),
        };
      },
    };
    const { runSetup } = await import('../services/gateway/dist/setup.js');
    const { generateApiKey, generateJWT } = await import('../services/gateway/dist/auth.js');
    const { rotateApiKey, revokeApiKey } = await import('../services/gateway/dist/api-key-lifecycle.js');
    const tenantId = 'm0-fixture';
    const setup = await runSetup({ setupToken: 'fixture-setup-token-at-least-24-chars', email: 'fixture@example.invalid', tenantId }, { setupToken: 'fixture-setup-token-at-least-24-chars', store: new InMemoryStore(), pgPool: appPool });
    assert.ok(setup.ok || setup.status === 410);
    const repeated = await runSetup({ setupToken: 'fixture-setup-token-at-least-24-chars', email: 'fixture@example.invalid', tenantId }, { setupToken: 'fixture-setup-token-at-least-24-chars', store: new InMemoryStore(), pgPool: appPool });
    assert.equal(repeated.ok, false);
    if (!repeated.ok) assert.equal(repeated.status, 410);
    const { rows } = await pool.query('SELECT * FROM users WHERE email=$1 AND tenant_id=$2', ['fixture@example.invalid', tenantId]);
    assert.equal(rows.length, 1);
    const user = { id: rows[0].id, tenantId, role: 'admin' as const, email: rows[0].email, name: rows[0].name, teams: [], personaScopes: ['*'] as ['*'] };
    const sessionService = await import('../services/gateway/dist/auth-sessions.js');
    sessionService.initAuthSessions(new InMemoryStore(), appPool);
    const ssoUser = await sessionService.persistOidcUser({ ...user, id: 'oidc:fixture-user', email: 'sso-fixture@example.invalid' });
    assert.equal(ssoUser.role, 'user');
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', 'other-tenant', true)");
      assert.equal((await client.query('SELECT id FROM users WHERE id=$1', [user.id])).rows.length, 0);
      await client.query('ROLLBACK');
    } finally { client.release(); }
    const key = generateApiKey();
    const keyId = `fixture-${Date.now()}`;
    await pool.query('INSERT INTO api_keys (id,user_id,key_hash,key_prefix,name,scopes,tenant_id) VALUES ($1,$2,$3,$4,$5,$6,$7)', [keyId, user.id, key.keyHash, key.keyPrefix, 'M0 fixture', ['*'], tenantId]);
    const rotated = await rotateApiKey(keyId, user, appPool);
    assert.ok(rotated);
    assert.equal((await pool.query('SELECT * FROM authenticate_api_key($1)', [key.keyHash])).rows.length, 0);
    assert.equal(await revokeApiKey(rotated.id, { ...user, tenantId: 'other' }, appPool), false);
    console.log('PASS migrations, bootstrap, non-owner RLS and transactional key rotation');

    const applicationUrl = new URL(databaseUrl);
    applicationUrl.searchParams.set('options', '-c role=eaos_m0_app');
    const port = Number(process.env.EAOS_TEST_GATEWAY_PORT ?? 32199);
    const base = `http://127.0.0.1:${port}`;
    const origin = 'http://localhost:3010';
    gateway = spawn(process.execPath, [resolve('services/gateway/dist/server.js')], {
      env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(port), DATABASE_URL: applicationUrl.toString(), JWT_SECRET: process.env.JWT_SECRET, EAOS_TENANT_ID: tenantId, CORS_ALLOWED_ORIGINS: origin, FRONTEND_URL: origin, SEED_DEMO: 'false', REDIS_URL: 'redis://127.0.0.1:1', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1', EAOS_MCP_CONFIG: '/dev/null/mcp.json' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    gateway.stdout?.on('data', chunk => { output += chunk.toString(); });
    gateway.stderr?.on('data', chunk => { output += chunk.toString(); });
    for (let attempt = 0; attempt < 100 && !output.includes('EOS Gateway — Enterprise OS API'); attempt++) {
      if (gateway.exitCode !== null) throw new Error('Compiled gateway exited before readiness');
      await delay(100);
    }
    assert.ok(output.includes('EOS Gateway — Enterprise OS API'), 'Compiled gateway did not start');
    const cookieJar = new Map<string, string>();
    async function request(path: string, body?: unknown, extraHeaders: Record<string, string> = {}, method = body === undefined ? 'GET' : 'POST') {
      const response = await fetch(base + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: [...cookieJar].map(([name, value]) => `${name}=${value}`).join('; '), ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      for (const header of response.headers.getSetCookie()) {
        const pair = header.split(';')[0]!;
        const index = pair.indexOf('=');
        cookieJar.set(pair.slice(0, index), pair.slice(index + 1));
      }
      return { status: response.status, data: await response.json(), headers: response.headers };
    }
    assert.equal((await request('/api/live')).status, 200);
    assert.equal((await request('/api/skills')).status, 401);
    const login = await request('/api/auth/token', { browser: true }, { 'X-API-Key': rotated.rawKey });
    assert.equal(login.status, 200);
    assert.ok(login.headers.getSetCookie().every(value => value.includes('HttpOnly') && value.includes('Secure')));
    assert.equal((await request('/api/auth/me')).data.user.tenantId, tenantId);
    const hostile = generateJWT({ ...user, tenantId: 'other-tenant' });
    const foreignChannels = await request('/api/notifications/channels', undefined, { Authorization: `Bearer ${hostile}` });
    assert.equal(foreignChannels.status, 200);
    assert.deepEqual(foreignChannels.data.channels, []);
    assert.equal((await request('/api/forum/threads', undefined, { Authorization: `Bearer ${hostile}` })).status, 403);
    assert.equal((await request('/api/auth/ws-ticket', {}, { Origin: 'https://other.invalid' })).status, 403);
    const ticket = await request('/api/auth/ws-ticket', {});
    assert.equal(ticket.status, 200);
    const oldRefresh = cookieJar.get('eaos_refresh')!;
    assert.equal((await request('/api/auth/token/refresh', {})).status, 200);
    assert.equal((await request('/api/auth/token/refresh', {}, { Cookie: `eaos_refresh=${oldRefresh}` })).status, 401);
    assert.equal((await request('/api/auth/me')).status, 401);
    assert.equal((await request('/api/auth/token', { browser: true }, { 'X-API-Key': rotated.rawKey })).status, 200);
    assert.equal((await request('/api/auth/logout', {})).status, 200);
    assert.equal((await request('/api/auth/me')).status, 401);
    const apiSession = await request('/api/auth/token', {}, { 'X-API-Key': rotated.rawKey });
    assert.equal(apiSession.status, 200);
    assert.equal(await revokeApiKey(rotated.id, user, appPool), true);
    assert.equal((await request('/api/auth/me', undefined, { Authorization: `Bearer ${apiSession.data.token}` })).status, 401);
    assert.equal((await request('/api/ready')).status, 200);
    console.log('PASS compiled PostgreSQL gateway, cookies, CSRF, tenant boundary, refresh reuse, logout and issued-token revocation');
  } finally {
    if (gateway && gateway.exitCode === null) {
      const exited = once(gateway, 'exit');
      gateway.kill('SIGTERM');
      await Promise.race([exited, delay(6000)]);
      if (gateway.exitCode === null) { gateway.kill('SIGKILL'); await exited; }
    }
    await pool.end();
  }
}

main().catch(err => { console.error(err instanceof Error ? err.message : 'M0 acceptance failed'); process.exitCode = 1; });
