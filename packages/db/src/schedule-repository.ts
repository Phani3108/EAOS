import { createHash, randomUUID } from 'node:crypto';
import { PostgresRunRepository, RuntimeConflictError, type RuntimeClient, type RuntimePool, type RuntimeSnapshot } from './run-repository.js';
import { tenantTransaction } from './tenant-transaction.js';
import type { WorkspaceOwner } from './workspace-repository.js';

const cronFormatters = new Map<string, Intl.DateTimeFormat>();
export function cronLocalTime(time: Date, timezone = 'UTC'): { minute: number; hour: number; day: number; month: number; weekday: number; key: string } {
  let formatter = cronFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
    if (cronFormatters.size >= 64) cronFormatters.delete(cronFormatters.keys().next().value!);
    cronFormatters.set(timezone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(time).map(part => [part.type, part.value]));
  return { minute: Number(parts.minute), hour: Number(parts.hour), day: Number(parts.day), month: Number(parts.month), weekday: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday!), key: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` };
}

export function nextCronTime(expression: string, after = new Date(), timezone = 'UTC', previousLocalTime?: string): Date {
  const fields = expression.trim().toUpperCase().split(/\s+/);
  if (fields.length !== 5 || !Number.isFinite(after.getTime())) throw new Error('Invalid UTC cron expression');
  const bounds = [[0,59],[0,23],[1,31],[1,12],[0,7]] as const;
  const names: Record<string, string> = { SUN: '0', MON: '1', TUE: '2', WED: '3', THU: '4', FRI: '5', SAT: '6' };
  const sets = fields.map((field, index) => {
    const [min,max] = bounds[index]!;
    const values = new Set<number>();
    const normalized = index === 4 ? field.replace(/SUN|MON|TUE|WED|THU|FRI|SAT/g, name => names[name]!) : field;
    for (const term of normalized.split(',')) {
      const match = term.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
      if (!match) throw new Error('Invalid cron field');
      const step = match[2] === undefined ? 1 : Number(match[2]);
      const range = match[1] === '*' ? [min,max] : match[1]!.split('-').map(Number);
      const start = range[0]!, end = range[1] ?? (match[2] === undefined ? start : max);
      if (!Number.isInteger(step) || step < 1 || step > max - min + 1 || start < min || end > max || start > end) throw new Error('Invalid cron range or step');
      for (let value = start; value <= end; value += step) values.add(index === 4 && value === 7 ? 0 : value);
    }
    return values;
  });
  const time = new Date(Math.floor(after.getTime() / 60_000) * 60_000 + 60_000);
  for (let i = 0; i < 527_040; i++, time.setUTCMinutes(time.getUTCMinutes() + 1)) {
    const local = timezone === 'UTC' ? { minute: time.getUTCMinutes(), hour: time.getUTCHours(), day: time.getUTCDate(), month: time.getUTCMonth() + 1, weekday: time.getUTCDay(), key: time.toISOString().slice(0,16) } : cronLocalTime(time, timezone);
    const day = sets[2]!.has(local.day), weekday = sets[4]!.has(local.weekday);
    const dayMatches = fields[2]!.startsWith('*') || fields[4]!.startsWith('*') ? day && weekday : day || weekday;
    if (sets[0]!.has(local.minute) && sets[1]!.has(local.hour) && sets[3]!.has(local.month) && dayMatches && (!previousLocalTime || local.key > previousLocalTime)) return time;
  }
  throw new Error('Cron has no occurrence within the supported one-year horizon');
}

export interface RunTemplate { snapshot: RuntimeSnapshot; definition: Record<string, unknown>; payload: Record<string, unknown> }
export interface ScheduleInput { name: string; scheduleType: 'once' | 'interval' | 'event' | 'cron'; cronExpression?: string; nextRunAt?: string; intervalMs?: number; eventTrigger?: string; template: RunTemplate; timezone?: string; overlapPolicy?: 'allow' | 'skip'; inputBindings?: Record<string, string>; lastLocalTime?: string }
export interface ScheduleRecord extends WorkspaceOwner { id: string; status: 'active' | 'paused' | 'completed' | 'failed'; version: number; nextRun: string | null; data: ScheduleInput }
const rowView = (row: Record<string, any>): ScheduleRecord => ({ id: row.id, tenantId: row.tenant_id, userId: row.user_id, status: row.status, version: row.version, nextRun: row.next_run_at?.toISOString() ?? null, data: row.data });
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class PostgresScheduleRepository {
  constructor(private readonly pool: RuntimePool, private readonly runs: PostgresRunRepository) {}
  async create(owner: WorkspaceOwner, data: ScheduleInput): Promise<ScheduleRecord> {
    if (!owner.userId || data.template.snapshot.tenantId !== owner.tenantId || data.template.snapshot.userId !== owner.userId || !data.name || data.name.length > 240) throw new Error('Invalid schedule owner or template');
    if (!['once', 'interval', 'event', 'cron'].includes(data.scheduleType)) throw new Error('Unsupported schedule type');
    if (data.scheduleType === 'interval' && (!Number.isSafeInteger(data.intervalMs) || data.intervalMs! < 1000 || data.intervalMs! > 31_536_000_000)) throw new Error('Invalid schedule interval');
    if (data.scheduleType === 'event' && !data.eventTrigger) throw new Error('Event trigger is required');
    if (data.timezone) cronLocalTime(new Date(), data.timezone);
    const fields = data.template.definition.inputs as Array<{ id: string; type: string }> | undefined;
    if (data.inputBindings && (data.scheduleType !== 'event' || Object.keys(data.inputBindings).length > 30 || Object.entries(data.inputBindings).some(([field, path]) => !fields?.some(item => item.id === field && ['text','textarea'].includes(item.type)) || !/^event(?:\.[a-zA-Z0-9_-]+)+$/.test(path) || path.split('.').some(part => ['__proto__','constructor','prototype'].includes(part))))) throw new Error('Event bindings must target declared text fields');
    const next = data.scheduleType === 'event' ? null : data.scheduleType === 'cron' ? nextCronTime(data.cronExpression ?? '', new Date(), data.timezone ?? 'UTC') : new Date(data.nextRunAt ?? Date.now());
    if (next && !Number.isFinite(next.getTime())) throw new Error('Invalid schedule time');
    return tenantTransaction(this.pool, owner.tenantId, async client => rowView((await client.query("INSERT INTO runtime_schedules (tenant_id,id,user_id,status,schedule_type,next_run_at,data) VALUES ($1,$2,$3,'active',$4,$5,$6) RETURNING *", [owner.tenantId, randomUUID(), owner.userId, data.scheduleType, next, JSON.stringify(data)])).rows[0]!));
  }
  async get(owner: WorkspaceOwner, id: string): Promise<ScheduleRecord | undefined> {
    return tenantTransaction(this.pool, owner.tenantId, async client => {
      const row = (await client.query('SELECT * FROM runtime_schedules WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND archived_at IS NULL', [owner.tenantId, owner.userId, id])).rows[0];
      return row ? rowView(row) : undefined;
    });
  }
  async list(owner: WorkspaceOwner): Promise<ScheduleRecord[]> {
    return tenantTransaction(this.pool, owner.tenantId, async client => (await client.query('SELECT * FROM runtime_schedules WHERE tenant_id=$1 AND user_id=$2 AND archived_at IS NULL ORDER BY created_at DESC,id LIMIT 100', [owner.tenantId, owner.userId])).rows.map(rowView));
  }
  async archive(owner: WorkspaceOwner, id: string, version: number): Promise<boolean> {
    return tenantTransaction(this.pool, owner.tenantId, async client => (await client.query("UPDATE runtime_schedules SET status='paused',archived_at=NOW(),version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND version=$4 AND archived_at IS NULL RETURNING id", [owner.tenantId, owner.userId, id, version])).rows.length === 1);
  }
  async setStatus(owner: WorkspaceOwner, id: string, status: 'active' | 'paused', version: number): Promise<ScheduleRecord | undefined> {
    return tenantTransaction(this.pool, owner.tenantId, async client => {
      const row = (await client.query('UPDATE runtime_schedules SET status=$4,version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND archived_at IS NULL AND version=$5 RETURNING *', [owner.tenantId, owner.userId, id, status, version])).rows[0];
      return row ? rowView(row) : undefined;
    });
  }
  private async admit(client: RuntimeClient, schedule: ScheduleRecord, deliveryId: string, payload: Record<string, unknown>): Promise<string> {
    const fingerprint = hash(payload);
    const receipt = (await client.query('SELECT run_id,payload_hash FROM runtime_trigger_receipts WHERE tenant_id=$1 AND source_id=$2 AND delivery_id=$3', [schedule.tenantId, schedule.id, deliveryId])).rows[0];
    if (receipt) {
      if (receipt.payload_hash !== fingerprint) throw new RuntimeConflictError('Trigger ID was reused with another payload');
      return receipt.run_id as string;
    }
    if (schedule.status !== 'active') throw new RuntimeConflictError('Schedule is not active');
    if (schedule.data.overlapPolicy === 'skip' && (await client.query("SELECT 1 FROM runtime_trigger_receipts t JOIN runtime_runs r ON r.tenant_id=t.tenant_id AND r.id=t.run_id WHERE t.tenant_id=$1 AND t.source_id=$2 AND r.status IN ('queued','running','paused') LIMIT 1", [schedule.tenantId, schedule.id])).rows.length) throw new RuntimeConflictError('A prior scheduled run is still active');
    const template = schedule.data.template;
    const snapshot: RuntimeSnapshot = { ...structuredClone(template.snapshot), id: randomUUID(), status: 'queued', startedAt: new Date().toISOString() };
    for (const [field, path] of Object.entries(schedule.data.inputBindings ?? {})) {
      let value: unknown = { event: payload };
      for (const part of path.split('.')) { if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) throw new RuntimeConflictError('Required event input is missing'); value = (value as Record<string, unknown>)[part]; }
      if (typeof value !== 'string' || !value.trim() || value.length > 4000) throw new RuntimeConflictError('Event text input is invalid or oversized');
      snapshot.inputs[field] = value;
    }
    const runPayload = { ...template.payload, execId: snapshot.id, tenantId: schedule.tenantId, userId: schedule.userId, inputs: snapshot.inputs };
    const run = await this.runs.submit(snapshot, template.definition, runPayload, `trigger:${hash([schedule.id, deliveryId])}`, { tenantId: schedule.tenantId, client });
    await client.query('INSERT INTO runtime_trigger_receipts (tenant_id,source_id,delivery_id,payload_hash,run_id) VALUES ($1,$2,$3,$4,$5)', [schedule.tenantId, schedule.id, deliveryId, fingerprint, run.id]);
    return run.id;
  }
  async trigger(owner: WorkspaceOwner, id: string, deliveryId: string, payload: Record<string, unknown> = {}): Promise<string> {
    if (!deliveryId || deliveryId.length > 200) throw new Error('Stable delivery ID is required');
    return tenantTransaction(this.pool, owner.tenantId, async client => {
      const row = (await client.query('SELECT * FROM runtime_schedules WHERE tenant_id=$1 AND user_id=$2 AND id=$3 AND archived_at IS NULL FOR UPDATE', [owner.tenantId, owner.userId, id])).rows[0];
      if (!row) throw new RuntimeConflictError('Schedule is unavailable');
      return this.admit(client, rowView(row), deliveryId, payload);
    });
  }
  async dispatchDue(tenantId: string): Promise<string | undefined> {
    return tenantTransaction(this.pool, tenantId, async client => {
      const row = (await client.query("SELECT * FROM runtime_schedules WHERE tenant_id=$1 AND status='active' AND archived_at IS NULL AND next_run_at<=NOW() ORDER BY next_run_at,id FOR UPDATE SKIP LOCKED LIMIT 1", [tenantId])).rows[0];
      if (!row) return undefined;
      const schedule = rowView(row);
      const allowed = (await client.query('SELECT runtime_actor_active($1,$2,$3::jsonb) AS active', [tenantId, schedule.userId, JSON.stringify(schedule.data.template.snapshot.requiredPersonas ?? [schedule.data.template.snapshot.persona])])).rows[0]?.active;
      if (!allowed) { await client.query("UPDATE runtime_schedules SET status='paused',version=version+1,data=jsonb_set(data,'{lastError}','\"Execution authority revoked\"') WHERE tenant_id=$1 AND id=$2", [tenantId, schedule.id]); return undefined; }
      const overlap = schedule.data.overlapPolicy === 'skip' && (await client.query("SELECT 1 FROM runtime_trigger_receipts t JOIN runtime_runs r ON r.tenant_id=t.tenant_id AND r.id=t.run_id WHERE t.tenant_id=$1 AND t.source_id=$2 AND r.status IN ('queued','running','paused') LIMIT 1", [tenantId, schedule.id])).rows.length > 0;
      const runId = overlap ? undefined : await this.admit(client, schedule, `due:${schedule.nextRun}`, {});
      const localTime = schedule.nextRun ? cronLocalTime(new Date(schedule.nextRun), schedule.data.timezone ?? 'UTC').key : undefined;
      const next = schedule.data.scheduleType === 'interval' ? new Date(Date.now() + schedule.data.intervalMs!) : schedule.data.scheduleType === 'cron' ? nextCronTime(schedule.data.cronExpression!, new Date(), schedule.data.timezone ?? 'UTC', localTime) : null;
      const data = { ...schedule.data, lastLocalTime: localTime, lastSkipReason: overlap ? 'overlap' : undefined };
      await client.query('UPDATE runtime_schedules SET next_run_at=$3,status=$4,data=$5,version=version+1,updated_at=NOW() WHERE tenant_id=$1 AND id=$2', [tenantId, schedule.id, next, next ? 'active' : overlap ? 'paused' : 'completed', JSON.stringify(data)]);
      return runId;
    });
  }
}
