/**
 * @agentos/scheduler — Distributed Task Scheduler
 *
 * Priority-based task scheduling with multiple algorithms, concurrency control,
 * fair-share tenant isolation, deadline enforcement, and cost-aware dispatch.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SchedulingAlgorithm = 'fifo' | 'priority' | 'fair-share' | 'deadline' | 'cost-aware';

export interface SchedulerConfig {
    algorithm: SchedulingAlgorithm;
    maxConcurrentTasks: number;
    maxQueueDepth: number;
    dispatchIntervalMs: number;
    starvationTimeoutMs: number;
    costBudgetPerHour: number;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
    algorithm: 'priority',
    maxConcurrentTasks: 100,
    maxQueueDepth: 10_000,
    dispatchIntervalMs: 100,
    starvationTimeoutMs: 300_000,
    costBudgetPerHour: 100,
};

export interface SchedulableTask {
    id: string;
    executionId: string;
    workflowId?: string;
    type: string;
    priority: number;        // 0-1000, higher = more urgent
    requiredCluster: string;
    requiredCapabilities: string[];
    estimatedTokens: number;
    estimatedCostUsd: number;
    deadline?: Date;
    tenantId: string;
    enqueuedAt: Date;
    input: unknown;
    dependsOn: string[];
    maxRetries: number;
    retryCount: number;
}

export interface ScheduleDecision {
    taskId: string;
    workerId: string;
    dispatchedAt: Date;
    estimatedStartMs: number;
    reason: string;
}

export interface QueueSnapshot {
    depth: number;
    running: number;
    pending: number;
    byPriority: Record<string, number>;
    byCluster: Record<string, number>;
    byTenant: Record<string, number>;
    oldestTaskAge: number;
}

// ---------------------------------------------------------------------------
// Priority Calculators
// ---------------------------------------------------------------------------

interface PriorityScore {
    taskId: string;
    score: number;
    factors: Record<string, number>;
}

function calculatePriority(task: SchedulableTask, algorithm: SchedulingAlgorithm): PriorityScore {
    const factors: Record<string, number> = {};

    // Base priority
    factors.basePriority = task.priority;

    // Urgency from wait time (anti-starvation)
    const waitMs = Date.now() - task.enqueuedAt.getTime();
    factors.waitBoost = Math.min(waitMs / 60_000, 200); // +200 max for 1h wait

    // Deadline pressure
    if (task.deadline) {
        const timeUntilDeadline = task.deadline.getTime() - Date.now();
        if (timeUntilDeadline < 0) {
            factors.deadlinePressure = 500; // overdue
        } else if (timeUntilDeadline < 300_000) {
            factors.deadlinePressure = 300; // <5min
        } else if (timeUntilDeadline < 3_600_000) {
            factors.deadlinePressure = 100; // <1hr
        } else {
            factors.deadlinePressure = 0;
        }
    }

    // Cost penalty (cost-aware mode penalizes expensive tasks)
    if (algorithm === 'cost-aware') {
        factors.costPenalty = -task.estimatedCostUsd * 50;
    }

    // Retry boost (retrying tasks get slight priority bump)
    factors.retryBoost = task.retryCount * 20;

    const score = Object.values(factors).reduce((sum, v) => sum + v, 0);
    return { taskId: task.id, score, factors };
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export class TaskScheduler {
    private queue: SchedulableTask[] = [];
    private running = new Map<string, { task: SchedulableTask; workerId: string; startedAt: Date }>();
    private completed = new Set<string>();
    private dispatchInterval?: ReturnType<typeof setInterval>;
    private tenantUsage = new Map<string, number>();

    constructor(
        private config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG,
        private workerResolver: WorkerResolver
    ) { }

    /**
     * Start the scheduler dispatch loop.
     */
    start(): void {
        console.log(`📅 Scheduler starting (algorithm: ${this.config.algorithm})...`);

        this.dispatchInterval = setInterval(
            () => this.dispatchLoop(),
            this.config.dispatchIntervalMs
        );

        console.log('📅 Scheduler ready');
    }

    /**
     * Stop the scheduler.
     */
    stop(): void {
        if (this.dispatchInterval) {
            clearInterval(this.dispatchInterval);
        }
    }

    /**
     * Enqueue a task for scheduling.
     */
    enqueue(task: SchedulableTask): void {
        if (this.queue.length >= this.config.maxQueueDepth) {
            throw new Error(`Queue depth limit reached (max: ${this.config.maxQueueDepth})`);
        }

        task.enqueuedAt = new Date();
        this.queue.push(task);
    }

    /**
     * Enqueue multiple tasks (e.g., from a workflow DAG).
     */
    enqueueBatch(tasks: SchedulableTask[]): void {
        for (const task of tasks) {
            this.enqueue(task);
        }
    }

    /**
     * Mark a task as completed (unlocks dependents).
     */
    markCompleted(taskId: string): void {
        this.completed.add(taskId);
        this.running.delete(taskId);
    }

    /**
     * Mark a task as failed — re-enqueue if retries remain.
     */
    markFailed(taskId: string): void {
        const entry = this.running.get(taskId);
        this.running.delete(taskId);

        if (entry && entry.task.retryCount < entry.task.maxRetries) {
            entry.task.retryCount++;
            this.enqueue(entry.task);
        }
    }

    /**
     * Get a snapshot of the queue state.
     */
    snapshot(): QueueSnapshot {
        const byPriority: Record<string, number> = {};
        const byCluster: Record<string, number> = {};
        const byTenant: Record<string, number> = {};
        let oldestAge = 0;

        for (const task of this.queue) {
            const bucket = task.priority >= 800 ? 'critical' : task.priority >= 500 ? 'high' : task.priority >= 200 ? 'normal' : 'low';
            byPriority[bucket] = (byPriority[bucket] ?? 0) + 1;
            byCluster[task.requiredCluster] = (byCluster[task.requiredCluster] ?? 0) + 1;
            byTenant[task.tenantId] = (byTenant[task.tenantId] ?? 0) + 1;
            const age = Date.now() - task.enqueuedAt.getTime();
            if (age > oldestAge) oldestAge = age;
        }

        return {
            depth: this.queue.length + this.running.size,
            running: this.running.size,
            pending: this.queue.length,
            byPriority,
            byCluster,
            byTenant,
            oldestTaskAge: oldestAge,
        };
    }

    // -------------------------------------------------------------------------
    // Dispatch Loop
    // -------------------------------------------------------------------------

    private dispatchLoop(): void {
        if (this.running.size >= this.config.maxConcurrentTasks) return;
        if (this.queue.length === 0) return;

        // Get ready tasks (dependencies satisfied)
        const readyTasks = this.queue.filter((t) =>
            t.dependsOn.every((dep) => this.completed.has(dep))
        );
        if (readyTasks.length === 0) return;

        // Score and rank
        const scored = readyTasks
            .map((t) => ({ task: t, ...calculatePriority(t, this.config.algorithm) }))
            .sort((a, b) => b.score - a.score);

        // Apply fair-share if applicable
        const toDispatch = this.config.algorithm === 'fair-share'
            ? this.applyFairShare(scored)
            : scored;

        // Dispatch top tasks
        const slots = this.config.maxConcurrentTasks - this.running.size;
        for (const { task } of toDispatch.slice(0, slots)) {
            const worker = this.workerResolver.findWorker(task.requiredCluster, task.requiredCapabilities);
            if (!worker) continue; // no available worker

            // Remove from queue
            const idx = this.queue.indexOf(task);
            if (idx !== -1) this.queue.splice(idx, 1);

            // Track running
            this.running.set(task.id, { task, workerId: worker.id, startedAt: new Date() });

            // Track tenant usage
            this.tenantUsage.set(task.tenantId, (this.tenantUsage.get(task.tenantId) ?? 0) + 1);

            // Dispatch
            this.workerResolver.dispatch(worker.id, task);
        }
    }

    /**
     * Fair-share: ensure no tenant monopolizes the queue.
     */
    private applyFairShare(
        scored: Array<{ task: SchedulableTask; score: number }>
    ): Array<{ task: SchedulableTask; score: number }> {
        const tenantCounts = new Map<string, number>();

        // Compute the per-tenant cap ONCE up front from the distinct tenants in
        // the candidate set. Deriving it from tenantCounts.size inside the loop
        // would read a map that is mutated mid-iteration, making the cap
        // meaningless and letting one tenant starve the others.
        const distinctTenants = new Set(scored.map(s => s.task.tenantId)).size;
        const maxPerTenant = Math.ceil(this.config.maxConcurrentTasks / Math.max(distinctTenants, 1));

        return scored.filter(({ task }) => {
            const count = tenantCounts.get(task.tenantId) ?? 0;

            if (count >= maxPerTenant) return false;
            tenantCounts.set(task.tenantId, count + 1);
            return true;
        });
    }
}

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface WorkerResolver {
    findWorker(cluster: string, capabilities: string[]): { id: string } | null;
    dispatch(workerId: string, task: SchedulableTask): void;
}
