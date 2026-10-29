/**
 * Cost governance and observability totals must keep counting durable runs
 * after runDurableExecution evicts their working copy. Before the repository
 * aggregate, these totals read the in-process map and dropped to zero in
 * PostgreSQL deployments once each run's lease ended.
 * (tests/m2.integration.test.ts covers the SQL aggregate and the route.)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedSkillDef } from '@agentos/skills/schema';

const mocks = vi.hoisted(() => ({ callLLM: vi.fn(), llm: vi.fn() }));
vi.mock('./llm-provider.js', async importOriginal => ({ ...(await importOriginal<typeof import('./llm-provider.js')>()), callLLM: mocks.callLLM }));
vi.mock('./llm-tracer.js', () => ({ tracedLLMCall: mocks.llm }));
vi.mock('./model-router.js', () => ({ routedLLMCall: mocks.llm, recordCostEntry: vi.fn(), detectComplexity: () => 'simple', BudgetExceededError: class extends Error {}, CircuitOpenError: class extends Error {} }));
vi.mock('./task-queue.js', () => ({ enqueue: vi.fn(value => value) }));
vi.mock('./event-bus.js', () => ({ eventBus: { emit: vi.fn(async () => {}) } }));
vi.mock('./agent-memory.js', () => ({ buildAgentMemoryContext: () => '', extractAndStoreMemory: vi.fn(), initAgentMemory: async () => {} }));
vi.mock('./memory-graph.js', () => ({ memoryGraph: { recordExecution: vi.fn(), buildGraphFromExecution: vi.fn(), updateAgentPerformance: vi.fn()} }));

const tenantId = 'tenant-fixture';
const userId = 'user-fixture';
const definition: UnifiedSkillDef = {
  id: 'fixture-stats', slug: 'fixture-stats', name: 'Fixture', description: 'Fixture', icon: '', persona: 'engineering', executableType: 'skill',
  cluster: 'Fixture', complexity: 'simple', estimatedTime: '', inputs: [], requiredTools: ['Claude'], optionalTools: [], tags: [], outputs: ['result'],
  steps: [{ id: 'result', order: 1, name: 'Result', agent: 'code-reviewer', tool: 'Claude', outputKey: 'result' }],
};

type Snapshot = { id: string; tenantId: string; persona: string; mode: string; status: string; totalTokenCost?: number; avgQualityScore?: number; steps: Array<{ agent?: string; status: string }> };

/**
 * Stands in for PostgresRunRepository: it keeps the last committed snapshot of
 * each run, and stats() reads those snapshots the way the SQL does.
 */
function fakeRepository() {
  const committed = new Map<string, Snapshot>();
  const submitted: Array<{ snapshot: Snapshot; payload: unknown }> = [];
  const commit = async (_lease: unknown, snapshot: Snapshot) => { committed.set(snapshot.id, structuredClone(snapshot)); };
  return {
    committed, submitted,
    submit: vi.fn(async (snapshot: Snapshot, _definition: unknown, payload: unknown) => { committed.set(snapshot.id, structuredClone(snapshot)); submitted.push({ snapshot: structuredClone(snapshot), payload }); return structuredClone(snapshot); }),
    checkpoint: vi.fn(commit),
    park: vi.fn(commit),
    fail: vi.fn(async (_lease: unknown, snapshot: Snapshot) => { const next = { ...structuredClone(snapshot), status: 'failed' }; committed.set(next.id, next); return next; }),
    acquireAgent: vi.fn(async () => true),
    releaseAgent: vi.fn(async () => {}),
    children: vi.fn(async () => []),
    decisions: vi.fn(async () => []),
    stats: vi.fn(async (tenant: string) => {
      const byPersona = new Map<string, { persona: string; count: number; totalCost: number; qualitySum: number; qualityCount: number }>();
      const activeAgents = new Set<string>();
      for (const run of committed.values()) {
        if (run.tenantId !== tenant || run.mode !== 'live') continue;
        const entry = byPersona.get(run.persona) ?? { persona: run.persona, count: 0, totalCost: 0, qualitySum: 0, qualityCount: 0 };
        entry.count++;
        entry.totalCost += run.totalTokenCost ?? 0;
        if (run.avgQualityScore) { entry.qualitySum += run.avgQualityScore; entry.qualityCount++; }
        byPersona.set(run.persona, entry);
        if (run.status === 'running') for (const step of run.steps) if (step.status === 'running' && step.agent) activeAgents.add(step.agent);
      }
      return { byPersona: [...byPersona.values()], activeAgents: [...activeAgents] };
    }),
  };
}

let api: typeof import('./persona-api.js');
let repository: ReturnType<typeof fakeRepository>;

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  mocks.callLLM.mockResolvedValue({ content: 'Fixture output with explicit context, observations, reasoning and recommendations. '.repeat(8), provider: 'anthropic', model: 'claude-sonnet-4-6', cost: 0.0125, inputTokens: 10, outputTokens: 10 });
  api = await import('./persona-api.js');
  repository = fakeRepository();
  api.configureRuntimeRepository(repository as never);
  api.configureUsageRepository({} as never);
});
afterEach(() => { api.configureRuntimeRepository(undefined); api.configureUsageRepository(undefined); });

async function runLiveToCompletion(): Promise<string> {
  // A live run must name a priced model: an unpriced one is refused at submission.
  const record = await api.createPersonaExecution(tenantId, 'engineering', definition, {}, userId, false, undefined, 'anthropic', 'claude-sonnet-4-6');
  const { payload } = repository.submitted.at(-1)!;
  const claim = { lease: { tenantId, runId: record.id, workerId: 'fixture-worker', fencingToken: 1, attempt: 1 }, snapshot: repository.committed.get(record.id), payload };
  await api.runDurableExecution(claim as never, new AbortController().signal);
  return record.id;
}

describe('durable execution totals survive working-copy eviction', () => {
  it('counts a finished live run and its cost after the map entry is gone', async () => {
    const id = await runLiveToCompletion();
    expect(repository.committed.get(id)).toMatchObject({ status: 'completed', mode: 'live' });
    expect(api.getAllExecutions(tenantId)).toEqual([]);

    const stats = await api.getExecutionStats(tenantId);
    expect(repository.stats).toHaveBeenCalledWith(tenantId);
    expect(stats.totalExecutions).toBe(1);
    expect(stats.totalCost).toBeCloseTo(0.0125);
    expect(stats.byPersona.engineering).toMatchObject({ count: 1 });
    expect(stats.byPersona.engineering!.totalCost).toBeCloseTo(0.0125);
    expect(stats.activeAgents).toEqual([]);
  });

  it('folds per-persona rows into totals and a measured-only quality average', async () => {
    repository.stats.mockResolvedValueOnce({
      byPersona: [
        { persona: 'engineering', count: 3, totalCost: 0.3, qualitySum: 16, qualityCount: 2 },
        { persona: 'product', count: 1, totalCost: 0.1, qualitySum: 0, qualityCount: 0 },
      ],
      activeAgents: ['code-reviewer'],
    });
    const stats = await api.getExecutionStats(tenantId);
    expect(stats).toMatchObject({ totalExecutions: 4, avgQuality: 8, activeAgents: ['code-reviewer'] });
    expect(stats.totalCost).toBeCloseTo(0.4);
    expect(stats.byPersona).toEqual({ engineering: { count: 3, totalCost: 0.3, avgQuality: 8 }, product: { count: 1, totalCost: 0.1, avgQuality: 0 } });
  });
});

describe('in-memory mode keeps reading the executions map', () => {
  it('counts live runs held in memory without touching a repository', async () => {
    api.configureRuntimeRepository(undefined);
    await api.createPersonaExecution(tenantId, 'engineering', definition, {}, userId, false, undefined, 'anthropic', 'claude-sonnet-4-6');
    await api.createPersonaExecution(tenantId, 'engineering', definition, {}, userId, true);
    const stats = await api.getExecutionStats(tenantId);
    expect(repository.stats).not.toHaveBeenCalled();
    expect(stats.totalExecutions).toBe(1);
    expect(stats.byPersona.engineering).toMatchObject({ count: 1 });
  });
});
