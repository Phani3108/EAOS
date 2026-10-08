/**
 * Schedule admission must not turn the legacy scheduler's `timeout` (how long the
 * old job log waited, UI default 120 s) into the durable attempt deadline: a
 * scheduled multi-step run then failed at 120 s where /api/execute succeeded.
 */

import { describe, expect, it, vi } from 'vitest';
vi.mock('./task-queue.js', () => ({ enqueue: vi.fn(value => value) }));
vi.mock('./event-bus.js', () => ({ eventBus: { emit: async () => {} } }));
vi.mock('./agent-memory.js', () => ({ buildAgentMemoryContext: () => '', extractAndStoreMemory: vi.fn(), initAgentMemory: async () => {} }));
import type { PostgresScheduleRepository, ScheduleInput } from '@agentos/db/schedule-repository';
import type { AuthUser } from './auth.js';
import { scheduleRequest } from './schedule-api.js';

const operator: AuthUser = { id: 'operator-fixture', tenantId: 'tenant-fixture', name: 'Fixture', email: 'fixture@example.invalid', role: 'operator', teams: [], personaScopes: ['*'] };

describe('schedule creation', () => {
  it('leaves the attempt deadline to the runtime default instead of the legacy log-wait timeout', async () => {
    let stored: ScheduleInput | undefined;
    const repository = { create: vi.fn(async (owner: { tenantId: string; userId: string }, data: ScheduleInput) => {
      stored = data;
      return { id: 'schedule-fixture', tenantId: owner.tenantId, userId: owner.userId, status: 'active', version: 1, nextRun: null, data };
    }) } as unknown as PostgresScheduleRepository;
    const result = await scheduleRequest(repository, operator, '/api/scheduler/jobs', 'POST', {
      name: 'Nightly review', skillId: 'eng-007', personaId: 'engineering', scheduleType: 'interval', intervalMs: 60_000,
      inputs: { code_or_module: 'fixture module' }, simulate: true, timeout: 120, retries: 2,
    });
    expect(result.status).toBe(201);
    expect(stored!.template.payload).not.toHaveProperty('timeoutMs');
    expect(stored!.template.payload.maxAttempts).toBe(3);
  });
});
