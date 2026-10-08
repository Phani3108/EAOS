import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { productionGrants } from './production-grants.js';

async function main() {
  const url = process.env.EAOS_TEST_DATABASE_URL;
  if (!url) throw new Error('EAOS_TEST_DATABASE_URL is required');
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/eaos_m2_fixture') throw new Error('Use a disposable local eaos_m2_fixture database');
  process.env.DATABASE_URL = url;
  const { getRawPool } = await import('../packages/db/dist/postgres-store.js');
  const { runMigrations } = await import('../packages/db/dist/migrate.js');
  const { PostgresRunRepository } = await import('../packages/db/dist/run-repository.js');
  const pool = await getRawPool() as any;
  let gateway: ChildProcess | undefined;
  const stopGateway = async (crash = false) => {
    if (!gateway || gateway.exitCode !== null || gateway.signalCode !== null) return;
    const exited = once(gateway, 'exit');
    gateway.kill(crash ? 'SIGKILL' : 'SIGTERM');
    await Promise.race([exited, delay(16_000)]);
    if (gateway.exitCode === null && gateway.signalCode === null) { gateway.kill('SIGKILL'); await exited; }
  };
  try {
    await runMigrations(pool);
    const role = 'eaos_m2_app';
    if (!(await pool.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rows.length) await pool.query(`CREATE ROLE ${role} NOLOGIN`);
    // Exactly the grants production gives the gateway's login, not blanket table
    // access, so a table the gateway needs but the grant script misses fails here.
    for (const grant of productionGrants(role)) await pool.query(grant);
    const appUrl = new URL(url);
    appUrl.searchParams.set('options', `-c role=${role}`);
    const scopedPool = {
      connect: async () => {
        const client = await pool.connect();
        return {
          query: async (sql: string, values?: unknown[]) => {
            const result = await client.query(sql, values);
            if (sql === 'BEGIN') await client.query(`SET LOCAL ROLE ${role}`);
            return result;
          }, release: () => client.release(),
        };
      },
    };
    const repository = new PostgresRunRepository(scopedPool);
    const suffix = randomUUID();
    const a = `fixture-a-${suffix}`, b = `fixture-b-${suffix}`;
    for (const tenant of [a, b]) {
      await pool.query('INSERT INTO tenants (id,name) VALUES ($1,$2)', [tenant, 'M2 fixture']);
      await pool.query("INSERT INTO users (id,email,name,role,tenant_id) VALUES ($1,$2,'Fixture','user',$3)", [`user-${tenant}`, `${tenant}@example.invalid`, tenant]);
    }
    const { verifyChildLifecycle } = await import('./m3.lifecycle-contract.js');
    await verifyChildLifecycle(repository, a, b);
    const { verifyWorkspaceStorage } = await import('./m2.storage-contract.js');
    await verifyWorkspaceStorage(scopedPool, a, b);
    const { verifyIntegrationEvidence } = await import('./m4.integration-contract.js');
    await verifyIntegrationEvidence(scopedPool, repository, a, b);
    const reviewerId = `reviewer-${a}`;
    await pool.query("INSERT INTO users (id,email,name,role,tenant_id) VALUES ($1,$2,'Platform Reviewer','operator',$3)", [reviewerId, `${reviewerId}@example.invalid`, a]);
    const { verifyConnectorRegistry } = await import('./m7.connector-contract.js');
    await verifyConnectorRegistry(scopedPool, a, b, reviewerId);
    const { verifyPlatformGovernance } = await import('./m6.platform-contract.js');
    await verifyPlatformGovernance(scopedPool, repository, a, b, reviewerId);
    const definition = { id: 'fixture', version: '1.0.0', definitionHash: 'a'.repeat(64), steps: [{ id: 'step', outputKey: 'result' }] };
    const snapshot = (tenant: string) => ({
      id: randomUUID(), tenantId: tenant, userId: `user-${tenant}`, persona: 'engineering', skillId: 'fixture', skillName: 'Fixture',
      status: 'queued', mode: 'simulation', schemaVersion: 1, definitionHash: definition.definitionHash, definitionVersion: '1.0.0',
      inputs: {}, outputs: {}, steps: [{ stepId: 'step', agent: 'code-reviewer', stepName: 'Fixture', outputKey: 'result', status: 'pending', provenance: 'none' }],
      startedAt: new Date().toISOString(),
    });
    const { verifyScheduleStorage } = await import('./m2.storage-contract.js');
    await verifyScheduleStorage(scopedPool, repository, snapshot(a) as any, definition);
    {
      const { PostgresScheduleRepository } = await import('../packages/db/dist/schedule-repository.js');
      const schedules = new PostgresScheduleRepository(scopedPool, repository);
      const owner = { tenantId: a, userId: `user-${a}` };
      const receipts = async (id: string) => Number((await pool.query('SELECT count(*) AS total FROM runtime_trigger_receipts WHERE tenant_id=$1 AND source_id=$2', [a, id])).rows[0].total);
      // A schedule whose admission keeps failing is parked as failed with its reason, instead of staying due and failing every poll.
      const missingArtifact = { ...snapshot(a), inputs: { attachment: { artifactId: `artifact-missing-${suffix}` } } };
      const broken = await schedules.create(owner, { name: 'Fixture broken', scheduleType: 'interval', intervalMs: 60_000, nextRunAt: '2020-01-01T00:00:00Z', template: { snapshot: missingArtifact as any, definition, payload: {} } });
      const healthy = await schedules.create(owner, { name: 'Fixture healthy', scheduleType: 'interval', intervalMs: 60_000, nextRunAt: '2020-01-02T00:00:00Z', template: { snapshot: snapshot(a) as any, definition, payload: {} } });
      assert.equal(await schedules.dispatchDue(a), undefined);
      const parked = (await schedules.get(owner, broken.id))!;
      assert.equal(parked.status, 'failed');
      assert.match(parked.data.lastError ?? '', /Input artifact is unavailable/);
      assert.equal(parked.nextRun, broken.nextRun);
      assert.equal(await receipts(broken.id), 0);
      const healthyRun = await schedules.dispatchDue(a);
      assert.ok(healthyRun);
      // Advancing to the next occurrence is not an operator edit, so the operator's version still pauses it.
      const advanced = (await schedules.get(owner, healthy.id))!;
      assert.equal(advanced.version, healthy.version);
      assert.ok(new Date(advanced.nextRun!).getTime() > Date.now());
      assert.equal((await schedules.setStatus(owner, healthy.id, 'paused', healthy.version))?.status, 'paused');
      await repository.cancel(a, healthyRun, owner.userId);
      // A failure after admission (no next cron occurrence) also undoes that occurrence's run.
      const horizon = await schedules.create(owner, { name: 'Fixture horizon', scheduleType: 'cron', cronExpression: '* * * * *', template: { snapshot: snapshot(a) as any, definition, payload: {} } });
      await pool.query(`UPDATE runtime_schedules SET next_run_at='2020-01-01T00:00:00Z',data=jsonb_set(data,'{cronExpression}','"0 0 30 2 *"') WHERE tenant_id=$1 AND id=$2`, [a, horizon.id]);
      assert.equal(await schedules.dispatchDue(a), undefined);
      assert.equal((await schedules.get(owner, horizon.id))?.status, 'failed');
      assert.equal(await receipts(horizon.id), 0);
      assert.equal(await schedules.dispatchDue(a), undefined);
      // Stored templates lose the legacy log-wait timeout that capped every scheduled attempt at 120 s.
      const legacy = await schedules.create(owner, { name: 'Fixture legacy timeout', scheduleType: 'event', eventTrigger: 'fixture.legacy', template: { snapshot: snapshot(a) as any, definition, payload: { timeoutMs: 120_000, maxAttempts: 3 } } });
      await pool.query("DELETE FROM eaos_schema_migrations WHERE name='026_schedule_attempt_deadline.sql'");
      await runMigrations(pool);
      assert.deepEqual((await schedules.get(owner, legacy.id))?.data.template.payload, { maxAttempts: 3 });
      await schedules.setStatus(owner, legacy.id, 'paused', legacy.version);
      console.log('PASS failing schedules park with their reason, dispatch keeps the operator version, legacy schedule deadlines are dropped');
    }
    const capacityRuns = [snapshot(a), snapshot(a), snapshot(a)];
    const capacityClaims = [];
    for (const run of capacityRuns) { await repository.submit(run as any, definition, {}); capacityClaims.push((await repository.claim(a, `capacity-${run.id}`))!); }
    assert.equal(await repository.acquireAgent(capacityClaims[0]!.lease, 'step', 'code-reviewer', 2, 8), true);
    assert.equal(await repository.acquireAgent(capacityClaims[1]!.lease, 'step', 'code-reviewer', 2, 8), true);
    assert.equal(await repository.acquireAgent(capacityClaims[2]!.lease, 'step', 'code-reviewer', 2, 8), false);
    await repository.releaseAgent(capacityClaims[0]!.lease, 'step');
    assert.equal(await repository.acquireAgent(capacityClaims[2]!.lease, 'step', 'code-reviewer', 2, 8), true);
    for (const run of capacityRuns) await repository.cancel(a, run.id, run.userId);
    const rollbackRun = snapshot(a);
    const failing = new PostgresRunRepository({ connect: async () => {
      const client = await scopedPool.connect();
      return { ...client, query: async (sql: string, values?: unknown[]) => {
        if (sql.startsWith('INSERT INTO runtime_jobs')) throw new Error('Fixture transaction failure');
        return client.query(sql, values);
      } };
    } });
    await assert.rejects(failing.submit(rollbackRun as any, definition, {}));
    assert.equal(await repository.get(a, rollbackRun.id), undefined);
    const first = snapshot(a);
    const accepted = await repository.submit(first as any, definition, { fixture: true }, 'same-request');
    const duplicate = await repository.submit(snapshot(a) as any, definition, { fixture: true }, 'same-request');
    assert.equal(duplicate.id, accepted.id);
    assert.equal(await repository.get(b, accepted.id), undefined);
    await assert.rejects(repository.submit({ ...snapshot(a), inputs: { changed: true } } as any, definition, {}, 'same-request'));
    const claims = await Promise.all([repository.claim(a, 'worker-one'), repository.claim(a, 'worker-two')]);
    assert.equal(claims.filter(Boolean).length, 1);
    const claim = claims.find(Boolean)!;
    assert.equal(await repository.heartbeat(claim.lease), true);
    await pool.query("UPDATE runtime_jobs SET lease_until=NOW()-INTERVAL '1 second' WHERE tenant_id=$1 AND run_id=$2", [a, first.id]);
    const recovered = await repository.claim(a, 'replacement-worker');
    assert.ok(recovered);
    assert.ok(recovered.lease.fencingToken > claim.lease.fencingToken);
    await assert.rejects(repository.checkpoint(claim.lease, { ...first, status: 'completed' } as any));
    await repository.checkpoint(recovered.lease, { ...first, status: 'simulated', outputs: { result: 'fixture' }, steps: [{ ...first.steps[0], status: 'simulated', provenance: 'simulated' }] } as any);
    assert.equal((await repository.get(a, first.id))?.status, 'simulated');
    assert.equal((await new PostgresRunRepository(scopedPool).get(a, first.id))?.status, 'simulated');
    console.log('PASS tenant isolation, idempotent admission, concurrent claims, lease recovery, stale fencing and restart reads');

    const { PostgresWorkspaceRepository } = await import('../packages/db/dist/workspace-repository.js');
    const workspace = new PostgresWorkspaceRepository(scopedPool);
    const usageRun = { ...snapshot(a), mode: 'live' };
    await repository.submit(usageRun as any, definition, {});
    const usageOwner = { tenantId: a, userId: usageRun.userId };
    const delivery = await workspace.createDelivery(usageOwner, usageRun.id, 'github', 'fixture-delivery', { subject: 'Fixture' });
    assert.equal(delivery.status, 'unsupported');
    assert.equal((await workspace.createDelivery(usageOwner, usageRun.id, 'github', 'fixture-delivery', { subject: 'Fixture' })).id, delivery.id);
    await assert.rejects(workspace.createDelivery({ tenantId: b, userId: `user-${b}` }, usageRun.id, 'github', 'foreign-delivery', {}));
    assert.equal((await workspace.listDeliveries({ tenantId: b, userId: `user-${b}` })).length, 0);
    await workspace.setUsageBudget(usageOwner, 1000);
    const reservations = await Promise.allSettled([1, 2].map(attempt => workspace.reserveUsage(usageOwner, usageRun.id, 'step', attempt, 700)));
    assert.equal(reservations.filter(result => result.status === 'fulfilled').length, 1);
    const reservation = reservations.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<string>;
    await assert.rejects(workspace.settleUsage({ tenantId: b, userId: `user-${b}` }, reservation.value, 250));
    await workspace.settleUsage(usageOwner, reservation.value, 250);
    await workspace.settleUsage(usageOwner, reservation.value, 250);
    assert.equal((await workspace.usage(usageOwner)).spentMicros, 250);
    assert.equal((await workspace.usage(usageOwner)).reservedMicros, 0);
    await assert.rejects(workspace.settleUsage(usageOwner, reservation.value, 251));
    // A refused provider attempt's reservation goes back to the budget rather than holding it forever.
    const refused = await workspace.reserveUsage(usageOwner, usageRun.id, 'step', 3, 700);
    await assert.rejects(workspace.reserveUsage(usageOwner, usageRun.id, 'step', 4, 700));
    await assert.rejects(workspace.releaseUsage({ tenantId: b, userId: `user-${b}` }, refused));
    await workspace.releaseUsage(usageOwner, refused);
    await workspace.releaseUsage(usageOwner, refused);
    assert.equal((await workspace.usage(usageOwner)).reservedMicros, 0);
    await assert.rejects(workspace.settleUsage(usageOwner, refused, 0));
    await assert.rejects(workspace.releaseUsage(usageOwner, reservation.value));
    await workspace.settleUsage(usageOwner, await workspace.reserveUsage(usageOwner, usageRun.id, 'step', 5, 700), 0);
    assert.deepEqual(await workspace.usage(usageOwner), { reservedMicros: 0, spentMicros: 250, limitMicros: 1000 });
    await repository.cancel(a, usageRun.id, usageRun.userId);

    const cancelled = snapshot(b);
    await repository.submit(cancelled as any, definition, {});
    const cancelClaim = await repository.claim(b, 'cancel-worker');
    assert.ok(cancelClaim);
    await repository.cancel(b, cancelled.id, cancelled.userId);
    await assert.rejects(repository.checkpoint(cancelClaim.lease, { ...cancelled, status: 'completed' } as any));
    assert.equal((await repository.get(b, cancelled.id))?.status, 'cancelled');
    assert.equal(await repository.heartbeat(cancelClaim.lease), false);

    const retrying = snapshot(b);
    await repository.submit(retrying as any, definition, {});
    const retryLease = await repository.claim(b, 'retry-worker');
    assert.ok(retryLease);
    await repository.fail(retryLease.lease, { ...retrying, status: 'failed' } as any, 'Fixture transient failure', true);
    assert.equal(await repository.claim(b, 'early-worker'), undefined);
    await pool.query("UPDATE runtime_jobs SET available_at=NOW()-INTERVAL '1 second' WHERE tenant_id=$1 AND run_id=$2", [b, retrying.id]);
    const nextAttempt = await repository.claim(b, 'next-worker');
    assert.ok(nextAttempt);
    assert.ok(nextAttempt.lease.attempt > retryLease.lease.attempt);
    await repository.fail(nextAttempt.lease, { ...retrying, status: 'failed' } as any, 'Fixture terminal failure', false);
    assert.equal((await repository.get(b, retrying.id))?.status, 'failed');

    const deadlineRun = snapshot(b);
    await repository.submit(deadlineRun as any, definition, { timeoutMs: 1000, maxAttempts: 1 });
    const deadlineClaim = await repository.claim(b, 'deadline-worker');
    assert.ok(deadlineClaim?.lease.deadlineAt);
    await pool.query("UPDATE runtime_jobs SET deadline_at=NOW()-INTERVAL '1 second' WHERE tenant_id=$1 AND run_id=$2", [b, deadlineRun.id]);
    assert.equal(await repository.heartbeat(deadlineClaim.lease), false);
    await assert.rejects(repository.checkpoint(deadlineClaim.lease, { ...deadlineRun, status: 'simulated' } as any));
    await repository.claim(b, 'deadline-sweeper');
    assert.equal((await repository.get(b, deadlineRun.id))?.status, 'failed');
    // A worker that dies on its last lease attempt mid-effect: the sweep closes the run as completely as a deadline does.
    const exhausted = { ...snapshot(b), mode: 'live', steps: [{ ...snapshot(b).steps[0], kind: 'tool_effect' }] };
    await repository.submit(exhausted as any, definition, { maxAttempts: 1 });
    const exhaustedClaim = (await repository.claim(b, 'crashing-worker'))!;
    await repository.checkpoint(exhaustedClaim.lease, { ...exhausted, status: 'running', steps: [{ ...exhausted.steps[0], status: 'running' }] } as any);
    await pool.query("UPDATE runtime_jobs SET lease_until=NOW()-INTERVAL '1 second' WHERE tenant_id=$1 AND run_id=$2", [b, exhausted.id]);
    assert.equal(await repository.claim(b, 'exhausted-sweeper'), undefined);
    const closed = (await repository.get(b, exhausted.id))!;
    assert.equal(closed.status, 'inconclusive');
    assert.deepEqual(closed.steps.map(step => [step.status, step.error]), [['inconclusive', 'Lease retries exhausted']]);
    assert.equal((await pool.query("SELECT status FROM runtime_attempts WHERE tenant_id=$1 AND run_id=$2", [b, exhausted.id])).rows.map((row: { status: string }) => row.status).join(), 'expired');
    assert.equal((await pool.query("SELECT count(*) AS open FROM runtime_step_attempts WHERE tenant_id=$1 AND run_id=$2 AND finished_at IS NULL", [b, exhausted.id])).rows[0].open, '0');
    assert.equal((await pool.query("SELECT status FROM runtime_steps WHERE tenant_id=$1 AND run_id=$2", [b, exhausted.id])).rows[0].status, 'inconclusive');
    assert.equal((await pool.query("SELECT count(*) AS total FROM runtime_events WHERE tenant_id=$1 AND run_id=$2 AND type='execution.inconclusive'", [b, exhausted.id])).rows[0].total, '1');

    const awaiting = snapshot(a);
    await repository.submit(awaiting as any, definition, {});
    const approvalClaim = await repository.claim(a, 'approval-worker');
    assert.ok(approvalClaim);
    await repository.pause(approvalClaim.lease, { ...awaiting, status: 'paused', steps: [{ ...awaiting.steps[0], status: 'approval_required', draftOutput: 'fixture draft' }] } as any, 'step');
    assert.equal(await repository.claim(a, 'available-worker'), undefined);
    await repository.decide(a, awaiting.id, 'step', 'fixture-operator', false, 'Fixture rejection');
    assert.equal((await repository.get(a, awaiting.id))?.status, 'rejected');
    await assert.rejects(repository.decide(a, awaiting.id, 'step', 'fixture-operator', true));
    assert.equal(await repository.get(b, awaiting.id), undefined);
    const expiring = snapshot(a);
    await repository.submit(expiring as any, definition, {});
    const expiryClaim = await repository.claim(a, 'expiry-worker');
    assert.ok(expiryClaim);
    await repository.pause(expiryClaim.lease, { ...expiring, status: 'paused', steps: [{ ...expiring.steps[0], status: 'approval_required', draftOutput: 'fixture' }] } as any, 'step');
    await pool.query("UPDATE runtime_approvals SET expires_at=NOW()-INTERVAL '1 second' WHERE tenant_id=$1 AND run_id=$2", [a, expiring.id]);
    assert.equal(await repository.claim(a, 'expiry-sweeper'), undefined);
    assert.equal((await repository.get(a, expiring.id))?.status, 'rejected');
    const events = await repository.claimEvents(a, 'event-worker');
    assert.ok(events.length > 0);
    assert.ok(events.every(event => event.tenantId === a));
    for (const event of events) assert.equal(await repository.ackEvent(event, 'event-worker'), true);
    assert.equal((await repository.claimEvents(a, 'event-worker')).length, 0);
    console.log('PASS durable cancellation, worker-free approval wait, rejection persistence and tenant-scoped outbox');

    const { compileDefinition } = await import('../services/gateway/dist/definition-registry.js');
    const reviewDefinition = compileDefinition({
      id: 'fixture-approval', slug: 'fixture-approval', name: 'Fixture approval', description: 'Fixture', icon: '', persona: 'engineering',
      executableType: 'skill', cluster: 'Fixture', complexity: 'simple', estimatedTime: '', inputs: [], outputs: ['result'], requiredTools: ['Claude'], optionalTools: [], tags: [],
      steps: [{ id: 'step', order: 1, name: 'Review fixture', agent: 'code-reviewer', tool: 'Claude', outputKey: 'result', requiresApproval: true }],
    });
    const resuming = { ...snapshot(a), mode: 'live', definitionHash: reviewDefinition.definitionHash, skillId: reviewDefinition.id,
      steps: [{ stepId: 'step', stepName: 'Review fixture', agent: 'code-reviewer', tool: 'llm', kind: 'llm', outputKey: 'result', status: 'pending', provenance: 'none' }],
    };
    await repository.submit(resuming as any, { ...reviewDefinition }, { execId: resuming.id, tenantId: a, userId: resuming.userId, persona: 'engineering', skill: reviewDefinition, inputs: {}, simulate: false });
    const resumeClaim = await repository.claim(a, 'prepare-approval');
    assert.ok(resumeClaim);
    await repository.pause(resumeClaim.lease, { ...resuming, status: 'paused', steps: [{ ...resuming.steps[0], status: 'approval_required', draftOutput: 'Fixture approved output' }] } as any, 'step');
    const uncertain = { ...snapshot(b), mode: 'live', steps: [{ ...snapshot(b).steps[0], kind: 'tool_effect' }] };
    await repository.submit(uncertain as any, definition, {});
    const effectLease = await repository.claim(b, 'interrupted-effect');
    assert.ok(effectLease);
    await repository.checkpoint(effectLease.lease, { ...uncertain, status: 'running', steps: [{ ...uncertain.steps[0], status: 'running' }] } as any);
    await pool.query("UPDATE runtime_jobs SET lease_until=NOW()-INTERVAL '1 second' WHERE tenant_id=$1 AND run_id=$2", [b, uncertain.id]);
    const { seedRuntimeGraph, verifyRuntimeGraph } = await import('./m3.runtime-contract.js');
    const graphRun = await seedRuntimeGraph(repository, a, `user-${a}`);
    const secret = 'm2-fixture-signing-key-not-for-production';
    const token = (tenant: string, role = 'admin') => {
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const input = `${encode({ alg: 'HS256' })}.${encode({ sub: `user-${tenant}`, tenantId: tenant, role, personaScopes: ['*'], iss: 'eaos', aud: 'eaos-api', exp: Math.floor(Date.now() / 1000) + 600 })}`;
      return `${input}.${createHmac('sha256', secret).update(input).digest('base64url')}`;
    };
    const base = 'http://127.0.0.1:32299';
    const startGateway = async (databaseUrl = appUrl.toString(), providerUrl?: string) => {
      gateway = spawn(process.execPath, [resolve('services/gateway/dist/server.js')], { env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: '32299', DATABASE_URL: databaseUrl, JWT_SECRET: secret, EAOS_TENANT_ID: 'default', SEED_DEMO: 'false', REDIS_URL: 'redis://127.0.0.1:1', OTEL_SDK_DISABLED: 'true', EAOS_MCP_CONFIG: '/dev/null/mcp.json', ...(providerUrl ? { OLLAMA_BASE_URL: providerUrl, OLLAMA_MODEL: 'llama3.2' } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      gateway.stdout?.on('data', value => { output += value.toString(); });
      gateway.stderr?.on('data', value => { output += value.toString(); });
      for (let i = 0; i < 100; i++) {
        if (gateway.exitCode !== null) throw new Error('Fixture gateway exited before readiness');
        if (output.includes('EOS Gateway — Enterprise OS API')) return;
        await delay(100);
      }
      throw new Error('Fixture gateway did not start');
    };
    const startReplica = async (providerUrl: string) => {
      const replica = spawn(process.execPath, [resolve('services/gateway/dist/server.js')], { env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: '32301', DATABASE_URL: appUrl.toString(), JWT_SECRET: secret, EAOS_TENANT_ID: 'default', SEED_DEMO: 'false', REDIS_URL: 'redis://127.0.0.1:1', OTEL_SDK_DISABLED: 'true', EAOS_MCP_CONFIG: '/dev/null/mcp.json', OLLAMA_BASE_URL: providerUrl, OLLAMA_MODEL: 'llama3.2' }, stdio: ['ignore','pipe','pipe'] });
      const stop = async () => { if (replica.exitCode !== null || replica.signalCode !== null) return; const ended = once(replica, 'exit'); replica.kill('SIGTERM'); await ended; };
      let ready = false;
      replica.stdout.on('data', value => { if (value.toString().includes('EOS Gateway — Enterprise OS API')) ready = true; });
      replica.stderr.resume();
      for (let i = 0; i < 100 && !ready && replica.exitCode === null; i++) await delay(100);
      if (!ready) { await stop(); throw new Error('Second fixture gateway did not start'); }
      return stop;
    };
    const request = async (tenant: string, path: string, body?: unknown, headers = {}) => {
      const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token(tenant)}`, 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
      return { status: response.status, data: await response.json() };
    };
    const waitStatus = async (tenant: string, id: string, status: string) => {
      let last: any;
      for (let i = 0; i < 200; i++) {
        const result = await request(tenant, `/api/executions/${id}`);
        last = result.data.execution ?? result.data;
        if (result.status === 200 && last.status === status) return last;
        await delay(100);
      }
      throw new Error(`Fixture ${id} did not reach ${status}: ${JSON.stringify({ status: last?.status, error: last?.error, steps: last?.steps?.filter((step: { error?: string }) => step.error).map((step: any) => ({ id: step.stepId, error: step.error })) })}`);
    };
    await startGateway();
    await waitStatus(b, uncertain.id, 'inconclusive');
    await waitStatus(a, graphRun, 'completed');
    await verifyRuntimeGraph(repository, a, graphRun);
    const body = { persona: 'engineering', skillId: 'eng-007', inputs: { code_or_module: 'fixture content' }, simulate: true };
    const submittedA = await request(a, '/api/execute', body, { 'Idempotency-Key': 'http-fixture' });
    assert.equal(submittedA.status, 201);
    const submittedB = await request(b, '/api/execute', body, { 'Idempotency-Key': 'http-fixture' });
    assert.equal(submittedB.status, 201);
    assert.notEqual(submittedA.data.execution.id, submittedB.data.execution.id);
    const schedule = await request(a, '/api/scheduler/jobs', { name: 'HTTP schedule', personaId: 'engineering', skillId: 'eng-007', scheduleType: 'event', eventTrigger: 'fixture.event', inputs: body.inputs, simulate: true });
    assert.equal(schedule.status, 201);
    assert.equal((await request(b, `/api/scheduler/jobs/${schedule.data.job.id}`)).status, 404);
    const triggered = await request(a, `/api/scheduler/jobs/${schedule.data.job.id}/run`, { deliveryId: 'http-delivery' });
    assert.equal(triggered.status, 201);
    assert.equal((await request(a, `/api/scheduler/jobs/${schedule.data.job.id}/run`, { deliveryId: 'http-delivery' })).data.executionId, triggered.data.executionId);
    await waitStatus(a, triggered.data.executionId, 'simulated');
    assert.equal((await request(a, '/api/execute', body, { 'Idempotency-Key': 'http-fixture' })).data.execution.id, submittedA.data.execution.id);
    await waitStatus(a, submittedA.data.execution.id, 'simulated');
    await waitStatus(b, submittedB.data.execution.id, 'simulated');
    assert.equal((await request(b, `/api/executions/${submittedA.data.execution.id}`)).status, 404);
    assert.equal((await request(a, '/api/notifications/channels')).status, 200);
    const document = await request(a, '/api/knowledge/documents', { title: 'HTTP fixture', content: 'Tenant A only' });
    assert.equal(document.status, 201);
    const documentId = document.data.document.id;
    assert.equal((await request(b, `/api/knowledge/documents/${documentId}`)).status, 404);
    assert.equal((await request(a, '/api/connections/github/connect', { credentials: { token: 'fixture-not-a-real-token' } })).status, 400);
    const chat = await request(a, '/api/chat/sessions', { title: 'HTTP chat fixture', persona: 'engineering' });
    assert.equal(chat.status, 201);
    assert.equal((await request(b, `/api/chat/sessions/${chat.data.session.sessionId}`)).status, 404);
    const chatSubmission = await request(a, `/api/chat/sessions/${chat.data.session.sessionId}/messages`, { content: 'Fixture message' });
    assert.equal(chatSubmission.status, 200);
    assert.ok(chatSubmission.data.executionId);
    // No LLM provider is configured on this gateway, and chat offers no run-mode
    // choice, so the message is a labelled simulation rather than a live run that fails.
    await waitStatus(a, chatSubmission.data.executionId, 'simulated');
    assert.equal((await request(a, `/api/chat/sessions/${chat.data.session.sessionId}`)).data.messages.length, 2);
    assert.ok((await request(a, '/api/executions')).data.executions.every((run: any) => run.tenantId === a));
    await stopGateway();
    await startGateway();
    assert.equal((await request(a, `/api/executions/${submittedA.data.execution.id}`)).data.execution.status, 'simulated');
    assert.equal((await request(a, `/api/knowledge/documents/${documentId}`)).data.document.content, 'Tenant A only');
    assert.equal((await request(a, `/api/chat/sessions/${chat.data.session.sessionId}`)).data.messages.length, 2);
    const stepHistory = await repository.trace(a, submittedA.data.execution.id);
    assert.equal(stepHistory.attempts.length, 3);
    assert.equal(stepHistory.artifacts.length, 3);
    assert.ok(stepHistory.lineage.length >= 2);
    assert.equal((await repository.trace(b, submittedA.data.execution.id)).attempts.length, 0);
    assert.equal((await request(a, `/api/executions/${resuming.id}`)).data.execution.status, 'paused');
    assert.equal((await request(b, `/api/executions/${resuming.id}/approve/step`, {})).status, 404);
    assert.equal((await request(a, `/api/executions/${resuming.id}/approve/step`, {})).status, 200);
    const resumed = await waitStatus(a, resuming.id, 'completed');
    assert.equal(resumed.outputs.result, 'Fixture approved output');
    console.log('PASS compiled gateway two-tenant execution, idempotency, quarantine, restart reads and approval continuation without re-running the provider');
    const { verifyOperatingApi } = await import('./m6.operations-contract.js');
    await verifyOperatingApi({ base, tenantId: a, foreignTenant: b, token: token(a), request, waitStatus, sourceRunId: submittedA.data.execution.id });
    const { verifyEntrypointParity } = await import('./m3.entrypoint-contract.js');
    await verifyEntrypointParity({ runs: repository, tenantId: a, foreignTenant: b, request, waitStatus });
    const { verifyWorkflowClients } = await import('./m3.client-contract.js');
    await verifyWorkflowClients({ base, tenantId: a, headers: async () => ({ Authorization: `Bearer ${token(a)}` }), waitStatus });
    const { verifyCatalogCertification } = await import('./m5.certification-contract.js');
    await verifyCatalogCertification({ tenantId: a, runs: repository, request, waitStatus });
    const { verifyParallelRuntime } = await import('./m3.parallel-contract.js');
    await verifyParallelRuntime({ runs: repository, pool, tenantId: a, foreignTenant: b, start: providerUrl => startGateway(appUrl.toString(), providerUrl), startReplica, stop: stopGateway, request, waitStatus });
    await stopGateway();
    await startGateway(url);
    assert.equal((await fetch(`${base}/api/live`)).status, 200);
    assert.equal((await fetch(`${base}/api/ready`)).status, 503);
    assert.equal((await request(a, '/api/execute', body)).status, 503);
    await stopGateway();
    await startGateway('postgresql://fixture:fixture@127.0.0.1:1/eaos_m2_fixture');
    assert.equal((await fetch(`${base}/api/live`)).status, 200);
    assert.equal((await fetch(`${base}/api/ready`)).status, 503);
    assert.equal((await request(a, '/api/execute', body)).status, 503);
    console.log('PASS unavailable storage blocks work while liveness remains available');
  } finally { await stopGateway(); await pool.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'M2 acceptance failed'); process.exitCode = 1; });
