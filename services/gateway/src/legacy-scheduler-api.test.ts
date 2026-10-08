/**
 * File-mode scheduler routes. Stamping a tenant on new jobs made them runnable, and
 * they run as their creator, so the routes must authorize like /api/execute: an
 * operator without a persona's scope could otherwise create and Run Now an HR
 * workflow, run any other operator's job, or PATCH a job's owner and tenant.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ create: vi.fn(async () => ({ id: 'exec-fixture' })), get: vi.fn(() => ({ status: 'completed' })) }));
vi.mock('./persona-api.js', () => ({ createPersonaExecution: mocks.create, getPersonaExecution: mocks.get }));
import type { AuthUser } from './auth.js';
import type { PersonaScope } from './auth.js';
import { isLegacySchedulerWrite, legacySchedulerRequest } from './legacy-scheduler-api.js';
import { Scheduler, type ScheduledJob } from './scheduler.js';

const principal = (id: string, role: AuthUser['role'], personaScopes: PersonaScope[], tenantId = 'tenant-fixture'): AuthUser =>
  ({ id, tenantId, role, personaScopes, name: id, email: `${id}@example.invalid`, teams: [] });
const hrOperator = principal('operator-hr', 'operator', ['hr']);
const marketingOperator = principal('operator-marketing', 'operator', ['marketing']);
const hrJob = { name: 'Weekly JD refresh', skillId: 'hr-001', personaId: 'hr', scheduleType: 'interval', intervalMs: 60_000 };

let scheduler: Scheduler;
let savedTenant: string | undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  mocks.create.mockClear();
  savedTenant = process.env.EAOS_TENANT_ID;
  process.env.EAOS_TENANT_ID = 'tenant-fixture';
  scheduler = new Scheduler();
});
afterEach(() => {
  scheduler.destroy();
  if (savedTenant === undefined) delete process.env.EAOS_TENANT_ID; else process.env.EAOS_TENANT_ID = savedTenant;
  vi.useRealTimers();
});

async function createAs(user: AuthUser, body: Record<string, unknown> = hrJob): Promise<ScheduledJob> {
  const created = await legacySchedulerRequest(scheduler, user, '/api/scheduler/jobs', 'POST', body);
  expect(created.status).toBe(201);
  return (created.data as { job: ScheduledJob }).job;
}

describe('file-mode scheduler persona authorization', () => {
  it('refuses to create a job for a persona the operator is not scoped to', async () => {
    const result = await legacySchedulerRequest(scheduler, marketingOperator, '/api/scheduler/jobs', 'POST', hrJob);
    expect(result.status).toBe(403);
    expect(scheduler.getAllJobs()).toHaveLength(0);
  });

  it('checks the persona the skill executes, not only the requested label', async () => {
    // The scheduler resolves a persona it has no catalog for by scanning every
    // catalog, so a 'ta' label with an HR skill id would execute the HR skill.
    const taOperator = principal('operator-ta', 'operator', ['ta' as PersonaScope]);
    const result = await legacySchedulerRequest(scheduler, taOperator, '/api/scheduler/jobs', 'POST', { ...hrJob, personaId: 'ta' });
    expect(result.status).toBe(403);
    expect(scheduler.getAllJobs()).toHaveLength(0);
  });

  it('lets a scoped operator create and run their own job as themselves', async () => {
    const job = await createAs(hrOperator);
    expect(job).toMatchObject({ tenantId: 'tenant-fixture', createdBy: 'operator-hr' });
    const run = await legacySchedulerRequest(scheduler, hrOperator, `/api/scheduler/jobs/${job.id}/run`, 'POST', {});
    expect(run.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith('tenant-fixture', 'hr', expect.objectContaining({ id: 'hr-001' }), {}, 'operator-hr', undefined);
  });

  it('refuses Run Now once the creator no longer holds the persona', async () => {
    const job = await createAs(hrOperator);
    const narrowed = { ...hrOperator, personaScopes: ['marketing'] as PersonaScope[] };
    const run = await legacySchedulerRequest(scheduler, narrowed, `/api/scheduler/jobs/${job.id}/run`, 'POST', {});
    expect(run.status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe('file-mode scheduler job ownership', () => {
  it("refuses another operator's run, toggle, change and delete", async () => {
    const job = await createAs(hrOperator);
    const other = principal('operator-other', 'operator', ['*']);
    for (const [suffix, method, body] of [['/run', 'POST', {}], ['/toggle', 'POST', {}], ['', 'PATCH', { name: 'taken' }], ['', 'DELETE', {}]] as const) {
      const result = await legacySchedulerRequest(scheduler, other, `/api/scheduler/jobs/${job.id}${suffix}`, method, body);
      expect(result.status, `${method} ${suffix}`).toBe(403);
    }
    expect(mocks.create).not.toHaveBeenCalled();
    expect(scheduler.getJob(job.id)).toMatchObject({ name: hrJob.name, status: 'active' });
  });

  it('lets a tenant admin manage the job but hides it from another tenant', async () => {
    const job = await createAs(hrOperator);
    const foreignAdmin = principal('admin-foreign', 'admin', ['*'], 'tenant-other');
    expect((await legacySchedulerRequest(scheduler, foreignAdmin, `/api/scheduler/jobs/${job.id}/run`, 'POST', {})).status).toBe(404);
    const admin = principal('admin-fixture', 'admin', ['*']);
    expect((await legacySchedulerRequest(scheduler, admin, `/api/scheduler/jobs/${job.id}/toggle`, 'POST', {})).status).toBe(200);
    expect(scheduler.getJob(job.id)!.status).toBe('paused');
  });

  it('refuses a PATCH that rewrites ownership or moves the job to an unscoped persona', async () => {
    const job = await createAs(principal('operator-hr', 'operator', ['hr', 'marketing']));
    for (const field of ['tenantId', 'createdBy', 'id', 'runCount']) {
      const result = await legacySchedulerRequest(scheduler, hrOperator, `/api/scheduler/jobs/${job.id}`, 'PATCH', { [field]: 'tenant-other' });
      expect(result.status, field).toBe(400);
    }
    const creator = principal('operator-hr', 'operator', ['marketing']);
    const marketingJob = await createAs(creator, { name: 'Launch', skillId: 'wf-001', personaId: 'marketing', scheduleType: 'interval', intervalMs: 60_000 });
    const moved = await legacySchedulerRequest(scheduler, creator, `/api/scheduler/jobs/${marketingJob.id}`, 'PATCH', { personaId: 'hr', skillId: 'hr-001' });
    expect(moved.status).toBe(403);
    expect(scheduler.getJob(marketingJob.id)).toMatchObject({ tenantId: 'tenant-fixture', createdBy: 'operator-hr', personaId: 'marketing', skillId: 'wf-001' });
  });

  it('only claims the write routes, leaving reads and events to the gateway', () => {
    expect(isLegacySchedulerWrite('/api/scheduler/jobs', 'POST')).toBe(true);
    expect(isLegacySchedulerWrite('/api/scheduler/jobs/job-1/run', 'POST')).toBe(true);
    expect(isLegacySchedulerWrite('/api/scheduler/jobs/job-1', 'PATCH')).toBe(true);
    expect(isLegacySchedulerWrite('/api/scheduler/jobs/job-1', 'DELETE')).toBe(true);
    expect(isLegacySchedulerWrite('/api/scheduler/jobs', 'GET')).toBe(false);
    expect(isLegacySchedulerWrite('/api/scheduler/jobs/job-1', 'GET')).toBe(false);
    expect(isLegacySchedulerWrite('/api/scheduler/events', 'POST')).toBe(false);
  });
});
