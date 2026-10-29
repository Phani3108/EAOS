/**
 * After-action reports are scoped like their runs.
 *
 * /api/aar and /api/aar/:id listed and fetched every report in the process,
 * so a role=user key or a public demo visitor read other principals' run ids,
 * costs and step error text. Reads now take the route's run read check.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedSkillDef } from '@agentos/skills/schema';
import type { AuthUser } from './auth.js';
import { canReadStreamResource } from './stream-access.js';

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), noop: vi.fn() }));
vi.mock('./task-queue.js', () => ({ enqueue: mocks.enqueue }));
vi.mock('./event-bus.js', () => ({ eventBus: { emit: vi.fn(async () => {}) } }));
vi.mock('./agent-memory.js', () => ({ buildAgentMemoryContext: () => '', extractAndStoreMemory: mocks.noop, initAgentMemory: async () => {} }));
vi.mock('./memory-graph.js', () => ({ memoryGraph: { recordExecution: mocks.noop, buildGraphFromExecution: mocks.noop, updateAgentPerformance: mocks.noop } }));

const tenantId = 'tenant-fixture';
const definition: UnifiedSkillDef = {
  id: 'fixture-aar', slug: 'fixture-aar', name: 'Fixture', description: 'Fixture', icon: '', persona: 'engineering', executableType: 'skill',
  cluster: 'Fixture', complexity: 'simple', estimatedTime: '', inputs: [], requiredTools: ['Claude'], optionalTools: [], tags: [], outputs: ['result'],
  steps: [{ id: 'draft', order: 1, name: 'Draft', agent: 'code-reviewer', tool: 'Claude', outputKey: 'result' }],
};
const principal = (id: string, role: AuthUser['role'] = 'user'): AuthUser => ({ id, tenantId, name: 'Fixture', email: 'fixture@example.invalid', role, teams: [], personaScopes: ['*'] });
// The ownership half of server.ts canReadExecution; persona scopes are '*' here.
const readableBy = (user: AuthUser) => (owner: { tenantId?: string; userId?: string }) => canReadStreamResource(user, owner);

let api: typeof import('./persona-api.js');
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  mocks.enqueue.mockImplementation(value => value);
  api = await import('./persona-api.js');
});

async function simulatedRun(userId: string) {
  vi.useFakeTimers();
  try {
    const run = await api.createPersonaExecution(tenantId, 'engineering', structuredClone(definition), {}, userId, true);
    const done = api.runSkillExecution(mocks.enqueue.mock.calls.at(-1)![0].payload);
    await vi.runAllTimersAsync(); await done;
    return run;
  } finally { vi.useRealTimers(); }
}

describe('after-action report reads', () => {
  it('shows a report only to principals who may read its run', async () => {
    const mine = await simulatedRun('user-a');
    const theirs = await simulatedRun('user-b');
    const userA = readableBy(principal('user-a'));
    expect(api.getAfterActionReport(mine.id, userA)?.userId).toBe('user-a');
    expect(api.getAfterActionReport(theirs.id, userA)).toBeUndefined();
    expect(api.listAfterActionReports(userA).map(report => report.executionId)).toEqual([mine.id]);
    expect(api.listAfterActionReports(readableBy(principal('operator-fixture', 'operator'))).map(report => report.executionId).sort()).toEqual([mine.id, theirs.id].sort());
    expect(api.listAfterActionReports(readableBy({ ...principal('user-a', 'admin'), tenantId: 'tenant-other' }))).toEqual([]);
  });

  it('resolves reports persisted without an owner through their run, and hides orphans', async () => {
    const run = { id: 'legacy-run', tenantId, userId: 'user-a', persona: 'engineering', skillId: 'fixture-aar', skillName: 'Fixture', status: 'simulated', mode: 'simulation', schemaVersion: 1, inputs: {}, outputs: {}, steps: [], startedAt: new Date(0).toISOString() };
    const report = (executionId: string) => ({ id: `aar-${executionId}`, executionId, persona: 'engineering', skillName: 'Fixture', generatedAt: new Date(0).toISOString(), outcome: 'simulated', totalDurationMs: 0, totalTokenCost: 0, summary: '', agentPerformance: [], handoffChain: [], issues: [], recommendations: [] });
    const rows: Record<string, Record<string, unknown>[]> = { persona_executions: [run], after_action_reports: [report('legacy-run'), report('orphan-run')] };
    await api.initPersonaStore({ all: (table: string) => rows[table] ?? [], get: vi.fn(), insert: vi.fn(), update: vi.fn() } as never);
    expect(api.getAfterActionReport('legacy-run', readableBy(principal('user-a')))).toBeDefined();
    expect(api.getAfterActionReport('legacy-run', readableBy(principal('user-b')))).toBeUndefined();
    expect(api.getAfterActionReport('orphan-run', readableBy(principal('operator-fixture', 'operator')))).toBeUndefined();
  });
});
