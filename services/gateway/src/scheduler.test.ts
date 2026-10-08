/**
 * File-mode scheduler ownership. executeJob quarantines any job whose tenant is
 * not this deployment's, but nothing stamped a tenant on new or seeded jobs, so
 * every file-mode schedule failed each firing with "requires review".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(async () => ({ id: 'exec-fixture' })), get: vi.fn(() => ({ status: 'completed' })) }));
vi.mock('./persona-api.js', () => ({ createPersonaExecution: mocks.create, getPersonaExecution: mocks.get }));

let saved: { seed?: string; tenant?: string };
beforeEach(() => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }); vi.resetModules(); mocks.create.mockClear(); saved = { seed: process.env.SEED_DEMO, tenant: process.env.EAOS_TENANT_ID }; process.env.EAOS_TENANT_ID = 'tenant-fixture'; });
afterEach(() => {
  for (const [key, value] of [['SEED_DEMO', saved.seed], ['EAOS_TENANT_ID', saved.tenant]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  vi.useRealTimers();
});

const job = { name: 'Fixture', skillId: 'eng-007', skillName: 'Fixture', personaId: 'engineering', scheduleType: 'interval' as const, intervalMs: 60_000, status: 'active' as const, tags: [], createdBy: 'operator-fixture' };

describe('file-mode scheduler ownership', () => {
  it('runs a job owned by this deployment tenant', async () => {
    const { Scheduler } = await import('./scheduler.js');
    const scheduler = new Scheduler();
    const created = scheduler.createJob({ ...job, tenantId: 'tenant-fixture' });
    const log = await scheduler.executeJob(created.id, 'manual');
    expect(log.status).toBe('success');
    expect(mocks.create).toHaveBeenCalledWith('tenant-fixture', 'engineering', expect.anything(), {}, 'operator-fixture', undefined);
    scheduler.destroy();
  });

  it('keeps a persisted job without a tenant quarantined', async () => {
    const { Scheduler } = await import('./scheduler.js');
    const scheduler = new Scheduler();
    const legacy = scheduler.createJob(job);
    const log = await scheduler.executeJob(legacy.id, 'manual');
    expect(log.error).toMatch(/requires review/);
    expect(mocks.create).not.toHaveBeenCalled();
    scheduler.destroy();
  });

  it('stamps seeded demo jobs with the deployment tenant', async () => {
    process.env.SEED_DEMO = 'true';
    const { Scheduler } = await import('./scheduler.js');
    const scheduler = new Scheduler();
    expect(scheduler.getAllJobs().length).toBeGreaterThan(0);
    expect(scheduler.getAllJobs().every(seeded => seeded.tenantId === 'tenant-fixture')).toBe(true);
    scheduler.destroy();
  });
});
