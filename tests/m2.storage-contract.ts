import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { RuntimePool, PostgresRunRepository, RuntimeSnapshot } from '../packages/db/dist/run-repository.js';

export async function verifyScheduleStorage(pool: RuntimePool, runs: PostgresRunRepository, snapshot: RuntimeSnapshot, definition: Record<string, unknown>) {
  const { PostgresScheduleRepository, nextCronTime } = await import('../packages/db/dist/schedule-repository.js');
  assert.equal(nextCronTime('*/15 9-17 * * MON-FRI', new Date('2026-09-11T17:45:00Z')).toISOString(), '2026-09-14T09:00:00.000Z');
  for (const invalid of ['*/0 * * * *', '* 25 * * *', '* * * * WHAT', '* * *', '* * 35 * *']) assert.throws(() => nextCronTime(invalid));
  const schedules = new PostgresScheduleRepository(pool, runs);
  const owner = { tenantId: snapshot.tenantId, userId: snapshot.userId };
  const template = { snapshot, definition, payload: {} };
  const once = await schedules.create(owner, { name: 'Fixture once', scheduleType: 'once', nextRunAt: '2020-01-01T00:00:00Z', template });
  const dispatched = await Promise.all([schedules.dispatchDue(owner.tenantId), schedules.dispatchDue(owner.tenantId)]);
  assert.equal(dispatched.filter(Boolean).length, 1);
  assert.equal((await schedules.get(owner, once.id))?.status, 'completed');
  await runs.cancel(owner.tenantId, dispatched.find(Boolean)!, owner.userId);
  const event = await schedules.create(owner, { name: 'Fixture event', scheduleType: 'event', eventTrigger: 'fixture.changed', template });
  const received = await Promise.all([schedules.trigger(owner, event.id, 'same-delivery', { event: 1 }), schedules.trigger(owner, event.id, 'same-delivery', { event: 1 })]);
  assert.equal(received[0], received[1]);
  await assert.rejects(schedules.trigger(owner, event.id, 'same-delivery', { event: 2 }));
  assert.equal(await schedules.get({ ...owner, tenantId: 'unknown-tenant' }, event.id), undefined);
  await runs.cancel(owner.tenantId, received[0]!, owner.userId);
  await schedules.setStatus(owner, event.id, 'paused', event.version);
  console.log('PASS bounded UTC cron, atomic due schedules, trigger replay/conflict and owner-scoped schedules');
}

export async function verifyWorkspaceStorage(pool: RuntimePool, tenantId: string, foreignTenantId: string) {
  const { PostgresWorkspaceRepository } = await import('../packages/db/dist/workspace-repository.js');
  const repository = new PostgresWorkspaceRepository(pool);
  const owner = { tenantId, userId: `user-${tenantId}` };
  const stranger = { tenantId: foreignTenantId, userId: `user-${foreignTenantId}` };
  const id = randomUUID();
  const record = await repository.putRecord(owner, 'knowledge', id, { title: 'Fixture', content: 'Private fixture content' }, 0);
  assert.equal(record.version, 1);
  assert.equal(await repository.getRecord(stranger, 'knowledge', id), undefined);
  assert.equal((await repository.listRecords(stranger, 'knowledge')).length, 0);
  const contenders = await Promise.allSettled([
    repository.putRecord(owner, 'knowledge', id, { title: 'First contender' }, 1),
    repository.putRecord(owner, 'knowledge', id, { title: 'Second contender' }, 1),
  ]);
  assert.equal(contenders.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await new PostgresWorkspaceRepository(pool).getRecord(owner, 'knowledge', id))?.version, 2);
  assert.equal(await repository.archiveRecord(stranger, 'knowledge', id, 2), false);
  assert.equal(await repository.archiveRecord(owner, 'knowledge', id, 2), true);
  assert.equal(await repository.getRecord(owner, 'knowledge', id), undefined);

  const chat = await repository.createChat(owner, { title: 'Fixture conversation', persona: 'engineering' });
  const messages = await Promise.all(['one', 'two'].map(content => repository.appendChat(owner, chat.sessionId, { role: 'user', content })));
  assert.notEqual(messages[0].sequence, messages[1].sequence);
  await assert.rejects(repository.appendChat(stranger, chat.sessionId, { role: 'user', content: 'unauthorized' }));
  assert.equal(await repository.getChat(stranger, chat.sessionId), undefined);
  assert.equal((await repository.listChatMessages(owner, chat.sessionId)).length, 2);
  assert.equal((await new PostgresWorkspaceRepository(pool).listChatMessages(owner, chat.sessionId)).length, 2);
  assert.equal(await repository.archiveChat(owner, chat.sessionId), true);
  await assert.rejects(repository.appendChat(owner, chat.sessionId, { role: 'agent', content: 'late reply' }));

  await assert.rejects(repository.saveConnection(owner, 'github', { provider: 'env', path: 'GITHUB_TOKEN' }));
  await assert.rejects(repository.saveConnection(owner, 'github', { provider: 'vault', path: `${foreignTenantId}/token` }));
  const connection = await repository.saveConnection(owner, 'github', { provider: 'vault', path: `${tenantId}/${owner.userId}/github` });
  assert.equal(connection.status, 'configured');
  assert.equal(await repository.getConnection(stranger, 'github'), undefined);
  assert.equal((await repository.getConnection(owner, 'github'))?.secretRef.provider, 'vault');
  console.log('PASS workspace CAS/restart/isolation, private chat ordering/archive, tenant-owned secret references');
}
