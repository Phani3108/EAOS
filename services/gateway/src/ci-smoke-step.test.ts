/**
 * The CI "Gateway smoke test" step must be able to fail.
 *
 * It was made blocking (continue-on-error: false) but could not fail: it ran under
 * GitHub's default `bash -e`, which has no pipefail, so `curl -sf .../api/health | tee`
 * exited with tee's status, and the wait loop never failed either. A gateway that
 * crashed at boot left the step green.
 *
 * These tests run the step's own script, extracted from .github/workflows/ci.yml,
 * under the shell GitHub would use for it, with `node` replaced by a fake gateway:
 * one that crashes, one that never becomes ready, one that is healthy, and one that
 * does not shut down cleanly.
 */
import { spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

interface WorkflowStep { name?: string; shell?: string; run?: string; env?: Record<string, string | number> }
const workflow = parse(readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8')) as { jobs: Record<string, { steps: WorkflowStep[] }> };
const smokeStep = workflow.jobs['build-and-test']!.steps.find(step => step.name === 'Gateway smoke test');

/** The command GitHub Actions runs a `run:` script with, per the step's `shell:`. */
function shellCommand(step: WorkflowStep, scriptPath: string): string[] {
  if (step.shell === undefined) return ['bash', '-e', scriptPath];
  if (step.shell === 'bash') return ['bash', '--noprofile', '--norc', '-eo', 'pipefail', scriptPath];
  throw new Error(`Unexpected shell for the smoke step: ${step.shell}`);
}

/**
 * Stands in for `node dist/server.js` (run from services/gateway). It also records the env the
 * step boots the gateway with, so the production-mode boot is part of the contract.
 */
const FAKE_GATEWAY = `
const { createServer } = require('node:http');
const { writeFileSync } = require('node:fs');
writeFileSync(process.env.FAKE_RECORD, JSON.stringify({ args: process.argv.slice(2), NODE_ENV: process.env.NODE_ENV, JWT_SECRET: process.env.JWT_SECRET, DATA_DIR: process.env.DATA_DIR }));
const mode = process.env.FAKE_GATEWAY;
if (mode === 'crash') { console.error('[config] ERROR JWT_SECRET: fake boot failure'); process.exit(78); }
const server = createServer((req, res) => {
  const ready = mode !== 'never-ready';
  if (req.url === '/api/ready') { res.writeHead(ready ? 200 : 503); res.end(JSON.stringify({ status: ready ? 'ready' : 'not_ready' })); return; }
  if (req.url === '/api/health') { res.writeHead(200); res.end('{"status":"ok"}'); return; }
  res.writeHead(404); res.end();
});
server.listen(Number(process.env.PORT), '127.0.0.1');
process.on('SIGTERM', () => server.close(() => process.exit(mode === 'unclean-shutdown' ? 1 : 0)));
`;

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

let workDir: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'eaos-ci-smoke-'));
  writeFileSync(join(workDir, 'fake-gateway.cjs'), FAKE_GATEWAY);
  writeFileSync(join(workDir, 'node'), `#!/bin/sh\nexec "${process.execPath}" "${join(workDir, 'fake-gateway.cjs')}" "$@"\n`);
  chmodSync(join(workDir, 'node'), 0o755);
  writeFileSync(join(workDir, 'smoke.sh'), smokeStep?.run ?? '');
});

afterAll(() => { rmSync(workDir, { recursive: true, force: true }); });

async function runSmokeStep(mode: 'crash' | 'never-ready' | 'ready' | 'unclean-shutdown', timeoutSeconds = 30) {
  const [command, ...args] = shellCommand(smokeStep!, join(workDir, 'smoke.sh'));
  const record = join(workDir, `${mode}.json`);
  const env = {
    ...process.env,
    ...Object.fromEntries(Object.entries(smokeStep!.env ?? {}).map(([key, value]) => [key, String(value)])),
    // Never the step's real port: a developer's gateway may already be on :3000.
    PORT: String(await freePort()),
    GATEWAY_READY_TIMEOUT_SECONDS: String(timeoutSeconds),
    PATH: `${workDir}:${process.env.PATH}`,
    TMPDIR: workDir,
    FAKE_GATEWAY: mode,
    FAKE_RECORD: record,
  };
  const started = Date.now();
  const child = spawn(command!, args, { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const code = await new Promise<number | null>(resolve => child.on('close', resolve));
  let booted: { args: string[]; NODE_ENV?: string; JWT_SECRET?: string; DATA_DIR?: string } | undefined;
  try { booted = JSON.parse(readFileSync(record, 'utf8')); } catch { booted = undefined; }
  return { code, output, seconds: (Date.now() - started) / 1000, booted };
}

describe('CI gateway smoke step', () => {
  it('exists, runs with pipefail and probes readiness rather than liveness', () => {
    expect(smokeStep?.run).toBeTruthy();
    expect(shellCommand(smokeStep!, 'x')).toContain('pipefail');
    expect(smokeStep!.run).toContain('/api/ready');
  });

  it('fails fast, with the gateway output, when the gateway exits during boot', async () => {
    const result = await runSmokeStep('crash');
    expect(result.code).not.toBe(0);
    expect(result.output).toContain('the gateway exited before it became ready');
    expect(result.output).toContain('fake boot failure');
    expect(result.seconds).toBeLessThan(15);
  }, 30_000);

  it('fails when /api/ready never answers 200 within the deadline', async () => {
    const result = await runSmokeStep('never-ready', 2);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain('/api/ready did not answer 200 within 2s');
  }, 30_000);

  it('fails when the gateway does not shut down cleanly on SIGTERM', async () => {
    const result = await runSmokeStep('unclean-shutdown');
    expect(result.code).not.toBe(0);
    expect(result.output).toContain('did not shut down cleanly');
  }, 30_000);

  it('passes for a gateway that becomes ready and stops cleanly, booted as in production', async () => {
    const result = await runSmokeStep('ready');
    expect(result.output).toContain('Gateway ready after');
    expect(result.code).toBe(0);
    expect(result.booted?.args).toEqual(['dist/server.js']);
    expect(result.booted?.NODE_ENV).toBe('production');
    // A per-run signing key, not one committed to the repository.
    expect(result.booted?.JWT_SECRET).toMatch(/^[a-f0-9]{64}$/);
    expect(result.booted?.DATA_DIR).toBeTruthy();
  }, 30_000);
});
