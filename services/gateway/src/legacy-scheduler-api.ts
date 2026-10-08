/**
 * File-mode (no DATABASE_URL) scheduler job writes. The durable API (schedule-api.ts)
 * replaces these routes when a schedule repository exists.
 *
 * A job runs as its creator in the creator's tenant (Scheduler.executeJob), so
 * every write here authorizes the same way /api/execute and schedule-api do:
 * the caller must hold every persona the scheduled definition executes, and only
 * the job's creator (or a tenant admin) may run, change or remove it.
 */

import type { AuthUser } from './auth.js';
import { requirePersonaAccess } from './auth.js';
import { compileDefinition, requiredPersonas } from './definition-registry.js';
import { deploymentTenant } from './deployment-tenant.js';
import type { ScheduledJob, Scheduler } from './scheduler.js';

type Result = { status: number; data: unknown };

const jobRoute = /^\/api\/scheduler\/jobs(?:\/([^/]+)(?:\/(run|toggle))?)?$/;

export const isLegacySchedulerWrite = (path: string, method: string): boolean => {
    const match = path.match(jobRoute);
    if (!match) return false;
    if (!match[1]) return method === 'POST';
    return match[2] ? method === 'POST' : method === 'PATCH' || method === 'DELETE';
};

// Ownership, run counters and timestamps are server-decided; a PATCH carrying them
// could re-home a job to another tenant or make it run as someone else.
const EDITABLE = new Set<keyof ScheduledJob>(['name', 'skillId', 'skillName', 'personaId', 'scheduleType', 'cronExpression', 'intervalMs', 'eventTrigger', 'oneTimeAt', 'timeout', 'retries', 'tags', 'inputs', 'status']);

/** True when the principal may NOT schedule this skill under this persona. */
function personaDenied(scheduler: Scheduler, principal: AuthUser, target: Pick<ScheduledJob, 'skillId' | 'personaId'>): boolean {
    if (!requirePersonaAccess(principal, target.personaId)) return true;
    const skill = scheduler.resolveSkillForJob(target);
    // An unresolved skill is recorded as a no-op on each firing and executes nothing.
    if (!skill) return false;
    // Compiled as preparePersonaExecution compiles it, so step and subworkflow
    // personas are the ones a run would actually use. A definition that does not
    // compile cannot run either, and its personas are unknown, so it is refused.
    try {
        return requiredPersonas(compileDefinition(skill)).some(persona => !requirePersonaAccess(principal, persona));
    } catch {
        return true;
    }
}

function manageable(principal: AuthUser, job: ScheduledJob): Result | undefined {
    // Jobs persisted before tenant stamping have no owner; only an admin of this
    // deployment may tidy them up (they stay quarantined from running regardless).
    const sameTenant = job.tenantId ? job.tenantId === principal.tenantId : principal.role === 'admin' && principal.tenantId === deploymentTenant();
    if (!sameTenant) return { status: 404, data: { error: 'Job not found' } };
    if (job.createdBy !== principal.id && principal.role !== 'admin') return { status: 403, data: { error: "Only the job's creator or an admin can manage it" } };
    return undefined;
}

const personaError: Result = { status: 403, data: { error: 'Schedule requires additional persona permissions' } };

export async function legacySchedulerRequest(scheduler: Scheduler, principal: AuthUser, path: string, method: string, body: Record<string, unknown>): Promise<Result> {
    if (!['admin', 'operator'].includes(principal.role)) return { status: 403, data: { error: 'Operator role required' } };
    const match = path.match(jobRoute);
    if (!match) return { status: 404, data: { error: 'Schedule route not found' } };
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, data: { error: 'Request body must be a JSON object' } };

    if (!match[1] && method === 'POST') {
        const { name, skillId, skillName, personaId, scheduleType, cronExpression, intervalMs, eventTrigger, oneTimeAt, timeout, retries, tags, inputs } = body;
        if (!name || !skillId || !scheduleType) return { status: 400, data: { error: 'Missing required fields: name, skillId, scheduleType' } };
        const target = { skillId: skillId as string, personaId: (personaId as string) || 'general' };
        if (personaDenied(scheduler, principal, target)) return personaError;
        const job = scheduler.createJob({
            // Without the tenant stamp executeJob quarantines the job as legacy and it never runs.
            tenantId: principal.tenantId,
            name: name as string,
            skillId: target.skillId,
            skillName: (skillName as string) || target.skillId,
            personaId: target.personaId,
            scheduleType: scheduleType as ScheduledJob['scheduleType'],
            cronExpression: cronExpression as string | undefined,
            intervalMs: intervalMs as number | undefined,
            eventTrigger: eventTrigger as string | undefined,
            oneTimeAt: oneTimeAt as string | undefined,
            timeout: timeout as number | undefined,
            retries: retries as number | undefined,
            tags: (tags as string[]) || [],
            inputs: inputs as Record<string, unknown> | undefined,
            status: 'active',
            createdBy: principal.id,
        });
        return { status: 201, data: { job } };
    }

    const job = match[1] ? scheduler.getJob(match[1]) : null;
    if (!job) return { status: 404, data: { error: 'Job not found' } };
    const denied = manageable(principal, job);
    if (denied) return denied;

    if (method === 'DELETE' && !match[2]) {
        scheduler.deleteJob(job.id);
        return { status: 200, data: { deleted: job.id } };
    }
    if (method === 'PATCH' && !match[2]) {
        const rejected = Object.keys(body).filter(key => !EDITABLE.has(key as keyof ScheduledJob));
        if (rejected.length) return { status: 400, data: { error: `Fields cannot be changed: ${rejected.join(', ')}` } };
        const updates = body as Partial<ScheduledJob>;
        if (('skillId' in updates || 'personaId' in updates) && personaDenied(scheduler, principal, { skillId: updates.skillId ?? job.skillId, personaId: updates.personaId ?? job.personaId })) return personaError;
        return { status: 200, data: { job: scheduler.updateJob(job.id, updates) } };
    }
    if (method === 'POST' && match[2] === 'run') {
        // Persona scopes can be narrowed after a job was created, so Run Now is
        // authorized against the caller's current scopes, as /api/execute would be.
        if (personaDenied(scheduler, principal, job)) return personaError;
        const log = await scheduler.executeJob(job.id, 'manual');
        return { status: 200, data: { log, job: scheduler.getJob(job.id) } };
    }
    if (method === 'POST' && match[2] === 'toggle') {
        // Reactivating a job re-arms it to run as its creator, which is a fresh grant.
        if (job.status !== 'active' && personaDenied(scheduler, principal, job)) return personaError;
        return { status: 200, data: { job: scheduler.updateJob(job.id, { status: job.status === 'active' ? 'paused' : 'active' }) } };
    }
    return { status: 405, data: { error: 'Unsupported schedule operation' } };
}
