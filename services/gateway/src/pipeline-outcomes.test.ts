import { describe, expect, it, vi } from 'vitest';
vi.mock('./event-bus.js', () => ({ eventBus: { emit: vi.fn(async () => {}) } }));
vi.mock('./llm-provider.js', () => ({ callLLM: vi.fn(async () => { throw new Error('Fixture unavailable'); }) }));
import { PipelineEngine } from './pipeline-engine.js';

describe('legacy graph outcome containment', () => {
  it('does not mark a graph completed when a terminal node failed', async () => {
    const engine = new PipelineEngine({ graph_id: 'fixture' } as any, {} as any, new Map());
    vi.spyOn(engine as any, 'resolveIntent').mockReturnValue({});
    vi.spyOn(engine as any, 'resolveActiveNodes').mockReturnValue([{ id: 'terminal' }]);
    vi.spyOn(engine as any, 'executeDAG').mockImplementation(async (execution: any) => { execution.nodeStates.get('terminal').status = 'failed'; });
    vi.spyOn(engine as any, 'generateAAR').mockResolvedValue('Fixture report');
    expect((await engine.execute('fixture')).status).toBe('failed');
  });
  it('does not pass a quality gate when its evaluator is unavailable', async () => {
    const engine = new PipelineEngine({ quality_gates: [{ id: 'gate', after_node: 'node', validation: {}, on_fail: 'block', max_retries: 0 }] } as any, {} as any, new Map());
    const execution = { id: 'fixture', nodeStates: new Map([['node', { retryCount: 0 }]]) };
    expect(await (engine as any).runQualityGate(execution, { id: 'node' }, 'fixture output')).toBe('failed');
  });
});
