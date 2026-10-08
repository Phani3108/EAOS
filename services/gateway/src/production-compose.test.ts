/**
 * deploy/docker-compose.production.yml and deploy/.env.example must describe a
 * deployment that works and exposes nothing by default.
 *
 * Before this contract: Redis was published on every host interface with no
 * password while the gateway pushed every tenant's stream events through it; the
 * documented `cp deploy/.env.example deploy/.env` supplied the old public
 * passwords (eaos-dev-password, admin), a DATABASE_URL on `localhost` naming the
 * superuser — which production refuses, so every API route answered 503 while the
 * liveness healthcheck stayed green — and no way to create the non-owner login.
 *
 * Variables are resolved the way Compose resolves them (`${VAR}`, `${VAR:-default}`,
 * `${VAR:?error}`), so the URLs checked here are the ones the containers receive.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');
const composeText = read('deploy/docker-compose.production.yml');
const envTemplate = read('deploy/.env.example');
const appRoleSql = read('deploy/postgres/app-role.sql');

interface Service { image?: string; command?: string | string[]; ports?: string[]; environment?: string[]; depends_on?: Record<string, { condition: string }>; volumes?: string[]; healthcheck?: { test: string[] } }
const services = (parse(composeText) as { services: Record<string, Service> }).services;

/** Every `${...}` reference in the compose file, with its Compose modifier. */
const references = [...composeText.matchAll(/\$\{([A-Z0-9_]+)(?:(:[-?])([^}]*))?\}/g)]
  .map(([, name, modifier, argument]) => ({ name: name!, modifier, argument: argument ?? '' }));

/** KEY=value pairs of an env file, as Compose reads deploy/.env. */
const templateValues = Object.fromEntries(envTemplate.split('\n')
  .filter(line => /^[A-Z0-9_]+=/.test(line))
  .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));

function interpolate(value: string, vars: Record<string, string>): string {
  return value.replace(/\$\{([A-Z0-9_]+)(?:(:[-?])([^}]*))?\}/g, (_, name: string, modifier?: string, argument = '') => {
    const current = vars[name];
    if (modifier === ':?' && !current) throw new Error(`required variable ${name} is missing a value: ${argument}`);
    if (modifier === ':-' && !current) return argument;
    return current ?? '';
  });
}

const environmentOf = (service: Service, vars: Record<string, string>) => Object.fromEntries((service.environment ?? [])
  .map(entry => [entry.slice(0, entry.indexOf('=')), interpolate(entry.slice(entry.indexOf('=') + 1), vars)]));

const isSecret = (name: string) => /PASSWORD|SECRET|TOKEN|_KEY$|_AUTH$/.test(name);
/** What an operator writes into deploy/.env: every blank REQUIRED value filled in. */
const filled = { ...templateValues, POSTGRES_PASSWORD: 'a'.repeat(64), EAOS_APP_DB_PASSWORD: 'b'.repeat(64), REDIS_PASSWORD: 'c'.repeat(64), JWT_SECRET: 'd'.repeat(64), GRAFANA_PASSWORD: 'e'.repeat(64) };
const PUBLIC_VALUES = ['eaos-dev-password', 'eaos-local-dev-only', 'change-me', 'GRAFANA_PASSWORD=admin', ':-admin}'];

describe('production compose: Redis', () => {
  it('is not published on the host', () => {
    expect(services.redis!.ports ?? []).toEqual([]);
  });

  it('requires the REDIS_PASSWORD that the gateway authenticates with', () => {
    const command = interpolate(String(services.redis!.command), filled);
    expect(command).toMatch(new RegExp(`--requirepass "?${filled.REDIS_PASSWORD}"?( |$)`));
    const gateway = new URL(environmentOf(services.gateway!, filled).REDIS_URL!);
    expect(gateway.password).toBe(filled.REDIS_PASSWORD);
    expect(gateway.hostname).toBe('redis');
  });

  it('reports healthy only when an authenticated PING answers PONG', () => {
    expect(environmentOf(services.redis!, filled).REDISCLI_AUTH).toBe(filled.REDIS_PASSWORD);
    expect(services.redis!.healthcheck!.test.join(' ')).toMatch(/redis-cli ping \| grep -q PONG/);
  });
});

describe('production compose: database roles', () => {
  const owner = environmentOf(services.postgres!, filled).POSTGRES_USER!;
  const database = environmentOf(services.postgres!, filled).POSTGRES_DB!;

  it('runs migrations as the owner and the gateway as a separate login on the postgres service', () => {
    const migrate = new URL(environmentOf(services.migrate!, filled).DATABASE_URL!);
    const gateway = new URL(environmentOf(services.gateway!, filled).DATABASE_URL!);
    expect(migrate.username).toBe(owner);
    expect(gateway.username).not.toBe(owner);
    for (const url of [migrate, gateway]) {
      expect(url.hostname).toBe('postgres');
      expect(url.pathname).toBe(`/${database}`);
    }
    expect(gateway.password).toBe(filled.EAOS_APP_DB_PASSWORD);
  });

  it('provisions that login, after migrations and before the gateway, with the grant script', () => {
    const gatewayLogin = new URL(environmentOf(services.gateway!, filled).DATABASE_URL!).username;
    expect(appRoleSql).toContain(`\\set app_role ${gatewayLogin}`);
    const appRole = services['app-role']!;
    expect(appRole.depends_on?.migrate?.condition).toBe('service_completed_successfully');
    expect(services.gateway!.depends_on?.['app-role']?.condition).toBe('service_completed_successfully');
    expect(appRole.volumes).toContain('./postgres/app-role.sql:/eaos/app-role.sql:ro');
    expect(appRole.command).toEqual(expect.arrayContaining(['-f', '/eaos/app-role.sql']));
    const env = environmentOf(appRole, filled);
    expect(env).toMatchObject({ PGHOST: 'postgres', PGUSER: owner, PGDATABASE: database, PGPASSWORD: filled.POSTGRES_PASSWORD, EAOS_APP_DB_PASSWORD: filled.EAOS_APP_DB_PASSWORD });
  });

  it('publishes Postgres on loopback only', () => {
    expect(services.postgres!.ports!.length).toBeGreaterThan(0);
    for (const port of services.postgres!.ports!) expect(port).toMatch(/^127\.0\.0\.1:/);
  });
});

describe('deploy/.env.example', () => {
  it('lists exactly the variables the compose file reads', () => {
    expect(Object.keys(templateValues).sort()).toEqual([...new Set(references.map(reference => reference.name))].sort());
  });

  it('ships no secret: every secret is blank, and compose refuses the template until each required one is set', () => {
    for (const [name, value] of Object.entries(templateValues)) if (isSecret(name)) expect({ name, value }).toEqual({ name, value: '' });
    const required = [...new Set(references.filter(reference => reference.modifier === ':?').map(reference => reference.name))];
    expect(required.sort()).toEqual(['EAOS_APP_DB_PASSWORD', 'GRAFANA_PASSWORD', 'JWT_SECRET', 'POSTGRES_PASSWORD', 'REDIS_PASSWORD']);
    for (const name of required) {
      expect(() => interpolate(composeText, { ...filled, [name]: templateValues[name]! })).toThrow(`required variable ${name}`);
    }
    expect(() => interpolate(composeText, filled)).not.toThrow();
  });

  it('gives no secret a default in the compose file, and carries none of the old public passwords', () => {
    for (const reference of references) if (isSecret(reference.name) && reference.modifier === ':-') expect(reference).toMatchObject({ argument: '' });
    for (const value of PUBLIC_VALUES) {
      expect(composeText).not.toContain(value);
      expect(envTemplate).not.toContain(value);
    }
  });
});

describe('deploy/postgres/app-role.sql', () => {
  const migrations = readdirSync(join(repoRoot, 'packages/db/migrations')).filter(name => name.endsWith('.sql')).map(name => read(`packages/db/migrations/${name}`)).join('\n');
  const createdTables = new Set([...migrations.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_0-9]+)/gi)].map(match => match[1]!.toLowerCase()));
  const createdFunctions = new Set([...migrations.matchAll(/CREATE (?:OR REPLACE )?FUNCTION ([a-z_0-9]+)\(/gi)].map(match => match[1]!.toLowerCase()));

  it('grants only on tables and functions the migrations create', () => {
    const grants = appRoleSql.split('\n').filter(line => line.startsWith('GRANT '));
    expect(grants.length).toBeGreaterThan(5);
    for (const grant of grants) {
      const target = grant.match(/ ON (.+) TO :"app_role";$/)?.[1];
      expect(target, grant).toBeTruthy();
      if (target!.startsWith('SCHEMA ')) continue;
      if (target!.startsWith('FUNCTION ')) {
        for (const fn of target!.slice('FUNCTION '.length).matchAll(/([a-z_0-9]+)\(/g)) expect(createdFunctions, fn[1]).toContain(fn[1]);
        continue;
      }
      for (const table of target!.split(',').map(name => name.trim())) expect(createdTables, table).toContain(table);
    }
  });

  it('never grants more than row access, and strips every attribute that bypasses row-level security', () => {
    expect(appRoleSql).not.toMatch(/GRANT (ALL|CREATE|TRUNCATE|REFERENCES|TRIGGER)\b/);
    expect(appRoleSql).toMatch(/ALTER ROLE :"app_role" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS/);
    expect(appRoleSql).toMatch(/must be a separate role, not the database owner/);
  });
});
