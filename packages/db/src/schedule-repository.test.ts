import { describe, expect, it } from 'vitest';
import { nextCronTime } from './schedule-repository.js';

describe('timezone-aware durable cron', () => {
  it('skips a nonexistent spring-forward wall clock', () => {
    expect(nextCronTime('30 2 * * *', new Date('2026-03-07T07:30:00Z'), 'America/New_York').toISOString()).toBe('2026-03-09T06:30:00.000Z');
  });
  it('does not repeat the same fall-back occurrence', () => {
    expect(nextCronTime('30 1 * * *', new Date('2026-11-01T05:30:00Z'), 'America/New_York', '2026-11-01T01:30').toISOString()).toBe('2026-11-02T06:30:00.000Z');
  });
  it('rejects invalid zones and unbounded cron steps', () => {
    expect(() => nextCronTime('* * * * *', new Date(), 'Invalid/Zone')).toThrow();
    expect(() => nextCronTime('*/0 * * * *')).toThrow();
  });
});
