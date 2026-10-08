/**
 * The durable worker loop must keep claiming runs for every tenant:
 *   - a schedule whose dispatch throws used to skip claim() for that tenant and
 *     every tenant after it, on every poll;
 *   - each pass restarted at tenants[0], so one tenant's backlog starved the rest.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./event-bus.js', () => ({ eventBus: { emit: async () => {} } }));
import type { PostgresRunRepository } from '@agentos/db/run-repository';
import { startDurableWorkers, stopWorkers } from './task-worker.js';

type Claim = NonNullable<Awaited<ReturnType<PostgresRunRepository['claim']>>>;
const claimFor = (tenantId: string): Claim => ({ snapshot: { id: `run-${tenantId}` } as Claim['snapshot'], definition: {}, payload: {}, lease: { tenantId, runId: `run-${tenantId}`, workerId: 'fixture', fencingToken: 1, attempt: 1 } });

function repository(claim: (tenantId: string) => Claim | undefined) {
  const claims: string[] = [];
  const fake = {
    claim: vi.fn(async (tenantId: string) => { claims.push(tenantId); return claim(tenantId); }),
    heartbeat: vi.fn(async () => true),
    get: vi.fn(async () => undefined),
    fail: vi.fn(),
    claimEvents: vi.fn(async () => []),
    ackEvent: vi.fn(async () => true),
  };
  return { claims, repository: fake as unknown as PostgresRunRepository };
}

async function until(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Condition was not reached');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

afterEach(async () => { await stopWorkers(); vi.restoreAllMocks(); });

describe('durable worker loop', () => {
  it('still claims runs for a tenant whose schedule dispatch throws, and for the tenants after it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { claims, repository: runs } = repository(() => undefined);
    startDurableWorkers({ repository: runs, workerCount: 1, tenants: async () => ['broken', 'healthy'], execute: async () => {}, deliver: async () => {},
      schedule: async tenantId => { if (tenantId === 'broken') throw new Error('Input artifact is unavailable to this owner'); } });
    await until(() => claims.includes('broken') && claims.includes('healthy'));
  });

  it('reaches a later tenant while the first tenant always has claimable work', async () => {
    const { claims, repository: runs } = repository(tenantId => tenantId === 'busy' ? claimFor(tenantId) : undefined);
    const executed: string[] = [];
    const dispatched: string[] = [];
    startDurableWorkers({ repository: runs, workerCount: 1, tenants: async () => ['busy', 'quiet'], execute: async claim => { executed.push(claim.lease.tenantId); await new Promise(resolve => setTimeout(resolve, 1)); }, deliver: async () => {},
      schedule: async tenantId => { dispatched.push(tenantId); } });
    await until(() => claims.includes('quiet') && dispatched.includes('quiet') && executed.length >= 2);
    expect(executed.every(tenantId => tenantId === 'busy')).toBe(true);
  });
});
