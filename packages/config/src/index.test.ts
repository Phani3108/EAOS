/**
 * Env validation contract.
 *
 * These tests encode the four boot crashes this package exists to prevent. Each
 * one previously killed the process during module evaluation, before any logger
 * or health endpoint existed, producing an invisible container restart loop.
 */

import { describe, expect, it } from 'vitest';
import { EX_CONFIG, formatEnvReport, validateEnv } from './index.js';

/** A minimal production env that should validate cleanly. */
const PROD_OK: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  JWT_SECRET: 'a-real-secret-value-not-a-placeholder',
  CORS_ALLOWED_ORIGINS: 'https://app.example.com',
  DATABASE_URL: 'postgresql://user:pw@host:5432/eaos',
  ANTHROPIC_API_KEY: 'sk-ant-real',
};

const errorKeys = (env: NodeJS.ProcessEnv) =>
  validateEnv(env)
    .problems.filter(p => p.severity === 'error')
    .map(p => p.key);

describe('defaults', () => {
  it('validates an empty env as development, with warnings but no errors', () => {
    const r = validateEnv({});
    expect(r.ok).toBe(true);
    expect(r.env.NODE_ENV).toBe('development');
    expect(r.env.PORT).toBe(3000);
  });

  it('defaults the flags that used to default dangerously', () => {
    const { env } = validateEnv({});
    // These two shipped ON by default: SEED_DEMO put demo data into production,
    // and ALLOW_ANON treated every unauthenticated request as a real user.
    expect(env.SEED_DEMO).toBe(false);
    expect(env.ALLOW_ANON).toBe(false);
    expect(env.MEMORY_ALLOW_SYNTHETIC_EMBEDDINGS).toBe(false);
    expect(env.REQUIRE_SIGNED_TOKENS).toBe(true);
  });
});

describe('crash path 1 — missing signing secret in production', () => {
  it('is an error, not a module-load throw', () => {
    expect(errorKeys({ NODE_ENV: 'production' })).toContain('JWT_SECRET');
  });

  it('accepts AUTH_SECRET as an alias', () => {
    expect(errorKeys({ NODE_ENV: 'production', AUTH_SECRET: 'real-secret-here' })).not.toContain(
      'JWT_SECRET',
    );
  });

  it('is not required outside production', () => {
    expect(errorKeys({ NODE_ENV: 'development' })).not.toContain('JWT_SECRET');
  });

  it('rejects the placeholder secret that shipped in the repo', () => {
    // deploy/docker-compose.production.yml defaulted to this value, so anyone who
    // read the repo could mint admin tokens against a default deploy.
    const keys = errorKeys({
      NODE_ENV: 'production',
      JWT_SECRET: 'agentos-production-secret-change-me',
    });
    expect(keys).toContain('JWT_SECRET');
  });
});

describe('security flags are explicit, never inferred from NODE_ENV', () => {
  it('refuses anonymous access in production', () => {
    expect(errorKeys({ ...PROD_OK, ALLOW_ANON: 'true' })).toContain('ALLOW_ANON');
  });

  it('warns but allows anonymous access outside production', () => {
    const r = validateEnv({ ALLOW_ANON: 'true' });
    expect(r.ok).toBe(true);
    expect(r.problems.some(p => p.key === 'ALLOW_ANON' && p.severity === 'warning')).toBe(true);
  });

  it('rejects a mistyped boolean rather than coercing it', () => {
    // `ALLOW_ANON=1` or `=yes` silently read as "not the string false" under the
    // old `!== 'false'` check, i.e. it enabled anonymous access.
    expect(errorKeys({ ALLOW_ANON: 'yes' })).toContain('ALLOW_ANON');
    expect(errorKeys({ SEED_DEMO: '1' })).toContain('SEED_DEMO');
  });

  it('refuses synthetic embeddings in production', () => {
    expect(errorKeys({ ...PROD_OK, MEMORY_ALLOW_SYNTHETIC_EMBEDDINGS: 'true' })).toContain(
      'MEMORY_ALLOW_SYNTHETIC_EMBEDDINGS',
    );
  });

  it('warns when CORS is unset in production (fail closed, not wildcard)', () => {
    const { CORS_ALLOWED_ORIGINS: _omitted, ...noCors } = PROD_OK;
    const r = validateEnv(noCors);
    expect(r.ok).toBe(true);
    expect(r.problems.some(p => p.key === 'CORS_ALLOWED_ORIGINS')).toBe(true);
  });
});

describe('value validation', () => {
  it('rejects a non-integer or out-of-range PORT', () => {
    expect(errorKeys({ PORT: 'eighty' })).toContain('PORT');
    expect(errorKeys({ PORT: '70000' })).toContain('PORT');
    expect(errorKeys({ PORT: '8080' })).not.toContain('PORT');
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(errorKeys({ NODE_ENV: 'staging' })).toContain('NODE_ENV');
  });

  it('rejects a setup token short enough to guess', () => {
    expect(errorKeys({ EAOS_SETUP_TOKEN: 'short' })).toContain('EAOS_SETUP_TOKEN');
    expect(errorKeys({ EAOS_SETUP_TOKEN: 'x'.repeat(32) })).not.toContain('EAOS_SETUP_TOKEN');
  });
});

describe('a valid production env', () => {
  it('passes', () => {
    const r = validateEnv(PROD_OK);
    expect(r.ok).toBe(true);
    expect(r.problems.filter(p => p.severity === 'error')).toEqual([]);
  });
});

describe('the report', () => {
  it('never echoes a secret value', () => {
    const env = { ...PROD_OK, ANTHROPIC_API_KEY: 'sk-ant-SUPERSECRET' };
    const report = formatEnvReport(validateEnv(env), env);

    expect(report).not.toContain('SUPERSECRET');
    expect(report).not.toContain('a-real-secret-value-not-a-placeholder');
    expect(report).not.toContain('user:pw');
    // …but still says whether it is present, which is the operational question.
    expect(report).toMatch(/ANTHROPIC_API_KEY\s+set/);
  });

  it('shows missing values as an em-dash and names the default', () => {
    const report = formatEnvReport(validateEnv({}), {});
    expect(report).toMatch(/JWT_SECRET\s+—/);
    expect(report).toMatch(/PORT\s+— \(default 3000\)/);
  });

  it('lists every error with its key', () => {
    const env = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
    expect(formatEnvReport(validateEnv(env), env)).toContain('[config] ERROR JWT_SECRET');
  });
});

describe('exit code', () => {
  it('is EX_CONFIG (78), the conventional configuration-error code', () => {
    expect(EX_CONFIG).toBe(78);
  });
});
