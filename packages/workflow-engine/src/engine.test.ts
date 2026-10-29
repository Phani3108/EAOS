import { describe, expect, it } from 'vitest';
import { WorkflowEngine, type Workflow, type WorkflowStep } from './engine.js';

const step = (id: string): WorkflowStep => ({ id, name: id, type: 'skill', config: { type: 'skill', skillId: id, inputs: {} }, retry: { maxAttempts: 2, backoffMs: 1 }, timeoutMs: 1000, onError: 'fail' });
const graph = (steps: WorkflowStep[], edges: Workflow['edges'] = []): Workflow => ({ id: 'fixture', name: 'Fixture', description: '', version: '1', steps, edges, variables: {}, triggers: [], metadata: { createdBy: 'fixture', createdAt: new Date(), domain: 'engineering' } });

describe('workflow scheduler lifecycle', () => {
  it('waits for all AND dependencies and reserves a join once', async () => {
    const engine = new WorkflowEngine();
    const calls: string[] = [];
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    engine.registerExecutor('skill', { execute: async config => {
      const id = (config as { skillId: string }).skillId;
      calls.push(id);
      if (id === 'b') await held;
      return { output: id, status: 'complete' };
    } });
    const result = engine.execute(graph([step('a'),step('b'),step('join')], [{ from: 'a', to: 'join' }, { from: 'b', to: 'join' }]));
    await new Promise(resolve => setTimeout(resolve, 10));
    const ranEarly = calls.includes('join');
    release();
    expect((await result).status).toBe('complete');
    expect(ranEarly).toBe(false);
    expect(calls.filter(id => id === 'join')).toHaveLength(1);
  });
  it('propagates only the selected conditional branch into a merge', async () => {
    const engine = new WorkflowEngine();
    const calls: string[] = [];
    engine.registerExecutor('skill', { execute: async config => { calls.push((config as { skillId: string }).skillId); return { output: 'fixture', status: 'complete' }; } });
    const condition: WorkflowStep = { ...step('choose'), type: 'condition', config: { type: 'condition', expression: 'true', trueEdge: 'yes', falseEdge: 'no' } };
    const result = await engine.execute(graph([condition,step('yes'),step('no'),step('merge')], [{ from: 'choose', to: 'yes', condition: 'choose_output === true' },{ from: 'choose', to: 'no' },{ from: 'yes', to: 'merge' },{ from: 'no', to: 'merge' }]));
    expect(result.status).toBe('complete');
    expect(calls).toEqual(['yes','merge']);
    expect(result.stepStates.get('no')?.status).toBe('skipped');
  });
  it('allows a recovered retry to complete without losing error history', async () => {
    const engine = new WorkflowEngine();
    let attempts = 0;
    engine.registerExecutor('skill', { execute: async () => { if (++attempts === 1) throw new Error('Fixture transient failure'); return { output: 'ok', status: 'complete' }; } });
    const result = await engine.execute(graph([{ ...step('retry'), onError: 'retry' }]));
    expect(result.status).toBe('complete');
    expect(result.stepStates.get('retry')?.attempts).toBe(2);
    expect(result.errors).toHaveLength(1);
  });
  it('resumes approval continuations without rerunning finished work', async () => {
    const engine = new WorkflowEngine();
    const calls: string[] = [];
    engine.registerExecutor('skill', { execute: async config => { calls.push((config as { skillId: string }).skillId); return { output: 'ok', status: 'complete' }; } });
    const approval: WorkflowStep = { ...step('approval'), type: 'approval', config: { type: 'approval', action: 'review', sensitivity: 'high' } };
    const result = await engine.execute(graph([step('before'),approval,step('after')], [{ from: 'before', to: 'approval' },{ from: 'approval', to: 'after' }]));
    expect(result.status).toBe('paused');
    await engine.resume(result.id, 'approval', { approved: true });
    expect(result.status).toBe('complete');
    expect(calls).toEqual(['before','after']);
  });
  it('treats timed-out effects as inconclusive without retrying them', async () => {
    const engine = new WorkflowEngine();
    let calls = 0;
    let signal: AbortSignal | undefined;
    engine.registerExecutor('tool', { execute: async (_config, _variables, context) => { calls++; signal = context?.signal; return new Promise(() => {}); } });
    const result = await engine.execute(graph([{ ...step('effect'), type: 'tool', config: { type: 'tool', toolId: 'fixture', params: {} }, timeoutMs: 5, onError: 'retry' }]));
    expect(result.status).toBe('inconclusive');
    expect(calls).toBe(1);
    expect(signal?.aborted).toBe(true);
  });
  it('preserves cancellation when an executor resolves late', async () => {
    let complete!: (value: unknown) => void;
    let executionId = '';
    const recording = new WorkflowEngine({ checkpoint: async execution => { executionId = execution.id; } });
    recording.registerExecutor('skill', { execute: async () => new Promise(resolve => { complete = resolve; }) });
    const pending = recording.execute(graph([step('held')]));
    while (!complete) await new Promise(resolve => setTimeout(resolve, 1));
    await recording.cancel(executionId);
    complete({ output: 'late', status: 'complete' });
    expect((await pending).status).toBe('cancelled');
    expect(recording.getExecution(executionId)?.stepStates.get('held')?.status).toBe('cancelled');
  });
  it('restores a paused checkpoint and rejects a stale definition', async () => {
    const first = new WorkflowEngine();
    first.registerExecutor('skill', { execute: async () => ({ output: 'fixture', status: 'complete' }) });
    const workflow = graph([step('before'), { ...step('approval'), type: 'approval', config: { type: 'approval', action: 'review', sensitivity: 'high' } }, step('after')], [{ from: 'before', to: 'approval' }, { from: 'approval', to: 'after' }]);
    const checkpoint = structuredClone(await first.execute(workflow));
    const restored = new WorkflowEngine();
    const calls: string[] = [];
    restored.registerExecutor('skill', { execute: async config => { calls.push((config as { skillId: string }).skillId); return { output: 'fixture', status: 'complete' }; } });
    await expect(restored.restore({ ...workflow, version: 'changed' }, checkpoint)).rejects.toThrow();
    await restored.restore(workflow, checkpoint);
    await restored.resume(checkpoint.id, 'approval', { approved: true });
    expect(calls).toEqual(['after']);
    expect(restored.getExecution(checkpoint.id)?.status).toBe('complete');
  });
  it('rejects missing references and duplicate node IDs before execution', async () => {
    const engine = new WorkflowEngine();
    await expect(engine.execute(graph([step('one')], [{ from: 'unknown', to: 'one' }]))).rejects.toThrow();
    await expect(engine.execute(graph([step('one'),step('one')]))).rejects.toThrow();
  });
});
