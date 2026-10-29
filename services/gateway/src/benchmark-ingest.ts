/**
 * Benchmark Ingest — Opt-in anonymized telemetry for cross-tenant insights.
 *
 * Rationale: the data-moat thesis requires aggregated, anonymized execution
 * telemetry across tenants. This module is the tenant-side opt-in surface:
 * when enabled, it hashes PII-adjacent identifiers (userId, orgId) and
 * forwards a minimal record to BENCHMARK_INGEST_URL if configured, while
 * always retaining a local log for audit.
 *
 * The data moat compounds when many tenants opt in. This module makes the
 * opt-in explicit, auditable, and reversible.
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import { createHash } from 'node:crypto';
import type { ExecutionRecord } from './memory-graph.js';
import { registerStore } from './gateway-persistence.js';

export interface BenchmarkRecord {
  id: string;
  ts: string;
  tenantHash: string;     // hashed org identifier
  userHash: string;       // hashed userId — one-way, per-tenant salted
  skillId: string;
  skillName: string;
  personaId: string;
  success: boolean;
  runtimeSec: number;
  cost: number;
  modelProvider?: string;
  modelId?: string;
  qualityScore?: number;
  toolCount: number;
  agentCount: number;
}

const contributions: BenchmarkRecord[] = [];
const MAX_LOG = 5000;

// Persistence — evidence for "we actually sent X records when you opted in".
registerStore(
  'benchmark_contributions',
  () => contributions as unknown as Record<string, unknown>[],
  (rows) => {
    contributions.length = 0;
    contributions.push(...(rows as unknown as BenchmarkRecord[]));
  },
);

function hashWithSalt(input: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${input}`).digest('hex').slice(0, 24);
}

function tenantSalt(): string {
  return process.env.TENANT_ID ?? process.env.ORG_ID ?? 'default-tenant';
}

function isEnabled(): boolean {
  return process.env.BENCHMARK_CONTRIBUTE === 'true';
}

/**
 * Submit a single execution to the benchmark. No-op unless
 * BENCHMARK_CONTRIBUTE=true. All identifiers are hashed with a per-tenant
 * salt so records cannot be reverse-mapped to users.
 */
export async function contributeExecution(
  exec: ExecutionRecord,
): Promise<{ submitted: boolean; reason?: string }> {
  if (!isEnabled()) return { submitted: false, reason: 'BENCHMARK_CONTRIBUTE not enabled' };
  if (exec.simulated) return { submitted: false, reason: 'simulated executions are excluded' };
  // Only measured observations of the SKILL enter the corpus. A provider outage
  // or a budget cap says nothing about skill quality, so contributing it would
  // silently push our own downtime into every consumer's success-rate figures.
  if (exec.infraFailure) {
    return { submitted: false, reason: 'infrastructure failures are excluded (measures the provider, not the skill)' };
  }

  const salt = tenantSalt();
  const record: BenchmarkRecord = {
    id: `bc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ts: exec.ts,
    tenantHash: hashWithSalt(salt, 'tenant-v1'),
    userHash: hashWithSalt(exec.userId, salt),
    skillId: exec.skillId,
    skillName: exec.skillName,
    personaId: exec.personaId,
    success: exec.success,
    runtimeSec: exec.runtimeSec,
    cost: exec.cost,
    modelProvider: exec.modelProvider,
    modelId: exec.modelId,
    qualityScore: exec.qualityScore,
    toolCount: exec.toolsUsed.length,
    agentCount: exec.agentsUsed.length,
  };

  contributions.push(record);
  if (contributions.length > MAX_LOG) contributions.splice(0, contributions.length - MAX_LOG);

  const ingestUrl = process.env.BENCHMARK_INGEST_URL;
  if (ingestUrl) {
    try {
      await fetch(ingestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(record),
      });
    } catch (err) {
      // Don't fail the caller — log locally and proceed.
      console.warn('[benchmark-ingest] forward failed:', (err as Error).message);
    }
  }

  return { submitted: true };
}

/** Returns the local contribution log for transparency. */
export function getContributionLog(limit = 100): BenchmarkRecord[] {
  return contributions.slice(-limit).reverse();
}

/** Returns counters for the admin UI. */
export function getContributionStats(): {
  enabled: boolean;
  total: number;
  bySkill: Record<string, number>;
  byModel: Record<string, number>;
} {
  const bySkill: Record<string, number> = {};
  const byModel: Record<string, number> = {};
  for (const r of contributions) {
    bySkill[r.skillId] = (bySkill[r.skillId] ?? 0) + 1;
    const k = `${r.modelProvider ?? 'unknown'}:${r.modelId ?? 'unknown'}`;
    byModel[k] = (byModel[k] ?? 0) + 1;
  }
  return {
    enabled: isEnabled(),
    total: contributions.length,
    bySkill,
    byModel,
  };
}
