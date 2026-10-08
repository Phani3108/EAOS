import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Statements that leave `role` with exactly the privileges production gives the
 * gateway's database login: the GRANTs of deploy/postgres/app-role.sql, which
 * the production compose runs after every migration.
 *
 * The acceptance suites used to grant the fixture role DML on every table, so a
 * table the gateway needed but the grant script missed passed CI and failed in
 * production with "permission denied". Table privileges are revoked first, so a
 * fixture database reused from a run with broader grants cannot mask a gap.
 */
export function productionGrants(role: string): string[] {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`Unexpected fixture role name: ${role}`);
  const grants = readFileSync(resolve('deploy/postgres/app-role.sql'), 'utf8')
    .split('\n')
    .filter(line => line.startsWith('GRANT '))
    .map(line => line.replaceAll(':"app_role"', role));
  if (grants.length === 0 || grants.some(grant => grant.includes(':'))) throw new Error('Could not read the production grants from deploy/postgres/app-role.sql');
  return [`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`, ...grants];
}
