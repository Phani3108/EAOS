import { describe, expect, it } from 'vitest';
import { metricRoute, RequestMeasurements, resolvePlatformPrincipal } from './platform-observability.js';
import type { PlatformRepository } from '@agentos/db/platform-repository';
import type { AuthUser } from './auth.js';

const principal: AuthUser = { id: 'fixture', tenantId: 'fixture', role: 'admin', name: 'Fixture', email: 'fixture@example.invalid', teams: [], personaScopes: ['*'] };
describe('measured operations and membership attenuation', () => {
  it('never puts resource IDs or query strings into metric labels', () => {
    expect(metricRoute('/api/executions/private-run-id')).toBe('/api/executions');
    expect(metricRoute('/api/unknown/private-customer')).toBe('/api/other');
  });
  it('records real observations and reports storage loss rather than invented counters', async () => {
    const records: unknown[][] = [];
    const measurements = new RequestMeasurements({ recordRequest: async (...args: unknown[]) => { records.push(args); } } as unknown as PlatformRepository);
    measurements.record('tenant', 'GET', '/api/executions/private', 403, 12);
    await measurements.flush();
    expect(records).toEqual([['tenant','GET','/api/executions',403,12]]);
    const failed = new RequestMeasurements({ recordRequest: async () => { throw new Error('Fixture storage unavailable'); } } as unknown as PlatformRepository);
    failed.record('tenant', 'GET', '/api/catalog', 500, 1);
    await failed.flush();
    expect(failed.dropped).toBe(1);
  });
  it('attenuates old credentials and denies suspended membership', async () => {
    const repository = { membership: async () => ({ role: 'operator', state: 'active', personaScopes: ['engineering'], version: 1 }) } as unknown as PlatformRepository;
    expect(await resolvePlatformPrincipal(repository, principal)).toMatchObject({ role: 'operator', personaScopes: ['engineering'] });
    expect(await resolvePlatformPrincipal(repository, { ...principal, role: 'user', personaScopes: ['marketing'] })).toMatchObject({ role: 'user', personaScopes: [] });
    expect(await resolvePlatformPrincipal({ membership: async () => ({ state: 'suspended' }) } as unknown as PlatformRepository, principal)).toBeUndefined();
  });
});
