import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./event-bus.js', () => ({ eventBus: { emit: async () => {} } }));
import { enqueue, claim, markRunning, markCompleted, markFailed, cancelTask, getTask } from './task-queue.js';

const options = { workerId: 'fixture-worker', maxConcurrentPerAgent: 10, maxConcurrentPerPersona: 10 };
afterEach(() => { vi.useRealTimers(); });
describe('task delivery state', () => {
  it('never overwrites cancellation with a late completion or error', () => {
    enqueue({ taskId: 'cancel-fixture', persona: 'engineering', agentId: 'code-reviewer', runFn: 'fixture', payload: {} });
    claim(options); markRunning('cancel-fixture'); cancelTask('cancel-fixture');
    markCompleted('cancel-fixture'); markFailed('cancel-fixture', 'late error');
    expect(getTask('cancel-fixture')?.status).toBe('cancelled');
  });
  it('counts a running attempt once', () => {
    enqueue({ taskId: 'attempt-fixture', persona: 'engineering', agentId: 'code-reviewer', runFn: 'fixture', payload: {} });
    claim(options); markRunning('attempt-fixture'); markRunning('attempt-fixture');
    expect(getTask('attempt-fixture')?.attempts).toBe(1);
    markCompleted('attempt-fixture');
  });
  it('makes retry delay a claim condition instead of sleeping only one worker', () => {
    vi.useFakeTimers();
    enqueue({ taskId: 'retry-fixture', persona: 'engineering', agentId: 'code-reviewer', runFn: 'fixture', payload: {} });
    claim(options); markRunning('retry-fixture'); markFailed('retry-fixture', 'transient', { retry: true, delayMs: 1000 });
    expect(claim(options)).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(claim(options)?.taskId).toBe('retry-fixture');
    cancelTask('retry-fixture');
  });
});
