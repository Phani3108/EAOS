import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedSkillDef } from '@agentos/skills/schema';
const mocks = vi.hoisted(() => ({
  llm: vi.fn(), enqueue: vi.fn(), memory: vi.fn(), emit: vi.fn(async () => {}), approval: vi.fn(),
}));
vi.mock('./llm-tracer.js', () => ({ tracedLLMCall: mocks.llm }));
vi.mock('./task-queue.js', () => ({ enqueue: mocks.enqueue }));
vi.mock('./event-bus.js', () => ({ eventBus: { emit: mocks.emit } }));
vi.mock('./agent-memory.js', () => ({ buildAgentMemoryContext: () => '', extractAndStoreMemory: mocks.memory, initAgentMemory: async () => {} }));
vi.mock('./memory-graph.js', () => ({ memoryGraph: { recordExecution: mocks.memory, buildGraphFromExecution: mocks.memory, updateAgentPerformance: mocks.memory } }));
vi.mock('./approval-bus.js', () => ({ waitForApproval: mocks.approval, approve: vi.fn() }));
vi.mock('./model-router.js', () => ({ routedLLMCall: mocks.llm, recordCostEntry: vi.fn(), detectComplexity: () => 'simple', BudgetExceededError: class extends Error {}, CircuitOpenError: class extends Error {} }));

const definition: UnifiedSkillDef = {
  id: 'fixture-contract', slug: 'fixture-contract', name: 'Fixture', description: 'Fixture', icon: '', persona: 'engineering', executableType: 'skill',
  cluster: 'Fixture', complexity: 'simple', estimatedTime: '', inputs: [], requiredTools: ['Claude'], optionalTools: [], tags: [], outputs: ['first', 'second'],
  steps: [
    { id: 'first', order: 1, name: 'First', agent: 'code-reviewer', tool: 'Claude', outputKey: 'first' },
    { id: 'second', order: 2, name: 'Second', agent: 'code-reviewer', tool: 'Claude', outputKey: 'second' },
  ],
};
let api: typeof import('./persona-api.js');
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  mocks.llm.mockResolvedValue({ content: 'Fixture output with explicit context, observations, reasoning and recommendations. '.repeat(8), provider: 'anthropic', model: 'fixture', cost: 0, inputTokens: 10, outputTokens: 10 });
  mocks.enqueue.mockImplementation(value => value);
  mocks.approval.mockResolvedValue({ approved: false, reason: 'Fixture rejection', decidedAt: new Date().toISOString() });
  api = await import('./persona-api.js');
});
afterEach(() => { vi.useRealTimers(); });

async function start(skill = structuredClone(definition), simulate = false) {
  const run = await api.createPersonaExecution('fixture-tenant', 'engineering', skill, {}, 'fixture-user', simulate, undefined, 'anthropic', 'fixture');
  return { run, work: mocks.enqueue.mock.calls.at(-1)![0].payload };
}

describe('run outcomes remain truthful', () => {
  it('stops downstream work and rejects task delivery after an approval rejection', async () => {
    const skill = structuredClone(definition);
    skill.steps[0]!.requiresApproval = true;
    const { run, work } = await start(skill);
    await expect(api.runSkillExecution(work)).rejects.toMatchObject({ executionStatus: 'rejected', retryable: false });
    expect(run.status).toBe('rejected');
    expect(mocks.llm).toHaveBeenCalledTimes(1);
    expect(run.outputs).not.toHaveProperty('first');
    expect(run.outputs).not.toHaveProperty('second');
  });
  it('rejects delivery when a provider failure is handled by the step loop', async () => {
    mocks.llm.mockRejectedValue(new Error('Fixture failure'));
    const { run, work } = await start();
    await expect(api.runSkillExecution(work)).rejects.toMatchObject({ executionStatus: 'failed' });
    expect(run.status).toBe('failed');
    expect(mocks.llm).toHaveBeenCalledTimes(1);
  });
  it('does not replace a missing tool action with LLM prose', async () => {
    const skill = structuredClone(definition);
    skill.steps[0]!.tool = 'GitHub';
    const { run, work } = await start(skill);
    await expect(api.runSkillExecution(work)).rejects.toMatchObject({ executionStatus: 'unsupported' });
    expect(mocks.llm).not.toHaveBeenCalled();
    expect(run.outputs).toEqual({});
  });
  it('keeps simulation out of live memories and KPIs', async () => {
    vi.useFakeTimers();
    const { run, work } = await start(undefined, true);
    const done = api.runSkillExecution(work);
    await vi.runAllTimersAsync(); await done;
    expect(run.status).toBe('simulated');
    expect(run.mode).toBe('simulation');
    expect(run.steps.every(step => step.provenance === 'simulated')).toBe(true);
    expect(mocks.memory).not.toHaveBeenCalled();
    expect(api.getAgentKPIs()).toEqual([]);
    expect(mocks.llm).not.toHaveBeenCalled();
  });
});
