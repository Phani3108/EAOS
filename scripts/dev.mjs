#!/usr/bin/env node
/**
 * One-command local development: `pnpm dev`.
 *
 *   1. Database — your DATABASE_URL if you set one (environment or .env);
 *      otherwise the dev Postgres in deploy/docker-compose.dev.yml, started and
 *      health-checked here. Without Docker (or with EAOS_DEV_DB=file) it falls
 *      back to the file store, where durable runs, approvals, connections and
 *      the platform console report "requires PostgreSQL" instead of working.
 *   2. Migrations — applied with the same runner production uses.
 *   3. Gateway (:3000) and web (:3010), with EAOS_DEMO_MODE=local unless you
 *      chose a mode, so the whole UI works on your machine without signing in.
 *
 * Both servers listen on 127.0.0.1 unless you set HOST. Local demo mode signs
 * credential-less requests in as an administrator, and the web server's
 * /_/gateway proxy would relay anyone who can reach it — so neither port may be
 * reachable from the network. The dev Postgres is bound to 127.0.0.1 for the same
 * reason.
 *
 * Gateway and web are started directly rather than through `turbo run dev`:
 * turbo's strict env mode would not pass DATABASE_URL / EAOS_DEMO_MODE through.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const env = {
  ...process.env,
  EAOS_DEMO_MODE: process.env.EAOS_DEMO_MODE || 'local',
  HOST: process.env.HOST || '127.0.0.1',
  // The web server's /_/gateway proxy reaches the gateway over loopback; its
  // X-Forwarded-For (when anything in front of it sets one) names the browser.
  EAOS_TRUSTED_PROXIES: process.env.EAOS_TRUSTED_PROXIES || '127.0.0.1,::1',
};
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: root, env, stdio: 'inherit', ...opts });
const log = message => console.log(`\x1b[36m[dev]\x1b[0m ${message}`);

if (!env.DATABASE_URL && env.EAOS_DEV_DB !== 'file') {
  if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0) {
    log('starting the dev database (deploy/docker-compose.dev.yml)…');
    if (run('docker', ['compose', '-f', 'deploy/docker-compose.dev.yml', 'up', '-d', '--wait']).status !== 0) {
      console.error('[dev] the dev database did not become healthy; fix Docker or run with EAOS_DEV_DB=file');
      process.exit(1);
    }
    env.DATABASE_URL = `postgresql://eaos:eaos-local-dev-only@127.0.0.1:${env.EAOS_DEV_PG_PORT || '55432'}/eaos`;
  } else {
    log('Docker is not running — using the file store (limited mode: durable runs, approvals, connections and the platform console need PostgreSQL).');
  }
}

if (!env.DATABASE_URL && !env.EAOS_ADOPT_LEGACY_DATA) {
  // The file store is this machine's own single-tenant data. A store written before
  // deployments were bound to a tenant would otherwise stop the gateway at boot
  // (and this script with it); adopting it is the in-place upgrade the gateway's
  // error message asks for. Set EAOS_ADOPT_LEGACY_DATA=false to refuse instead.
  env.EAOS_ADOPT_LEGACY_DATA = 'true';
  log(`file store: data from before tenant binding is adopted into tenant "${env.EAOS_TENANT_ID || 'default'}" (EAOS_ADOPT_LEGACY_DATA=true).`);
}

log('building workspace dependencies…');
if (run('pnpm', ['exec', 'turbo', 'run', 'build', '--filter=@agentos/gateway^...', '--filter=@agentos/web^...', '--output-logs=errors-only']).status !== 0) process.exit(1);

if (env.DATABASE_URL) {
  log('applying migrations…');
  if (run('pnpm', ['exec', 'tsx', 'packages/db/src/migrate.ts']).status !== 0) process.exit(1);
}

log(`gateway http://localhost:3000 · web http://localhost:3010 · listening on ${env.HOST} · demo mode ${env.EAOS_DEMO_MODE} · storage ${env.DATABASE_URL ? 'PostgreSQL' : 'file'}`);
const children = [
  spawn('pnpm', ['--filter', '@agentos/gateway', 'dev'], { cwd: root, env, stdio: 'inherit' }),
  spawn('pnpm', ['--filter', '@agentos/web', 'dev', '--hostname', env.HOST], { cwd: root, env, stdio: 'inherit' }),
];
const stop = signal => { for (const child of children) if (!child.killed) child.kill(signal); };
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
for (const child of children) child.on('exit', code => { stop('SIGTERM'); process.exitCode = code ?? 0; });
