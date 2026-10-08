/**
 * In durable mode the in-process executions map is only the working copy of a
 * run this replica holds a lease on. Submissions and finished claims used to
 * stay cached forever, so heap grew with every run the replica ever touched.
 * (tests/m4.integration-contract.ts covers full runs against PostgreSQL.)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./task-queue.js', () => ({ enqueue: vi.fn(value => value) }));
vi.mock('./event-bus.js', () => ({ eventBus: { emit: vi.fn(async () => {}) } }));
vi.mock('./agent-memory.js', () => ({ buildAgentMemoryContext: () => '', extractAndStoreMemory: vi.fn(), initAgentMemory: async () => {} }));

const tenantId = 'tenant-fixture';
const userId = 'user-fixture';
const inputs = { code_or_module: 'fixture module' };

let api: typeof import('./persona-api.js');
let eng007: import('./definition-registry.js').CompiledDefinition;
const submit = vi.fn(async (snapshot: Record<string, unknown>) => structuredClone(snapshot));
const checkpoint = vi.fn(async () => {});

beforeEach(async () => {
  vi.resetModules();
  api = await import('./persona-api.js');
  eng007 = (await import('./definition-registry.js')).getCompiledDefinition('eng-007', 'engineering')!;
  api.configureRuntimeRepository({ submit, checkpoint } as never);
});
afterEach(() => api.configureRuntimeRepository(undefined));

describe('durable mode executions map', () => {
  it('does not cache a submitted run', async () => {
    const record = await api.createPersonaExecution(tenantId, 'engineering', eng007, inputs, userId, true);
    expect(submit).toHaveBeenCalledOnce();
    expect(record.tenantId).toBe(tenantId);
    expect(api.getAllExecutions(tenantId)).toEqual([]);
  });

  it('drops the claimed snapshot when the run ends, even when it throws', async () => {
    const { exec, payload } = api.preparePersonaExecution(tenantId, 'engineering', eng007, inputs, userId, true);
    // A snapshot whose definition does not match the payload is refused inside runSkillExecution.
    const claim = { lease: { id: 'lease-fixture' }, snapshot: { ...exec, definitionHash: 'f'.repeat(64) }, payload };
    await expect(api.runDurableExecution(claim as never, new AbortController().signal)).rejects.toThrow(/definition snapshot does not match/);
    expect(api.getAllExecutions(tenantId)).toEqual([]);
  });
});
