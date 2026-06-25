/**
 * PostgreSQL Store — Real database persistence for AgentOS
 *
 * Implements the Store interface using PostgreSQL with connection pooling.
 * Uses a generic JSONB row pattern so any table/key-value works through
 * the same interface that InMemoryStore and PersistentStore expose.
 *
 * Also provides typed table access for the unified execution model
 * (executions, execution_steps, agent_kpis, etc.) via dedicated methods.
 *
 * Requires: DATABASE_URL env var (e.g. postgresql://eaos:pass@localhost:5432/eaos)
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import type { Store } from './connection.js';
import type {
  UnifiedExecution,
  UnifiedStep,
  AgentKPI,
  ExecutionStatus,
  PersonaId,
} from './unified-types.js';

// ---------------------------------------------------------------------------
// Lightweight pg wrapper — dynamic import so the rest of the app works
// without pg installed (falls back to InMemoryStore).
// ---------------------------------------------------------------------------

let _pool: unknown = null;

interface PgPool {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

async function getPool(): Promise<PgPool> {
  if (_pool) return _pool as PgPool;
  // Dynamic import so the module only fails when actually used
  const { default: pg } = await import('pg');
  const Pool = pg.Pool ?? (pg as unknown as { Pool: new (config: Record<string, unknown>) => PgPool }).Pool;
  _pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return _pool as PgPool;
}

// ---------------------------------------------------------------------------
// Bootstrap — create the kv_store table if it doesn't exist
// ---------------------------------------------------------------------------

const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS kv_store (
  _table TEXT NOT NULL,
  id TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (_table, id)
);
CREATE INDEX IF NOT EXISTS idx_kv_store_table ON kv_store(_table);
`;

// ---------------------------------------------------------------------------
// PostgresStore
// ---------------------------------------------------------------------------

export class PostgresStore implements Store {
  private ready: Promise<void>;

  constructor() {
    this.ready = this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    const pool = await getPool();
    await pool.query(BOOTSTRAP_SQL);
    // Also try to run the typed tables migration (non-fatal if already exists)
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS executions (
          id TEXT PRIMARY KEY,
          persona TEXT NOT NULL,
          executable_type TEXT NOT NULL DEFAULT 'skill',
          skill_id TEXT NOT NULL,
          skill_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued',
          provider TEXT,
          model TEXT,
          inputs JSONB DEFAULT '{}',
          outputs JSONB DEFAULT '{}',
          user_id TEXT,
          edges JSONB DEFAULT '[]',
          execution_mode TEXT NOT NULL DEFAULT 'sequential',
          total_token_cost REAL,
          total_latency_ms INTEGER,
          avg_quality_score REAL,
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS execution_steps (
          id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
          execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
          step_id TEXT NOT NULL,
          step_name TEXT NOT NULL,
          step_index INTEGER NOT NULL DEFAULT 0,
          agent TEXT NOT NULL,
          agent_call_sign TEXT,
          agent_rank TEXT,
          tool TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          output_key TEXT,
          output_preview TEXT,
          output_full TEXT,
          error TEXT,
          latency_ms INTEGER,
          token_cost REAL,
          quality_score REAL,
          handoff_valid BOOLEAN DEFAULT TRUE,
          handoff_warnings TEXT[] DEFAULT '{}',
          depends_on TEXT[] DEFAULT '{}',
          started_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ
        );
        CREATE TABLE IF NOT EXISTS agent_kpis (
          agent_id TEXT PRIMARY KEY,
          call_sign TEXT NOT NULL,
          total_executions INTEGER NOT NULL DEFAULT 0,
          avg_latency_ms REAL NOT NULL DEFAULT 0,
          avg_quality_score REAL NOT NULL DEFAULT 5,
          avg_token_cost REAL NOT NULL DEFAULT 0,
          handoff_success_rate REAL NOT NULL DEFAULT 100,
          last_executed_at TIMESTAMPTZ,
          sla_quality_threshold REAL DEFAULT 7.0,
          sla_latency_threshold_ms INTEGER DEFAULT 30000,
          underperformance_streak INTEGER DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
    } catch {
      // Tables may already exist from migration — safe to ignore
    }
  }

  // =====================================================================
  // Store interface (KV pattern — for backward compatibility)
  // =====================================================================

  /** Not meaningful for Postgres — returns an empty Map */
  getTable(_name: string): Map<string, Record<string, unknown>> {
    return new Map();
  }

  insert(table: string, id: string, data: Record<string, unknown>): void {
    void this.insertAsync(table, id, data);
  }

  /**
   * Marker the gateway-persistence layer checks to detect that this store
   * cannot answer reads synchronously and must be routed through the async
   * methods (getAsync / queryAsync / allAsync). Always true for PostgresStore;
   * absent on SqliteStore / InMemoryStore / PersistentStore.
   */
  readonly isAsync = true as const;

  get(_table: string, _id: string): Record<string, unknown> | undefined {
    // Sync reads cannot run pg queries. Returning undefined silently would
    // make callers (e.g. gateway-persistence restore) no-op. Fail loudly so
    // they switch to getAsync().
    throw new Error(
      'PostgresStore.get() is not supported — use getAsync() for async Postgres reads',
    );
  }

  update(table: string, id: string, data: Partial<Record<string, unknown>>): void {
    void this.updateAsync(table, id, data);
  }

  delete(table: string, id: string): void {
    void this.deleteAsync(table, id);
  }

  query(_table: string, _filter: (row: Record<string, unknown>) => boolean): Record<string, unknown>[] {
    // Sync reads cannot run pg queries. Fail loudly rather than returning []
    // (which silently no-ops callers). Use queryAsync() instead.
    throw new Error(
      'PostgresStore.query() is not supported — use queryAsync() for async Postgres reads',
    );
  }

  all(_table: string): Record<string, unknown>[] {
    // Sync reads cannot run pg queries. Returning [] here silently no-ops the
    // gateway-persistence restore + delete-before-insert path. Fail loudly so
    // callers route through allAsync() instead.
    throw new Error(
      'PostgresStore.all() is not supported — use allAsync() for async Postgres reads',
    );
  }

  // -----------------------------------------------------------------------
  // KV Async versions — the real implementations
  // -----------------------------------------------------------------------

  async insertAsync(table: string, id: string, data: Record<string, unknown>): Promise<void> {
    await this.ready;
    const pool = await getPool();
    await pool.query(
      `INSERT INTO kv_store (_table, id, data) VALUES ($1, $2, $3)
       ON CONFLICT (_table, id) DO UPDATE SET data = $3, updated_at = NOW()`,
      [table, id, JSON.stringify(data)],
    );
  }

  async getAsync(table: string, id: string): Promise<Record<string, unknown> | undefined> {
    await this.ready;
    const pool = await getPool();
    const { rows } = await pool.query(
      `SELECT data FROM kv_store WHERE _table = $1 AND id = $2`,
      [table, id],
    );
    return rows[0]?.data as Record<string, unknown> | undefined;
  }

  async updateAsync(table: string, id: string, data: Partial<Record<string, unknown>>): Promise<void> {
    await this.ready;
    const pool = await getPool();
    await pool.query(
      `UPDATE kv_store SET data = data || $3::jsonb, updated_at = NOW() WHERE _table = $1 AND id = $2`,
      [table, id, JSON.stringify(data)],
    );
  }

  async deleteAsync(table: string, id: string): Promise<void> {
    await this.ready;
    const pool = await getPool();
    await pool.query(
      `DELETE FROM kv_store WHERE _table = $1 AND id = $2`,
      [table, id],
    );
  }

  async queryAsync(table: string, filter: (row: Record<string, unknown>) => boolean): Promise<Record<string, unknown>[]> {
    await this.ready;
    const pool = await getPool();
    const { rows } = await pool.query(
      `SELECT data FROM kv_store WHERE _table = $1`,
      [table],
    );
    return (rows.map(r => r.data) as Record<string, unknown>[]).filter(filter);
  }

  async allAsync(table: string): Promise<Record<string, unknown>[]> {
    await this.ready;
    const pool = await getPool();
    const { rows } = await pool.query(
      `SELECT data FROM kv_store WHERE _table = $1 ORDER BY updated_at DESC`,
      [table],
    );
    return rows.map(r => r.data) as Record<string, unknown>[];
  }

  // =====================================================================
  // Typed Execution API — uses dedicated tables (not kv_store)
  // =====================================================================

  async saveExecution(exec: UnifiedExecution): Promise<void> {
    await this.ready;
    const pool = await getPool();
    await pool.query(
      `INSERT INTO executions (
        id, persona, executable_type, skill_id, skill_name, status,
        provider, model, inputs, outputs, user_id, edges, execution_mode,
        total_token_cost, total_latency_ms, avg_quality_score,
        started_at, completed_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (id) DO UPDATE SET
        status = $6, provider = $7, model = $8, outputs = $10,
        total_token_cost = $14, total_latency_ms = $15, avg_quality_score = $16,
        completed_at = $18`,
      [
        exec.id, exec.persona, exec.executableType, exec.skillId, exec.skillName,
        exec.status, exec.provider ?? null, exec.model ?? null,
        JSON.stringify(exec.inputs), JSON.stringify(exec.outputs),
        exec.userId ?? null, JSON.stringify(exec.edges), exec.executionMode,
        exec.totalTokenCost ?? null, exec.totalLatencyMs ?? null,
        exec.avgQualityScore ?? null, exec.startedAt, exec.completedAt ?? null,
      ],
    );

    // Upsert steps
    for (let i = 0; i < exec.steps.length; i++) {
      const s = exec.steps[i];
      await pool.query(
        `INSERT INTO execution_steps (
          id, execution_id, step_id, step_name, step_index, agent,
          agent_call_sign, agent_rank, tool, status, output_key,
          output_preview, error, latency_ms, token_cost, quality_score,
          handoff_valid, handoff_warnings, depends_on, started_at, completed_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        ON CONFLICT (id) DO UPDATE SET
          status = $10, output_preview = $12, error = $13,
          latency_ms = $14, token_cost = $15, quality_score = $16,
          handoff_valid = $17, handoff_warnings = $18,
          started_at = $20, completed_at = $21`,
        [
          `${exec.id}-${s.stepId}`, exec.id, s.stepId, s.stepName, i,
          s.agent, s.agentCallSign ?? null, s.agentRank ?? null,
          s.tool ?? null, s.status, s.outputKey ?? null,
          s.outputPreview ?? null, s.error ?? null,
          s.latencyMs ?? null, s.tokenCost ?? null, s.qualityScore ?? null,
          s.handoffValid ?? true, s.handoffWarnings ?? [],
          s.dependsOn ?? [], s.startedAt ?? null, s.completedAt ?? null,
        ],
      );
    }
  }

  async getExecution(id: string): Promise<UnifiedExecution | undefined> {
    await this.ready;
    const pool = await getPool();
    const { rows } = await pool.query(
      `SELECT * FROM executions WHERE id = $1`, [id],
    );
    if (!rows[0]) return undefined;

    const { rows: stepRows } = await pool.query(
      `SELECT * FROM execution_steps WHERE execution_id = $1 ORDER BY step_index`, [id],
    );

    return this.rowToExecution(rows[0], stepRows);
  }

  async listExecutions(opts: {
    persona?: PersonaId;
    status?: ExecutionStatus;
    userId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<UnifiedExecution[]> {
    await this.ready;
    const pool = await getPool();
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (opts.persona) { conditions.push(`persona = $${idx++}`); values.push(opts.persona); }
    if (opts.status) { conditions.push(`status = $${idx++}`); values.push(opts.status); }
    if (opts.userId) { conditions.push(`user_id = $${idx++}`); values.push(opts.userId); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = opts.limit ?? 20;
    const offset = opts.offset ?? 0;

    const { rows } = await pool.query(
      `SELECT * FROM executions ${where} ORDER BY started_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      [...values, limit, offset],
    );

    const executions: UnifiedExecution[] = [];
    for (const row of rows) {
      const { rows: stepRows } = await pool.query(
        `SELECT * FROM execution_steps WHERE execution_id = $1 ORDER BY step_index`,
        [row.id],
      );
      executions.push(this.rowToExecution(row, stepRows));
    }
    return executions;
  }

  async saveKPI(kpi: AgentKPI): Promise<void> {
    await this.ready;
    const pool = await getPool();
    await pool.query(
      `INSERT INTO agent_kpis (
        agent_id, call_sign, total_executions, avg_latency_ms,
        avg_quality_score, avg_token_cost, handoff_success_rate,
        last_executed_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      ON CONFLICT (agent_id) DO UPDATE SET
        call_sign = $2, total_executions = $3, avg_latency_ms = $4,
        avg_quality_score = $5, avg_token_cost = $6, handoff_success_rate = $7,
        last_executed_at = $8, updated_at = NOW()`,
      [
        kpi.agentId, kpi.callSign, kpi.totalExecutions,
        kpi.avgLatencyMs, kpi.avgQualityScore, kpi.avgTokenCost,
        kpi.handoffSuccessRate, kpi.lastExecutedAt,
      ],
    );
  }

  async getKPI(agentId: string): Promise<AgentKPI | undefined> {
    await this.ready;
    const pool = await getPool();
    const { rows } = await pool.query(
      `SELECT * FROM agent_kpis WHERE agent_id = $1`, [agentId],
    );
    if (!rows[0]) return undefined;
    return this.rowToKPI(rows[0]);
  }

  async getAllKPIs(): Promise<AgentKPI[]> {
    await this.ready;
    const pool = await getPool();
    const { rows } = await pool.query(
      `SELECT * FROM agent_kpis ORDER BY total_executions DESC`,
    );
    return rows.map(r => this.rowToKPI(r));
  }

  // -----------------------------------------------------------------------
  // Row mappers
  // -----------------------------------------------------------------------

  private rowToExecution(row: Record<string, unknown>, stepRows: Record<string, unknown>[]): UnifiedExecution {
    return {
      id: row.id as string,
      persona: row.persona as PersonaId,
      executableType: (row.executable_type as UnifiedExecution['executableType']) ?? 'skill',
      skillId: row.skill_id as string,
      skillName: row.skill_name as string,
      status: row.status as ExecutionStatus,
      executionMode: (row.execution_mode as UnifiedExecution['executionMode']) ?? 'sequential',
      provider: row.provider as string | undefined,
      model: row.model as string | undefined,
      inputs: (row.inputs ?? {}) as Record<string, unknown>,
      outputs: (row.outputs ?? {}) as Record<string, string>,
      userId: row.user_id as string | undefined,
      edges: (row.edges ?? []) as UnifiedExecution['edges'],
      totalTokenCost: row.total_token_cost as number | undefined,
      totalLatencyMs: row.total_latency_ms as number | undefined,
      avgQualityScore: row.avg_quality_score as number | undefined,
      startedAt: (row.started_at as Date)?.toISOString() ?? new Date().toISOString(),
      completedAt: row.completed_at ? (row.completed_at as Date).toISOString() : undefined,
      steps: stepRows.map(s => this.rowToStep(s)),
    };
  }

  private rowToStep(row: Record<string, unknown>): UnifiedStep {
    return {
      stepId: row.step_id as string,
      stepName: row.step_name as string,
      stepIndex: row.step_index as number,
      agent: row.agent as string,
      agentCallSign: row.agent_call_sign as string | undefined,
      agentRank: row.agent_rank as string | undefined,
      tool: row.tool as string | undefined,
      status: row.status as UnifiedStep['status'],
      outputKey: row.output_key as string | undefined,
      outputPreview: row.output_preview as string | undefined,
      error: row.error as string | undefined,
      latencyMs: row.latency_ms as number | undefined,
      tokenCost: row.token_cost as number | undefined,
      qualityScore: row.quality_score as number | undefined,
      handoffValid: row.handoff_valid as boolean | undefined,
      handoffWarnings: (row.handoff_warnings ?? []) as string[],
      dependsOn: (row.depends_on ?? []) as string[],
      startedAt: row.started_at ? (row.started_at as Date).toISOString() : undefined,
      completedAt: row.completed_at ? (row.completed_at as Date).toISOString() : undefined,
    };
  }

  private rowToKPI(row: Record<string, unknown>): AgentKPI {
    return {
      agentId: row.agent_id as string,
      callSign: row.call_sign as string,
      totalExecutions: row.total_executions as number,
      avgLatencyMs: row.avg_latency_ms as number,
      avgQualityScore: row.avg_quality_score as number,
      avgTokenCost: row.avg_token_cost as number,
      handoffSuccessRate: row.handoff_success_rate as number,
      lastExecutedAt: row.last_executed_at ? (row.last_executed_at as Date).toISOString() : '',
      slaQualityThreshold: row.sla_quality_threshold as number | undefined,
      slaLatencyThresholdMs: row.sla_latency_threshold_ms as number | undefined,
      underperformanceStreak: row.underperformance_streak as number | undefined,
    };
  }

  async close(): Promise<void> {
    if (_pool) await (_pool as PgPool).end();
  }
}

/** Expose the raw pg.Pool for direct queries (e.g. API key management, tenant GUC). */
export async function getRawPool(): Promise<PgPool> {
  return getPool();
}
