import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./llm-provider.js', () => ({ callLLM: vi.fn(), hasAnyLLMKey: () => false, PROVIDER_CALL_TIMEOUT_MS: 60_000 }));
import { callLLM } from './llm-provider.js';
import { getReviewChain, REVIEW_DEADLINE_MS, runReviewPipeline } from './review-pipeline.js';
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
describe('review deadline and abandonment', () => {
  const approve = { content: JSON.stringify({ verdict: 'approve', summary: 'Fixture valid review', findings: [] }), cost: 0 } as any;
  it('budgets one provider attempt per reviewer', () => {
    expect(REVIEW_DEADLINE_MS).toBe(getReviewChain().length * 60_000);
  });
  it('hands the caller signal to every provider call', async () => {
    vi.mocked(callLLM).mockResolvedValue(approve);
    const signal = new AbortController().signal;
    await runReviewPipeline('Fixture artifact', { signal });
    expect(callLLM).toHaveBeenCalledTimes(getReviewChain().length);
    expect(vi.mocked(callLLM).mock.calls.every(([request]) => request.signal === signal)).toBe(true);
  });
  it('stops calling providers once the caller is gone, without approving', async () => {
    const abandoned = new AbortController();
    // The first reviewer answers; the caller disconnects while the second is in flight.
    vi.mocked(callLLM)
      .mockResolvedValueOnce(approve)
      .mockImplementationOnce(async () => { abandoned.abort(); throw new DOMException('This operation was aborted', 'AbortError'); });
    const result = await runReviewPipeline('Fixture artifact', { signal: abandoned.signal });
    expect(callLLM).toHaveBeenCalledTimes(2);
    expect(result.finalVerdict).toBe('inconclusive');
    expect(result.approvals).toBe(1);
    expect(result.reviewers[1].summary).toBe('Review could not complete: the request was abandoned');
    expect(result.reviewers.slice(2).map(reviewer => [reviewer.verdict, reviewer.summary]))
      .toEqual(Array(getReviewChain().length - 2).fill(['inconclusive', 'Review was not run: the request was abandoned']));
  });
  it('names the elapsed deadline when the review runs out of time', async () => {
    const result = await runReviewPipeline('Fixture artifact', { signal: AbortSignal.abort(new DOMException('timed out', 'TimeoutError')) });
    expect(callLLM).not.toHaveBeenCalled();
    expect(result.finalVerdict).toBe('inconclusive');
    expect(result.reviewers[0].summary).toBe(`Review was not run: the ${REVIEW_DEADLINE_MS / 1000}s review deadline elapsed`);
  });
});
