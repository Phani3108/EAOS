/**
 * Task Worker — In-process async workers that claim and execute queued tasks.
 *
 * Each worker runs a loop:
 *   1. claim() the next available task (respecting concurrency caps)
 *   2. markRunning()
 *   3. Invoke the registered runFn handler with the payload
 *   4. markCompleted() or markFailed() with retry
 *
 * Shutdown is graceful: pending work is drained before exit.
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import { claim, markRunning, markCompleted, markFailed, type TaskRow, type PersonaId } from './task-queue.js';
import { eventBus } from './event-bus.js';
import { LeaseLostError, type PostgresRunRepository, type RuntimeEvent } from '@agentos/db/run-repository';
import { randomUUID } from 'node:crypto';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface WorkerConfig {
    workerCount?: number;
    maxConcurrentPerAgent?: number;
    maxConcurrentPerPersona?: number;
    pollIntervalMs?: number;
    personaFilter?: PersonaId;
}

type RunFnHandler = (payload: unknown) => Promise<void>;

const handlers = new Map<string, RunFnHandler>();

/**
 * Register a handler for a specific runFn name.
 * The task queue stores string identifiers for handlers, decoupling
 * serialization from function references.
 */
export function registerTaskHandler(runFn: string, handler: RunFnHandler): void {
    handlers.set(runFn, handler);
}

// ═══════════════════════════════════════════════════════════════
// Worker loop
// ═══════════════════════════════════════════════════════════════

let shuttingDown = false;
const activeWorkers: Promise<void>[] = [];

async function workerLoop(workerId: string, config: Required<WorkerConfig>): Promise<void> {
    while (!shuttingDown) {
        const task = claim({
            workerId,
            personaFilter: config.personaFilter,
            maxConcurrentPerAgent: config.maxConcurrentPerAgent,
            maxConcurrentPerPersona: config.maxConcurrentPerPersona,
        });

        if (!task) {
            // No work available → sleep
            await sleep(config.pollIntervalMs);
            continue;
        }

        await executeTask(task);
    }
}

async function executeTask(task: TaskRow): Promise<void> {
    const handler = handlers.get(task.runFn);
    if (!handler) {
        console.error(`[task-worker] no handler registered for runFn="${task.runFn}"`);
        markFailed(task.taskId, `No handler for runFn: ${task.runFn}`);
        return;
    }

    markRunning(task.taskId);
    const startMs = Date.now();

    try {
        await handler(task.payload);
        if (task.status !== 'running') return;
        markCompleted(task.taskId);
        const duration = Date.now() - startMs;
        eventBus.emit('task.worker.completed', {
            taskId: task.taskId,
            durationMs: duration,
            attempts: task.attempts,
        }).catch(() => {});
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const shouldRetry = (err as { retryable?: boolean })?.retryable === true && task.attempts < task.maxAttempts;
        console.error(`[task-worker] task ${task.taskId} failed (attempt ${task.attempts}/${task.maxAttempts}):`, message);
        // Exponential backoff before the next retry can be claimed
        const backoffMs = Math.min(30_000, 1_000 * Math.pow(2, Math.max(0, task.attempts - 1)));
        markFailed(task.taskId, message, { retry: shouldRetry, delayMs: backoffMs });

        eventBus.emit('task.worker.failed', {
            taskId: task.taskId,
            attempts: task.attempts,
            error: message,
            retrying: shouldRetry,
        }).catch(() => {});
    }
}

// ═══════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════

export function startWorkers(config: WorkerConfig = {}): void {
    const resolved: Required<WorkerConfig> = {
        workerCount: config.workerCount ?? 4,
        maxConcurrentPerAgent: config.maxConcurrentPerAgent ?? 2,
        maxConcurrentPerPersona: config.maxConcurrentPerPersona ?? 8,
        pollIntervalMs: config.pollIntervalMs ?? 500,
        personaFilter: config.personaFilter ?? undefined as any,
    };

    console.log(`✅ [task-worker] starting ${resolved.workerCount} workers ` +
        `(maxPerAgent=${resolved.maxConcurrentPerAgent}, maxPerPersona=${resolved.maxConcurrentPerPersona})`);

    for (let i = 0; i < resolved.workerCount; i++) {
        const workerId = `worker-${i + 1}`;
        activeWorkers.push(workerLoop(workerId, resolved).catch(err => {
            console.error(`[task-worker] ${workerId} crashed:`, err);
        }));
    }
}

const durableControllers = new Set<AbortController>();

export function startDurableWorkers(options: {
    repository: PostgresRunRepository;
    tenants: () => Promise<string[]>;
    execute: (claim: NonNullable<Awaited<ReturnType<PostgresRunRepository['claim']>>>, signal: AbortSignal) => Promise<void>;
    deliver: (event: RuntimeEvent) => Promise<void>;
    schedule?: (tenantId: string) => Promise<void>;
    workerCount?: number;
}): void {
    const instance = randomUUID();
    const worker = async (index: number) => {
        const workerId = `${instance}:${index}`;
        while (!shuttingDown) {
            let found = false;
            try {
                for (const tenantId of await options.tenants()) {
                    if (shuttingDown) break;
                    await options.schedule?.(tenantId);
                    const claimed = await options.repository.claim(tenantId, workerId);
                    if (!claimed) continue;
                    found = true;
                    const controller = new AbortController();
                    durableControllers.add(controller);
                    const deadline = claimed.lease.deadlineAt ? setTimeout(() => controller.abort(new LeaseLostError()), Math.max(0, new Date(claimed.lease.deadlineAt).getTime() - Date.now())) : undefined;
                    const heartbeat = setInterval(() => {
                        void options.repository.heartbeat(claimed.lease).then(valid => { if (!valid) controller.abort(new LeaseLostError()); }).catch(() => controller.abort(new LeaseLostError()));
                    }, 5000);
                    try {
                        await options.execute(claimed, controller.signal);
                    } catch (error) {
                        if (!(error instanceof LeaseLostError) && !controller.signal.aborted) {
                            const snapshot = await options.repository.get(tenantId, claimed.lease.runId);
                            if (snapshot?.status === 'running') await options.repository.fail(claimed.lease, snapshot, error instanceof Error ? error.message : 'Worker failed', (error as { retryable?: boolean })?.retryable === true);
                        }
                    } finally {
                        clearInterval(heartbeat);
                        if (deadline) clearTimeout(deadline);
                        durableControllers.delete(controller);
                    }
                    break;
                }
            } catch (error) {
                if (!(error instanceof LeaseLostError)) console.error('[durable-worker] Work dependency unavailable');
            }
            if (!found) await sleep(500);
        }
    };
    for (let i = 0; i < (options.workerCount ?? 4); i++) activeWorkers.push(worker(i));
    activeWorkers.push((async () => {
        const workerId = `${instance}:outbox`;
        while (!shuttingDown) {
            try {
                for (const tenant of await options.tenants()) {
                    for (const event of await options.repository.claimEvents(tenant, workerId)) {
                        await options.deliver(event);
                        await options.repository.ackEvent(event, workerId);
                    }
                }
            } catch { console.error('[durable-worker] Outbox delivery will be retried'); }
            await sleep(500);
        }
    })());
}

export async function stopWorkers(): Promise<void> {
    shuttingDown = true;
    const deadline = setTimeout(() => { for (const controller of durableControllers) controller.abort(new LeaseLostError()); }, 5000);
    try { await Promise.all(activeWorkers); } finally { clearTimeout(deadline); }
    activeWorkers.length = 0;
    shuttingDown = false;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
