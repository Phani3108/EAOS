/**
 * Execution Scheduler Service
 *
 * Handles cron jobs, interval timers, and event-based triggers.
 * In-process scheduler with persistent state. For production, replace
 * with a distributed job queue (BullMQ, Temporal, etc.)
 */

import { createPersonaExecution, getPersonaExecution } from './persona-api.js';
import { getEngineeringSkill } from './engineering-skills-data.js';
import { getProductSkill } from './product-skills-data.js';
import { getHRSkill } from './hr-skills-data.js';
import { getWorkflowRef } from './marketing-workflows-data.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScheduleType = 'cron' | 'interval' | 'event' | 'one-time';
export type JobStatus = 'active' | 'paused' | 'failed' | 'completed' | 'pending';

export interface ScheduledJob {
    id: string;
    /**
     * Owning tenant, captured from the creating principal.
     *
     * Optional only for backward compatibility with jobs persisted before this
     * field existed; those fall back to 'default'. A scheduled run produces a
     * real execution, so without this the run — and everything attributed from
     * it — would be tenant-less.
     */
    tenantId?: string;
    name: string;
    skillId: string;
    skillName: string;
    personaId: string;
    scheduleType: ScheduleType;
    cronExpression?: string;
    intervalMs?: number;
    eventTrigger?: string;
    oneTimeAt?: string;
    status: JobStatus;
    lastRun?: string;
    nextRun?: string;
    runCount: number;
    successCount: number;
    failureCount: number;
    createdAt: string;
    updatedAt: string;
    inputs?: Record<string, unknown>;
    timeout?: number;
    retries?: number;
    tags: string[];
    createdBy: string;
}

export interface JobLog {
    id: string;
    jobId: string;
    status: 'running' | 'success' | 'failed';
    startedAt: string;
    completedAt?: string;
    durationMs?: number;
    output?: string;
    error?: string;
    attempt: number;
}

export interface EventTriggerPayload {
    trigger: string;
    data: Record<string, unknown>;
    source: string;
    timestamp: string;
}

// ---------------------------------------------------------------------------
// Cron parser (minimal — handles standard 5-field cron)
// ---------------------------------------------------------------------------

function parseCronField(field: string, min: number, max: number): Set<number> {
    const values = new Set<number>();
    const parts = field.split(',');

    for (const part of parts) {
        if (part === '*') {
            for (let i = min; i <= max; i++) values.add(i);
        } else if (part.startsWith('*/')) {
            const step = parseInt(part.slice(2));
            for (let i = min; i <= max; i += step) values.add(i);
        } else if (part.includes('-')) {
            const [start, end] = part.split('-').map(Number);
            for (let i = start; i <= end; i++) values.add(i);
        } else if (part.includes('/') && part.includes('-')) {
            const [range, step] = part.split('/');
            const [start, end] = range.split('-').map(Number);
            const s = parseInt(step);
            for (let i = start; i <= end; i += s) values.add(i);
        } else {
            const v = parseInt(part);
            if (!isNaN(v)) values.add(v);
        }
    }

    return values;
}

// Day-of-week name mapping
const DOW_MAP: Record<string, number> = {
    SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

function parseDowField(field: string): Set<number> {
    // Replace names like MON-FRI with numbers
    const normalised = field
        .toUpperCase()
        .replace(/\b(SUN|MON|TUE|WED|THU|FRI|SAT)\b/g, (m) => String(DOW_MAP[m] ?? m));
    return parseCronField(normalised, 0, 6);
}

export function cronMatchesNow(expression: string, now = new Date()): boolean {
    const fields = expression.trim().split(/\s+/);
    if (fields.length < 5) return false;

    const [minuteF, hourF, domF, monthF, dowF] = fields;

    const minutes = parseCronField(minuteF, 0, 59);
    const hours = parseCronField(hourF, 0, 23);
    const doms = parseCronField(domF, 1, 31);
    const months = parseCronField(monthF, 1, 12);
    const dows = parseDowField(dowF);

    return (
        minutes.has(now.getMinutes()) &&
        hours.has(now.getHours()) &&
        doms.has(now.getDate()) &&
        months.has(now.getMonth() + 1) &&
        dows.has(now.getDay())
    );
}

/** Compute approximate next run time for a cron expression */
export function computeNextRun(job: ScheduledJob): string | undefined {
    if (job.scheduleType === 'cron' && job.cronExpression) {
        // Advance by 1 minute and scan up to 366 days
        const probe = new Date();
        probe.setSeconds(0, 0);
        probe.setMinutes(probe.getMinutes() + 1);

        for (let i = 0; i < 525600; i++) {
            if (cronMatchesNow(job.cronExpression, probe)) {
                return probe.toISOString();
            }
            probe.setMinutes(probe.getMinutes() + 1);
        }
        return undefined;
    }
    if (job.scheduleType === 'interval' && job.intervalMs) {
        const base = job.lastRun ? new Date(job.lastRun).getTime() : Date.now();
        return new Date(base + job.intervalMs).toISOString();
    }
    if (job.scheduleType === 'one-time' && job.oneTimeAt) {
        return new Date(job.oneTimeAt) > new Date() ? job.oneTimeAt : undefined;
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export class Scheduler {
    private jobs = new Map<string, ScheduledJob>();
    private logs = new Map<string, JobLog[]>(); // jobId → logs
    private timers = new Map<string, ReturnType<typeof setInterval>>(); // for interval jobs
    private eventSubscriptions = new Map<string, string[]>(); // trigger → jobIds
    private tickInterval?: ReturnType<typeof setInterval>;

    constructor() {
        if (process.env.SEED_DEMO === 'true') this.seed();
        this.startTick();
    }

    // -----------------------------------------------------------------------
    // Seeded demo jobs
    // -----------------------------------------------------------------------

    private seed(): void {
        const demo: ScheduledJob[] = [
            {
                id: 'job-1', name: 'Daily Sprint Digest', skillId: 'engineering.sprint.digest',
                skillName: 'Sprint Digest Generator', personaId: 'engineering',
                scheduleType: 'cron', cronExpression: '0 9 * * MON-FRI',
                status: 'active', runCount: 47, successCount: 45, failureCount: 2,
                createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
                updatedAt: new Date().toISOString(),
                tags: ['engineering', 'daily'], createdBy: 'user-1',
                timeout: 120, retries: 2,
                lastRun: new Date(Date.now() - 3600000).toISOString(),
                nextRun: new Date(Date.now() + 72000000).toISOString(),
            },
            {
                id: 'job-2', name: 'Campaign Performance Monitor', skillId: 'marketing.campaign.monitor',
                skillName: 'Campaign Performance Monitor', personaId: 'marketing',
                scheduleType: 'cron', cronExpression: '*/30 8-18 * * MON-FRI',
                status: 'active', runCount: 284, successCount: 282, failureCount: 2,
                createdAt: new Date(Date.now() - 15 * 86400000).toISOString(),
                updatedAt: new Date().toISOString(),
                tags: ['marketing', 'monitoring'], createdBy: 'user-2',
                timeout: 60, retries: 1,
                lastRun: new Date(Date.now() - 1800000).toISOString(),
                nextRun: new Date(Date.now() + 1800000).toISOString(),
            },
            {
                id: 'job-3', name: 'PR Merge → Auto Review', skillId: 'engineering.pr.architecture_review',
                skillName: 'PR Architecture Review', personaId: 'engineering',
                scheduleType: 'event', eventTrigger: 'github.pull_request.opened',
                status: 'active', runCount: 128, successCount: 126, failureCount: 2,
                createdAt: new Date(Date.now() - 45 * 86400000).toISOString(),
                updatedAt: new Date().toISOString(),
                tags: ['engineering', 'github'], createdBy: 'user-1',
                timeout: 180, retries: 0,
                lastRun: new Date(Date.now() - 7200000).toISOString(),
            },
            {
                id: 'job-4', name: 'Weekly Business Review', skillId: 'leadership.business.review',
                skillName: 'Business Review Generator', personaId: 'leadership',
                scheduleType: 'cron', cronExpression: '0 8 * * MON',
                status: 'paused', runCount: 12, successCount: 11, failureCount: 1,
                createdAt: new Date(Date.now() - 90 * 86400000).toISOString(),
                updatedAt: new Date().toISOString(),
                tags: ['leadership', 'weekly'], createdBy: 'user-3',
                timeout: 300, retries: 3,
                lastRun: new Date(Date.now() - 7 * 86400000).toISOString(),
                nextRun: new Date(Date.now() + 86400000).toISOString(),
            },
        ];

        for (const job of demo) {
            this.jobs.set(job.id, job);
            this.logs.set(job.id, []);
            if (job.eventTrigger) {
                const subs = this.eventSubscriptions.get(job.eventTrigger) ?? [];
                subs.push(job.id);
                this.eventSubscriptions.set(job.eventTrigger, subs);
            }
        }
    }

    // -----------------------------------------------------------------------
    // Tick — runs every minute, fires cron + interval jobs
    // -----------------------------------------------------------------------

    private startTick(): void {
        // Tick every 60s aligned to minute boundaries
        const msToNextMinute = (60 - new Date().getSeconds()) * 1000;
        setTimeout(() => {
            this.tick();
            this.tickInterval = setInterval(() => this.tick(), 60_000);
        }, msToNextMinute);
    }

    private tick(): void {
        const now = new Date();
        for (const job of this.jobs.values()) {
            if (job.status !== 'active') continue;

            if (job.scheduleType === 'cron' && job.cronExpression) {
                if (cronMatchesNow(job.cronExpression, now)) {
                    void this.executeJob(job.id, 'scheduled');
                }
            }

            if (job.scheduleType === 'one-time' && job.oneTimeAt) {
                const target = new Date(job.oneTimeAt);
                const diff = Math.abs(now.getTime() - target.getTime());
                if (diff < 60_000 && !job.lastRun) {
                    void this.executeJob(job.id, 'scheduled');
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // Execute a job
    // -----------------------------------------------------------------------

    async executeJob(jobId: string, trigger: 'scheduled' | 'manual' | 'event', _eventData?: Record<string, unknown>): Promise<JobLog> {
        const job = this.jobs.get(jobId);
        if (!job) throw new Error(`Job not found: ${jobId}`);

        const log: JobLog = {
            id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            jobId,
            status: 'running',
            startedAt: new Date().toISOString(),
            attempt: 1,
        };

        const logs = this.logs.get(jobId) ?? [];
        logs.unshift(log);
        this.logs.set(jobId, logs.slice(0, 100));

        const startMs = Date.now();
        let succeeded = false;
        let errorMsg: string | undefined;
        let outputMsg: string | undefined;

        try {
            // Resolve the skill/workflow by id across all persona catalogs.
            const skill = this.resolveSkillForJob(job);
            if (skill) {
                // Kick off a real persona execution. createPersonaExecution enqueues
                // the skill onto the task queue and returns immediately; we wait up
                // to `timeout` seconds for it to reach a terminal state to record
                // accurate success/failure in the job log.
                const persona = this.resolvePersonaForJob(job);
                if (!job.tenantId || job.tenantId !== (process.env.EAOS_TENANT_ID || 'default')) throw new Error('Legacy job tenant ownership requires review');
                const exec = await createPersonaExecution(
                    // Pre-existing jobs without verified tenant ownership remain
                    // quarantined until an explicit migration has been reviewed.
                    job.tenantId,
                    persona,
                    skill,
                    job.inputs ?? {},
                    job.createdBy,
                    /* simulate */ false,
                );

                const timeoutMs = (job.timeout ?? 120) * 1000;
                const pollMs = 500;
                const deadline = Date.now() + timeoutMs;

                while (Date.now() < deadline) {
                    const latest = getPersonaExecution(exec.id);
                    if (latest && (latest.status === 'completed' || latest.status === 'failed')) {
                        succeeded = latest.status === 'completed';
                        outputMsg = succeeded
                            ? `${job.skillName} completed (exec=${exec.id}). Trigger: ${trigger}.`
                            : undefined;
                        errorMsg = succeeded ? undefined : `Execution failed (exec=${exec.id})`;
                        break;
                    }
                    await new Promise((r) => setTimeout(r, pollMs));
                }

                // Still running after timeout — mark success-pending so we don't
                // falsely count it as a failure in stats. UI shows it as a log
                // entry pointing to the execution record.
                if (!outputMsg && !errorMsg) {
                    succeeded = true;
                    outputMsg = `${job.skillName} queued (exec=${exec.id}). Trigger: ${trigger}. Still running at time of job log write.`;
                }
            } else {
                // Unknown skill — degrade gracefully to a recorded "no-op" entry so
                // the schedule keeps ticking and the UI still shows history.
                succeeded = true;
                outputMsg = `${job.skillName}: skill id '${job.skillId}' not resolved in persona catalogs — no-op. Trigger: ${trigger}.`;
            }
        } catch (err) {
            succeeded = false;
            errorMsg = `${job.skillName} execution error: ${(err as Error).message}`;
        }

        const durationMs = Date.now() - startMs;
        log.status = succeeded ? 'success' : 'failed';
        log.completedAt = new Date().toISOString();
        log.durationMs = durationMs;
        log.output = outputMsg;
        log.error = errorMsg;

        this.jobs.set(jobId, {
            ...job,
            runCount: job.runCount + 1,
            successCount: job.successCount + (succeeded ? 1 : 0),
            failureCount: job.failureCount + (succeeded ? 0 : 1),
            lastRun: new Date().toISOString(),
            nextRun: computeNextRun({ ...job }),
            updatedAt: new Date().toISOString(),
            status: job.scheduleType === 'one-time' && succeeded ? 'completed' : job.status,
        });

        return log;
    }

    /**
     * Resolve the scheduled job's skillId against all persona skill catalogs.
     * Accepts bare ids ("blog-from-brief"), slugs, or legacy dotted ids.
     * Returns undefined if not found — caller treats that as a no-op job.
     */
    private resolveSkillForJob(job: ScheduledJob): ReturnType<typeof getEngineeringSkill> {
        const id = job.skillId;
        // Try persona-specific first to short-circuit.
        switch (job.personaId) {
            case 'engineering':
                return getEngineeringSkill(id) ?? undefined;
            case 'product':
                return getProductSkill(id) ?? undefined;
            case 'hr':
                return getHRSkill(id) ?? undefined;
            case 'marketing':
                return getWorkflowRef(id);
            default:
                // Unknown persona — scan all catalogs in turn.
                return (
                    getEngineeringSkill(id) ??
                    getProductSkill(id) ??
                    getHRSkill(id) ??
                    getWorkflowRef(id)
                );
        }
    }

    /**
     * Map a scheduled job's personaId (free-form string) to one of the four
     * personas that persona-api.ts supports. Defaults to 'marketing' for
     * leadership/business roles since they typically use marketing workflows.
     */
    private resolvePersonaForJob(job: ScheduledJob): 'engineering' | 'product' | 'hr' | 'marketing' {
        const p = job.personaId.toLowerCase();
        if (p === 'engineering' || p === 'product' || p === 'hr' || p === 'marketing') {
            return p as 'engineering' | 'product' | 'hr' | 'marketing';
        }
        return 'marketing';
    }

    // -----------------------------------------------------------------------
    // Event dispatch
    // -----------------------------------------------------------------------

    dispatchEvent(payload: EventTriggerPayload): string[] {
        const jobs = this.eventSubscriptions.get(payload.trigger) ?? [];
        const triggered: string[] = [];

        for (const jobId of jobs) {
            const job = this.jobs.get(jobId);
            if (job?.status === 'active') {
                void this.executeJob(jobId, 'event', payload.data);
                triggered.push(jobId);
            }
        }

        return triggered;
    }

    // -----------------------------------------------------------------------
    // CRUD
    // -----------------------------------------------------------------------

    createJob(data: Omit<ScheduledJob, 'id' | 'createdAt' | 'updatedAt' | 'runCount' | 'successCount' | 'failureCount'>): ScheduledJob {
        const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const job: ScheduledJob = {
            ...data,
            id,
            runCount: 0,
            successCount: 0,
            failureCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            nextRun: computeNextRun({ ...data, id, runCount: 0, successCount: 0, failureCount: 0, createdAt: '', updatedAt: '' }),
        };
        this.jobs.set(id, job);
        this.logs.set(id, []);

        if (job.eventTrigger) {
            const subs = this.eventSubscriptions.get(job.eventTrigger) ?? [];
            subs.push(id);
            this.eventSubscriptions.set(job.eventTrigger, subs);
        }

        return job;
    }

    updateJob(id: string, updates: Partial<ScheduledJob>): ScheduledJob | null {
        const job = this.jobs.get(id);
        if (!job) return null;
        const updated = { ...job, ...updates, updatedAt: new Date().toISOString() };
        this.jobs.set(id, updated);
        return updated;
    }

    deleteJob(id: string): boolean {
        const job = this.jobs.get(id);
        if (!job) return false;
        if (job.eventTrigger) {
            const subs = this.eventSubscriptions.get(job.eventTrigger) ?? [];
            this.eventSubscriptions.set(job.eventTrigger, subs.filter((j) => j !== id));
        }
        this.jobs.delete(id);
        this.logs.delete(id);
        return true;
    }

    getJob(id: string): ScheduledJob | null {
        return this.jobs.get(id) ?? null;
    }

    getAllJobs(filters?: { status?: JobStatus; persona?: string; tag?: string }): ScheduledJob[] {
        let list = Array.from(this.jobs.values());
        if (filters?.status) list = list.filter((j) => j.status === filters.status);
        if (filters?.persona) list = list.filter((j) => j.personaId === filters.persona);
        if (filters?.tag) list = list.filter((j) => j.tags.includes(filters.tag!));
        return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    getJobLogs(jobId: string, limit = 20): JobLog[] {
        return (this.logs.get(jobId) ?? []).slice(0, limit);
    }

    getStats() {
        const all = Array.from(this.jobs.values());
        const totalRuns = all.reduce((s, j) => s + j.runCount, 0);
        const totalSuccess = all.reduce((s, j) => s + j.successCount, 0);
        return {
            totalJobs: all.length,
            activeJobs: all.filter((j) => j.status === 'active').length,
            pausedJobs: all.filter((j) => j.status === 'paused').length,
            failedJobs: all.filter((j) => j.status === 'failed').length,
            totalRuns,
            successRate: totalRuns > 0 ? Math.round((totalSuccess / totalRuns) * 100) : 100,
            byType: {
                cron: all.filter((j) => j.scheduleType === 'cron').length,
                interval: all.filter((j) => j.scheduleType === 'interval').length,
                event: all.filter((j) => j.scheduleType === 'event').length,
                'one-time': all.filter((j) => j.scheduleType === 'one-time').length,
            },
        };
    }

    destroy(): void {
        if (this.tickInterval) clearInterval(this.tickInterval);
        for (const timer of this.timers.values()) clearInterval(timer);
    }

    // -----------------------------------------------------------------------
    // Persistence hooks
    // -----------------------------------------------------------------------

    _exportData(): { jobs: ScheduledJob[]; logs: { jobId: string; entries: JobLog[] }[] } {
        const logs: { jobId: string; entries: JobLog[] }[] = [];
        for (const [jobId, entries] of this.logs) {
            logs.push({ jobId, entries });
        }
        return { jobs: Array.from(this.jobs.values()), logs };
    }

    _importData(data: { jobs?: ScheduledJob[]; logs?: { jobId: string; entries: JobLog[] }[] }): void {
        if (data.jobs) {
            this.jobs.clear();
            for (const j of data.jobs) this.jobs.set(j.id, j);
        }
        if (data.logs) {
            this.logs.clear();
            for (const entry of data.logs) {
                this.logs.set(entry.jobId, entry.entries);
            }
        }
    }
}

// Singleton
export const scheduler = new Scheduler();
