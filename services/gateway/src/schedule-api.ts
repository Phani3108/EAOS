import { z } from 'zod';
import { WORKFLOW_PERSONAS } from '@agentos/skills/schema';
import type { RuntimeSnapshot } from '@agentos/db/run-repository';
import type { PostgresScheduleRepository, ScheduleRecord } from '@agentos/db/schedule-repository';
import type { AuthUser } from './auth.js';
import { requirePersonaAccess } from './auth.js';
import { getCompiledDefinition, requiredPersonas } from './definition-registry.js';
import { preparePersonaExecution } from './persona-api.js';
import { validate } from './validation.js';

const inputSchema = z.object({
  name: z.string().trim().min(1).max(240), skillId: z.string().min(1).max(200), personaId: z.enum(WORKFLOW_PERSONAS),
  scheduleType: z.enum(['one-time','once','interval','cron','event']), cronExpression: z.string().max(100).optional(),
  intervalMs: z.number().int().min(1000).max(31_536_000_000).optional(), eventTrigger: z.string().min(1).max(200).optional(),
  oneTimeAt: z.string().datetime({ offset: true }).optional(), inputs: z.record(z.string(), z.unknown()).default({}), simulate: z.boolean().default(false),
  timezone: z.string().min(1).max(100).default('UTC'), overlapPolicy: z.enum(['allow','skip']).default('skip'), inputBindings: z.record(z.string().max(100), z.string().max(500)).optional(),
  skillName: z.string().optional(), tags: z.array(z.string()).max(30).optional(), timeout: z.number().int().min(1).max(86_400).optional(), retries: z.number().int().nonnegative().max(9).optional(),
}).strict();
const route = /^\/api\/scheduler\/jobs(?:\/([^/]+)(?:\/(run|toggle))?)?$/;
export const isScheduleRoute = (path: string, method: string) => route.test(path) && ['GET','POST','PATCH','DELETE'].includes(method) || ['/api/scheduler/events','/api/scheduler/stats'].includes(path) && ['GET','POST'].includes(method);
const view = (record: ScheduleRecord) => ({ id: record.id, tenantId: record.tenantId, createdBy: record.userId, name: record.data.name, status: record.status, version: record.version, nextRun: record.nextRun, scheduleType: record.data.scheduleType === 'once' ? 'one-time' : record.data.scheduleType, skillId: record.data.template.snapshot.skillId, skillName: record.data.template.snapshot.skillName, personaId: record.data.template.snapshot.persona, inputs: record.data.template.snapshot.inputs, intervalMs: record.data.intervalMs, cronExpression: record.data.cronExpression, eventTrigger: record.data.eventTrigger, timezone: record.data.timezone ?? 'UTC', overlapPolicy: record.data.overlapPolicy ?? 'allow', inputBindings: record.data.inputBindings });

export async function scheduleRequest(repository: PostgresScheduleRepository, principal: AuthUser, path: string, method: string, body: Record<string, unknown>): Promise<{ status: number; data: unknown }> {
  if (!['admin','operator'].includes(principal.role)) return { status: 403, data: { error: 'Operator role required' } };
  const owner = { tenantId: principal.tenantId, userId: principal.id };
  if (path === '/api/scheduler/events' && method === 'POST') {
    const input = validate(z.object({ trigger: z.string().min(1), deliveryId: z.string().min(1).max(200), data: z.record(z.string(), z.unknown()).default({}) }).strict(), body);
    const schedules = (await repository.list(owner)).filter(schedule => schedule.data.scheduleType === 'event' && schedule.data.eventTrigger === input.trigger);
    const runs = [];
    for (const schedule of schedules) runs.push(await repository.trigger(owner, schedule.id, input.deliveryId, input.data));
    return { status: 200, data: { runs } };
  }
  if (path === '/api/scheduler/stats' && method === 'GET') {
    const jobs = await repository.list(owner);
    return { status: 200, data: { total: jobs.length, active: jobs.filter(job => job.status === 'active').length, paused: jobs.filter(job => job.status === 'paused').length } };
  }
  const match = path.match(route);
  if (!match) return { status: 404, data: { error: 'Schedule route not found' } };
  if (!match[1] && method === 'GET') return { status: 200, data: { jobs: (await repository.list(owner)).map(view) } };
  if (!match[1] && method === 'POST') {
    const input = validate(inputSchema, body);
    const definition = getCompiledDefinition(input.skillId, input.personaId);
    if (!definition) return { status: 404, data: { error: 'Definition not found' } };
    if (!requirePersonaAccess(principal, definition.persona) || requiredPersonas(definition).some(persona => !requirePersonaAccess(principal, persona))) return { status: 403, data: { error: 'Schedule requires additional persona permissions' } };
    if (input.scheduleType === 'interval' && !input.intervalMs || input.scheduleType === 'event' && !input.eventTrigger || input.scheduleType === 'cron' && !input.cronExpression) return { status: 400, data: { error: 'Missing schedule timing or trigger' } };
    const prepared = preparePersonaExecution(owner.tenantId, input.personaId, definition, { ...input.inputs, ...Object.fromEntries(Object.keys(input.inputBindings ?? {}).map(field => [field, '<event-bound>'])) }, owner.userId, input.simulate);
    const job = await repository.create(owner, { name: input.name, scheduleType: input.scheduleType === 'one-time' ? 'once' : input.scheduleType, nextRunAt: input.oneTimeAt, intervalMs: input.intervalMs, cronExpression: input.cronExpression, eventTrigger: input.eventTrigger, timezone: input.timezone, overlapPolicy: input.overlapPolicy, inputBindings: input.inputBindings,
      template: { snapshot: prepared.exec as unknown as RuntimeSnapshot, definition: { ...prepared.definition }, payload: { ...prepared.payload, timeoutMs: (input.timeout ?? 120) * 1000, maxAttempts: (input.retries ?? 2) + 1 } } });
    return { status: 201, data: { job: view(job) } };
  }
  const job = await repository.get(owner, match[1]!);
  if (!job) return { status: 404, data: { error: 'Schedule not found' } };
  if (method === 'GET' && !match[2]) return { status: 200, data: { job: view(job) } };
  if (method === 'POST' && match[2] === 'run') {
    const input = validate(z.object({ deliveryId: z.string().min(1).max(200) }).strict(), body);
    return { status: 201, data: { executionId: await repository.trigger(owner, job.id, input.deliveryId) } };
  }
  if (method === 'PATCH' || method === 'DELETE' || method === 'POST' && match[2] === 'toggle') {
    const input = validate(z.object({ version: z.number().int().positive(), status: z.enum(['active','paused']).optional() }).strict(), body);
    if (method === 'DELETE') {
      const archived = await repository.archive(owner, job.id, input.version);
      return { status: archived ? 200 : 409, data: { archived } };
    }
    const status = input.status ?? (job.status === 'active' ? 'paused' : 'active');
    const updated = await repository.setStatus(owner, job.id, status, input.version);
    return { status: updated ? 200 : 409, data: updated ? { job: view(updated) } : { error: 'Schedule changed' } };
  }
  return { status: 405, data: { error: 'Unsupported schedule operation' } };
}
