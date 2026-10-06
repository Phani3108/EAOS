/**
 * Validated environment configuration.
 *
 * Why this package exists
 * ----------------------------------------------------------------------------
 * The gateway had four independent ways to die during module evaluation, and
 * none of them produced a usable diagnostic:
 *
 *   1. `packages/auth/src/middleware.ts` threw at import time when
 *      NODE_ENV=production and JWT_SECRET was unset.
 *   2. `PersistentStore` called `mkdirSync` with no try/catch — EROFS on a
 *      read-only filesystem.
 *   3. `PostgresStore.all()` throws by design, and eight `init*Store(store)`
 *      calls invoked it synchronously at import time.
 *   4. `initWorkflowStore()` built a second PersistentStore over the same file.
 *
 * A throw during module evaluation writes a stack trace and exits before any
 * logger, health endpoint, or listener exists. Under a container supervisor that
 * is an infinite restart loop whose cause is invisible.
 *
 * So: validation lives here, is called from `boot()`, and on failure prints a
 * table of what is set versus what is missing and exits 78 (EX_CONFIG, the
 * conventional "configuration error" code) rather than throwing.
 *
 * Zero dependencies, on purpose
 * ----------------------------------------------------------------------------
 * This is the first module the process loads, so it must not be able to fail at
 * import. A missing dependency is precisely that failure mode — `llm-tracer.ts`
 * silently produced zero spans for months because `@opentelemetry/api` was
 * absent from package.json and its dynamic import fell into a catch. The checks
 * needed here are presence, enum, integer range and boolean; none of that earns
 * a schema library.
 */

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

type VarKind = 'string' | 'int' | 'bool' | 'enum';

interface VarSpec {
  kind: VarKind;
  /** Never printed. Reported as `set` / `—`. */
  secret?: boolean;
  default?: string | number | boolean;
  values?: readonly string[];
  min?: number;
  max?: number;
  /** Minimum string length when present. */
  minLength?: number;
  note?: string;
}

const SPEC = {
  NODE_ENV: { kind: 'enum', values: ['development', 'test', 'production'], default: 'development' },
  PORT: { kind: 'int', default: 3000, min: 1, max: 65535 },

  // ── Security ──────────────────────────────────────────────────────────────
  /** HS256 signing secret. Comma-separated to rotate: sign with the first, verify against any. */
  JWT_SECRET: { kind: 'string', secret: true },
  AUTH_SECRET: { kind: 'string', secret: true },
  API_KEY_HASH_SECRET: { kind: 'string', secret: true },
  VAULT_ADDR: { kind: 'string', secret: true },
  VAULT_TOKEN: { kind: 'string', secret: true },
  VAULT_KV_MOUNT: { kind: 'string', default: 'secret' },
  EAOS_TENANT_ID: { kind: 'string', default: 'default' },
  ALLOW_DEV_API_KEYS: { kind: 'bool', default: false },
  /** One-shot bootstrap token for POST /api/setup. Long enough to be unguessable. */
  EAOS_SETUP_TOKEN: { kind: 'string', secret: true, minLength: 24 },
  /** Comma-separated allowlist. Unset in production means NO CORS header, not `*`. */
  CORS_ALLOWED_ORIGINS: { kind: 'string' },
  /** Explicit switches, replacing NODE_ENV-conditional security branches. */
  ALLOW_ANON: { kind: 'bool', default: false },
  REQUIRE_SIGNED_TOKENS: { kind: 'bool', default: true },
  /** KEK for credential envelope encryption. 32 bytes, base64. */
  EAOS_ENCRYPTION_KEY: { kind: 'string', secret: true },

  // ── Persistence ───────────────────────────────────────────────────────────
  DATABASE_URL: { kind: 'string', secret: true },
  /**
   * Where the file-backed store lives. Explicit because the old default was
   * `process.cwd() + '/.agentos-data'`, which is read-only on most PaaS targets
   * and silently different depending on how the process was launched.
   */
  DATA_DIR: { kind: 'string' },
  REDIS_URL: { kind: 'string', secret: true },

  // ── LLM providers ─────────────────────────────────────────────────────────
  ANTHROPIC_API_KEY: { kind: 'string', secret: true },
  OPENAI_API_KEY: { kind: 'string', secret: true },
  GEMINI_API_KEY: { kind: 'string', secret: true },
  AZURE_OPENAI_ENDPOINT: { kind: 'string' },
  AZURE_OPENAI_KEY: { kind: 'string', secret: true },
  OLLAMA_BASE_URL: { kind: 'string' },

  // ── Behaviour flags ───────────────────────────────────────────────────────
  /** Default OFF. It used to default ON, so production got demo data unasked. */
  SEED_DEMO: { kind: 'bool', default: false },
  MEMORY_ALLOW_SYNTHETIC_EMBEDDINGS: { kind: 'bool', default: false },
  BENCHMARK_CONTRIBUTE: { kind: 'bool', default: false },

  // ── Observability ─────────────────────────────────────────────────────────
  OTEL_EXPORTER_OTLP_ENDPOINT: { kind: 'string' },
  EAOS_SKILLS_DIR: { kind: 'string' },
} as const satisfies Record<string, VarSpec>;

export type EnvKey = keyof typeof SPEC;

export interface Env {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  JWT_SECRET?: string;
  AUTH_SECRET?: string;
  API_KEY_HASH_SECRET?: string;
  VAULT_ADDR?: string;
  VAULT_TOKEN?: string;
  VAULT_KV_MOUNT: string;
  EAOS_TENANT_ID: string;
  ALLOW_DEV_API_KEYS: boolean;
  EAOS_SETUP_TOKEN?: string;
  CORS_ALLOWED_ORIGINS?: string;
  ALLOW_ANON: boolean;
  REQUIRE_SIGNED_TOKENS: boolean;
  EAOS_ENCRYPTION_KEY?: string;
  DATABASE_URL?: string;
  DATA_DIR?: string;
  REDIS_URL?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  AZURE_OPENAI_ENDPOINT?: string;
  AZURE_OPENAI_KEY?: string;
  OLLAMA_BASE_URL?: string;
  SEED_DEMO: boolean;
  MEMORY_ALLOW_SYNTHETIC_EMBEDDINGS: boolean;
  BENCHMARK_CONTRIBUTE: boolean;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  EAOS_SKILLS_DIR?: string;
}

export interface EnvProblem {
  key: string;
  message: string;
  /** `error` blocks boot. `warning` is printed and allowed. */
  severity: 'error' | 'warning';
}

export interface EnvValidationResult {
  ok: boolean;
  env: Env;
  problems: EnvProblem[];
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseOne(
  name: string,
  spec: VarSpec,
  raw: string | undefined,
  problems: EnvProblem[],
): string | number | boolean | undefined {
  const present = raw !== undefined && raw !== '';

  if (!present) return spec.default;

  switch (spec.kind) {
    case 'enum':
      if (!spec.values?.includes(raw)) {
        problems.push({
          key: name,
          severity: 'error',
          message: `must be one of ${spec.values?.join(' | ')} — got "${raw}"`,
        });
        return spec.default;
      }
      return raw;

    case 'int': {
      const n = Number(raw);
      const lo = spec.min ?? Number.MIN_SAFE_INTEGER;
      const hi = spec.max ?? Number.MAX_SAFE_INTEGER;
      if (!Number.isInteger(n) || n < lo || n > hi) {
        problems.push({
          key: name,
          severity: 'error',
          message: `must be an integer between ${lo} and ${hi} — got "${raw}"`,
        });
        return spec.default;
      }
      return n;
    }

    case 'bool':
      if (raw !== 'true' && raw !== 'false') {
        problems.push({
          key: name,
          severity: 'error',
          message: `must be "true" or "false" — got "${raw}". A typo here silently flipped a security flag, so it is rejected rather than coerced.`,
        });
        return spec.default;
      }
      return raw === 'true';

    case 'string':
      if (spec.minLength !== undefined && raw.length < spec.minLength) {
        problems.push({
          key: name,
          severity: 'error',
          message: `must be at least ${spec.minLength} characters — got ${raw.length}`,
        });
      }
      return raw;
  }
}

// ---------------------------------------------------------------------------
// Cross-field rules
// ---------------------------------------------------------------------------

/**
 * Rules spanning more than one variable.
 *
 * Deliberately NOT keyed off `NODE_ENV` alone where a flag will do. Branching
 * security on NODE_ENV is why the audit found five places where tests exercised
 * a different program than production.
 */
function crossFieldProblems(env: Env): EnvProblem[] {
  const problems: EnvProblem[] = [];
  const isProd = env.NODE_ENV === 'production';
  const signingSecret = env.JWT_SECRET ?? env.AUTH_SECRET;
  if (Boolean(env.VAULT_ADDR) !== Boolean(env.VAULT_TOKEN)) problems.push({ key: 'VAULT_ADDR', severity: 'error', message: 'Vault address and authentication must be configured together' });
  if (env.VAULT_ADDR) {
    try {
      const url = new URL(env.VAULT_ADDR);
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid Vault origin');
    } catch { problems.push({ key: 'VAULT_ADDR', severity: 'error', message: 'Vault requires a credential-free HTTPS origin' }); }
  }
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(env.VAULT_KV_MOUNT)) problems.push({ key: 'VAULT_KV_MOUNT', severity: 'error', message: 'Invalid Vault KV mount' });

  if (isProd && !signingSecret) {
    problems.push({
      key: 'JWT_SECRET',
      severity: 'error',
      message:
        'Required when NODE_ENV=production. Without it no token can be verified and every request 401s, ' +
        'including health probes. Generate one with: openssl rand -base64 48',
    });
  }

  if (signingSecret?.includes('change-me')) {
    problems.push({
      key: 'JWT_SECRET',
      severity: 'error',
      message:
        'Refusing to start with a placeholder signing secret. This exact default shipped in ' +
        'deploy/docker-compose.production.yml, so anyone who has read the repo can mint admin tokens.',
    });
  }

  if (isProd && !env.CORS_ALLOWED_ORIGINS) {
    problems.push({
      key: 'CORS_ALLOWED_ORIGINS',
      severity: 'warning',
      message:
        'Unset in production: no Access-Control-Allow-Origin header will be sent (fail closed, not "*"). ' +
        'Set it to your web origin, e.g. https://app.example.com',
    });
  }

  if (isProd && (!env.REQUIRE_SIGNED_TOKENS || env.ALLOW_DEV_API_KEYS)) {
    problems.push({ key: 'REQUIRE_SIGNED_TOKENS', severity: 'error', message: 'Production requires signed tokens and forbids development API keys.' });
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(env.EAOS_TENANT_ID)) {
    problems.push({ key: 'EAOS_TENANT_ID', severity: 'error', message: 'Invalid deployment tenant identifier.' });
  }

  if (env.ALLOW_ANON) {
    problems.push({
      key: 'ALLOW_ANON',
      severity: isProd ? 'error' : 'warning',
      message: isProd
        ? 'Anonymous access cannot be enabled in production.'
        : 'Anonymous access is ON — every unauthenticated request is treated as a real user.',
    });
  }

  const hasLlmKey = Boolean(
    env.ANTHROPIC_API_KEY ||
      env.OPENAI_API_KEY ||
      env.GEMINI_API_KEY ||
      (env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_KEY) ||
      env.OLLAMA_BASE_URL,
  );
  if (!hasLlmKey) {
    problems.push({
      key: 'ANTHROPIC_API_KEY',
      severity: 'warning',
      message:
        'No LLM provider configured. The gateway boots and serves, but any real run fails with ' +
        'LLMNotConfiguredError. Explicitly simulated runs still work.',
    });
  }

  if (!env.DATABASE_URL) {
    problems.push({
      key: 'DATABASE_URL',
      severity: 'warning',
      message:
        'Unset — using the file-backed store. Single replica only: the durable queue, the audit chain ' +
        'and per-tenant spend caps are only correct on Postgres.',
    });
  }

  if (env.MEMORY_ALLOW_SYNTHETIC_EMBEDDINGS && isProd) {
    problems.push({
      key: 'MEMORY_ALLOW_SYNTHETIC_EMBEDDINGS',
      severity: 'error',
      message:
        'Synthetic embeddings are a local-development affordance. In production they would return ' +
        'confident similarity scores over vectors with no semantic meaning.',
    });
  }

  if (env.SEED_DEMO && isProd) {
    problems.push({
      key: 'SEED_DEMO',
      severity: 'warning',
      message: 'Demo data will be seeded into a production tenant.',
    });
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Validate an env bag. Never throws, never exits — the caller decides. */
export function validateEnv(source: NodeJS.ProcessEnv = process.env): EnvValidationResult {
  const problems: EnvProblem[] = [];
  const out: Record<string, string | number | boolean | undefined> = {};

  for (const [name, spec] of Object.entries(SPEC) as Array<[string, VarSpec]>) {
    out[name] = parseOne(name, spec, source[name], problems);
  }

  const env = out as unknown as Env;
  problems.push(...crossFieldProblems(env));

  return {
    ok: !problems.some(p => p.severity === 'error'),
    env,
    problems,
  };
}

/**
 * A set/missing table plus every problem, as plain lines.
 *
 * Secret values are reported as `set` or `—` and never echoed, so this is safe
 * to leave enabled in a shared log pipeline.
 */
export function formatEnvReport(
  result: EnvValidationResult,
  source: NodeJS.ProcessEnv = process.env,
): string {
  const names = Object.keys(SPEC);
  const width = Math.max(...names.map(n => n.length));
  const lines: string[] = ['[config] environment'];

  for (const name of names) {
    const spec = SPEC[name as EnvKey] as VarSpec;
    const raw = source[name];
    const present = raw !== undefined && raw !== '';
    const shown = !present
      ? spec.default !== undefined
        ? `— (default ${String(spec.default)})`
        : '—'
      : spec.secret
        ? 'set'
        : raw;
    lines.push(`  ${name.padEnd(width)}  ${shown}`);
  }

  for (const w of result.problems.filter(p => p.severity === 'warning')) {
    lines.push(`[config] WARN  ${w.key}: ${w.message}`);
  }
  for (const e of result.problems.filter(p => p.severity === 'error')) {
    lines.push(`[config] ERROR ${e.key}: ${e.message}`);
  }

  return lines.join('\n');
}

/** `sysexits.h` EX_CONFIG — "configuration error". */
export const EX_CONFIG = 78;

/**
 * Validate, report, and exit 78 on error.
 *
 * Call as the first statement of `boot()` — never at module scope, which is the
 * failure mode this exists to replace.
 */
export function loadEnvOrExit(source: NodeJS.ProcessEnv = process.env): Env {
  const result = validateEnv(source);
  console.log(formatEnvReport(result, source));
  if (!result.ok) {
    const n = result.problems.filter(p => p.severity === 'error').length;
    console.error(`[config] Refusing to start: ${n} configuration error(s) above.`);
    process.exit(EX_CONFIG);
  }
  return result.env;
}
