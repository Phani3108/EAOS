import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./llm-provider.js', () => ({ callLLM: vi.fn(), hasAnyLLMKey: () => false }));
import { callLLM } from './llm-provider.js';
import { runReviewPipeline } from './review-pipeline.js';
beforeEach(() => { vi.clearAllMocks(); });
describe('review verdict evidence', () => {
  it('does not turn failed reviews into approvals or simulation', async () => {
    vi.mocked(callLLM).mockRejectedValue(new Error('Fixture outage'));
    const result = await runReviewPipeline('Fixture artifact');
    expect(result.finalVerdict).toBe('inconclusive');
    expect(result.approvals).toBe(0);
    expect(result.simulated).toBe(false);
  });
  it('rejects malformed reviewer output rather than defaulting to approve', async () => {
    vi.mocked(callLLM).mockResolvedValue({ content: 'not a verdict', cost: 0 } as any);
    expect((await runReviewPipeline('Fixture artifact')).finalVerdict).toBe('inconclusive');
  });
  it('requires explicit simulation and never calls a provider for it', async () => {
    const result = await runReviewPipeline('Fixture artifact', { simulate: true });
    expect(result.finalVerdict).toBe('simulated');
    expect(result.approvals).toBe(0);
    expect(callLLM).not.toHaveBeenCalled();
  });
  it('reports approval only for complete, valid reviewer verdicts', async () => {
    vi.mocked(callLLM).mockResolvedValue({ content: JSON.stringify({ verdict: 'approve', summary: 'Fixture valid review', findings: [] }), cost: 0 } as any);
    expect((await runReviewPipeline('Fixture artifact')).finalVerdict).toBe('approve');
  });
});
