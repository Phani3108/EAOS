/**
 * Task Queue — Atomic claim semantics for skill execution.
 *
 * Replaces the fire-and-forget `processSkillSteps(...).catch(...)` pattern
 * in persona-api.ts with a real queue that supports:
 *   - priority ordering
 *   - atomic claim (no two workers get the same task)
 *   - per-agent concurrency caps
 *   - retry with exponential backoff
 *   - cancellation
 *   - survivability across gateway restarts (via existing persisted store)
 *
 * In-memory implementation uses a single synchronous critical section around
 * a Map. Postgres path (future) will use SELECT ... FOR UPDATE SKIP LOCKED.
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import { eventBus } from './event-bus.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type PersonaId = 'engineering' | 'product' | 'hr' | 'marketing' | 'ta' | 'program';

export type TaskStatus = 'queued' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskRow {
    taskId: string;          // same as execution.id
    persona: PersonaId;
    agentId: string;         // primary assigned agent
    priority: number;        // 0-100, higher = sooner
    status: TaskStatus;
    claimedBy?: string;      // worker id
    claimedAt?: string;      // ISO
    attempts: number;
    maxAttempts: number;
    lastError?: string;
    runFn: string;           // identifies which handler to invoke
    payload: unknown;        // serialized call args
    createdAt: string;
    updatedAt: string;
    cancelledAt?: string;
    completedAt?: string;
    availableAt?: string;
}

export interface QueueStats {
    queued: number;
    claimed: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    perPersona: Record<string, { queued: number; running: number }>;
    perAgent: Record<string, { running: number }>;
}

// ═══════════════════════════════════════════════════════════════
// State (in-memory; survives via persisted-store registration)
// ═══════════════════════════════════════════════════════════════

const tasks = new Map<string, TaskRow>();

// ═══════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════

export function enqueue(params: {
    taskId: string;
    persona: PersonaId;
    agentId: string;
    runFn: string;
    payload: unknown;
    priority?: number;
    maxAttempts?: number;
}): TaskRow {
    if (tasks.has(params.taskId)) throw new Error('Task identity already exists');
    const now = new Date().toISOString();
    const row: TaskRow = {
        taskId: params.taskId,
        persona: params.persona,
        agentId: params.agentId,
        priority: params.priority ?? 50,
        status: 'queued',
        attempts: 0,
        maxAttempts: params.maxAttempts ?? 3,
        runFn: params.runFn,
        payload: params.payload,
        createdAt: now,
        updatedAt: now,
    };
    tasks.set(row.taskId, row);
    eventBus.emit('execution.queued', { taskId: row.taskId, persona: row.persona, agentId: row.agentId }).catch(() => {});
    return row;
}

/**
 * Atomically claim the next available task, respecting per-agent concurrency.
 *
 * This runs inside a single synchronous critical section — Node's event loop
 * guarantees no interleaving between the scan and the status mutation.
 */
export function claim(params: {
    workerId: string;
    personaFilter?: PersonaId;
    maxConcurrentPerAgent: number;
    maxConcurrentPerPersona: number;
}): TaskRow | null {
    // Compute current in-flight counts
    const inFlightByAgent = new Map<string, number>();
    const inFlightByPersona = new Map<string, number>();
    for (const task of tasks.values()) {
        if (task.status === 'claimed' || task.status === 'running') {
            inFlightByAgent.set(task.agentId, (inFlightByAgent.get(task.agentId) ?? 0) + 1);
            inFlightByPersona.set(task.persona, (inFlightByPersona.get(task.persona) ?? 0) + 1);
        }
    }

    // Find the highest-priority queued task that respects concurrency caps
    let best: TaskRow | null = null;
    for (const task of tasks.values()) {
        if (task.status !== 'queued' || (task.availableAt && Date.parse(task.availableAt) > Date.now())) continue;
        if (params.personaFilter && task.persona !== params.personaFilter) continue;

        const agentInFlight = inFlightByAgent.get(task.agentId) ?? 0;
        if (agentInFlight >= params.maxConcurrentPerAgent) continue;

        const personaInFlight = inFlightByPersona.get(task.persona) ?? 0;
        if (personaInFlight >= params.maxConcurrentPerPersona) continue;

        if (!best || task.priority > best.priority || (task.priority === best.priority && task.createdAt < best.createdAt)) {
            best = task;
        }
    }

    if (!best) return null;

    // Atomic state transition: queued → claimed
    best.status = 'claimed';
    best.claimedBy = params.workerId;
    best.claimedAt = new Date().toISOString();
    best.updatedAt = best.claimedAt;
    tasks.set(best.taskId, best);

    eventBus.emit('execution.claimed', { taskId: best.taskId, workerId: params.workerId, persona: best.persona, agentId: best.agentId }).catch(() => {});
    return best;
}

export function markRunning(taskId: string): void {
    const task = tasks.get(taskId);
    if (!task || task.status !== 'claimed') return;
    task.status = 'running';
    task.attempts++;
    task.updatedAt = new Date().toISOString();
    tasks.set(taskId, task);
}

export function markCompleted(taskId: string): void {
    const task = tasks.get(taskId);
    if (!task || task.status !== 'running') return;
    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    task.updatedAt = task.completedAt;
    tasks.set(taskId, task);
}

export function markFailed(taskId: string, error: string, opts: { retry?: boolean; delayMs?: number } = {}): void {
    const task = tasks.get(taskId);
    if (!task || !['claimed', 'running'].includes(task.status)) return;
    task.lastError = error;
    task.updatedAt = new Date().toISOString();

    if (opts.retry && task.attempts < task.maxAttempts) {
        // Requeue for retry
        task.availableAt = new Date(Date.now() + (opts.delayMs ?? 1000)).toISOString();
        task.status = 'queued';
        task.claimedBy = undefined;
        task.claimedAt = undefined;
    } else {
        task.status = 'failed';
        task.completedAt = task.updatedAt;
    }
    tasks.set(taskId, task);
}

export function cancelTask(taskId: string): boolean {
    const task = tasks.get(taskId);
    if (!task) return false;
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') return false;
    task.status = 'cancelled';
    task.cancelledAt = new Date().toISOString();
    task.updatedAt = task.cancelledAt;
    tasks.set(taskId, task);
    eventBus.emit('execution.cancelled', { taskId }).catch(() => {});
    return true;
}

export function retryTask(taskId: string): boolean {
    const task = tasks.get(taskId);
    if (!task) return false;
    if (task.status !== 'failed' && task.status !== 'cancelled') return false;
    task.status = 'queued';
    task.attempts = 0;
    task.lastError = undefined;
    task.claimedBy = undefined;
    task.claimedAt = undefined;
    task.cancelledAt = undefined;
    task.updatedAt = new Date().toISOString();
    tasks.set(taskId, task);
    eventBus.emit('execution.retry', { taskId }).catch(() => {});
    return true;
}

export function getTask(taskId: string): TaskRow | undefined {
    return tasks.get(taskId);
}

export function listTasks(filter?: { status?: TaskStatus; persona?: PersonaId; agentId?: string; limit?: number }): TaskRow[] {
    let list = Array.from(tasks.values());
    if (filter?.status) list = list.filter(t => t.status === filter.status);
    if (filter?.persona) list = list.filter(t => t.persona === filter.persona);
    if (filter?.agentId) list = list.filter(t => t.agentId === filter.agentId);
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return filter?.limit ? list.slice(0, filter.limit) : list;
}

export function getQueueStats(): QueueStats {
    const stats: QueueStats = {
        queued: 0, claimed: 0, running: 0, completed: 0, failed: 0, cancelled: 0,
        perPersona: {}, perAgent: {},
    };
    for (const task of tasks.values()) {
        stats[task.status]++;
        if (!stats.perPersona[task.persona]) stats.perPersona[task.persona] = { queued: 0, running: 0 };
        if (task.status === 'queued') stats.perPersona[task.persona]!.queued++;
        if (task.status === 'running' || task.status === 'claimed') {
            stats.perPersona[task.persona]!.running++;
            if (!stats.perAgent[task.agentId]) stats.perAgent[task.agentId] = { running: 0 };
            stats.perAgent[task.agentId]!.running++;
        }
    }
    return stats;
}

// ═══════════════════════════════════════════════════════════════
// Persistence hooks (register with gateway-persistence.ts)
// ═══════════════════════════════════════════════════════════════

export function _exportData(): { tasks: TaskRow[] } {
    return { tasks: Array.from(tasks.values()) };
}

export function _importData(data: { tasks?: TaskRow[] }): void {
    if (!data.tasks) return;
    tasks.clear();
    for (const task of data.tasks) {
        // Reset any "claimed"/"running" tasks to "queued" on startup — the
        // worker that claimed them no longer exists.
        if (task.status === 'claimed' || task.status === 'running') {
            task.status = 'queued';
            task.claimedBy = undefined;
            task.claimedAt = undefined;
        }
        tasks.set(task.taskId, task);
    }
}
