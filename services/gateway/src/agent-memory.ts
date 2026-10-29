/**
 * Agent Memory Isolation — Per-agent persistent context
 *
 * Each agent accumulates learnings, patterns, and corrections across executions.
 * Memory is keyed by agent ID and persisted via the backing Store.
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import type { Store } from './db.js';
import { readAll } from './db.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentMemoryEntry {
  id: string;
  /**
   * Owning tenant. Memory is spliced verbatim into an agent's system prompt, so
   * an entry crossing a tenant boundary is silent, persistent, unauditable data
   * exfiltration that surfaces inside generated output.
   */
  tenantId: string;
  agentId: string;
  timestamp: string;
  kind: 'learning' | 'correction' | 'pattern' | 'preference';
  content: string;
  source: string;         // execution ID or manual
  relevance: number;      // 0-1, decays over time
}

export interface AgentMemorySnapshot {
  agentId: string;
  totalEntries: number;
  entries: AgentMemoryEntry[];
}

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

const TABLE = 'agent_memory';
const MAX_ENTRIES_PER_AGENT = 50;   // Keep memory bounded
/**
 * Keyed by `<tenantId>\u0000<agentId>`, never by agentId alone.
 *
 * It was keyed by bare agentId, so every tenant running the same catalog agent
 * shared one memory pool: tenant A's learnings were injected into tenant B's
 * system prompt by `buildAgentMemoryContext`. A NUL separator is used because it
 * cannot appear in either identifier, so no pair of ids can collide into the same
 * key.
 */
const memories = new Map<string, AgentMemoryEntry[]>();
let backingStore: Store | null = null;

/** Compose the tenant-scoped storage key. */
function memKey(tenantId: string, agentId: string): string {
  if (!tenantId) throw new Error('agent-memory: tenantId is required — refusing to use an unscoped key');
  return `${tenantId}\u0000${agentId}`;
}

/**
 * Remove entries from the backing store when they leave the in-memory Map
 * (eviction over the cap, or decay below threshold). Without this, Postgres
 * rows accumulate and a restart re-inflates the Map past MAX_ENTRIES_PER_AGENT.
 * The backing store's delete routes through its async path on Postgres.
 */
function deleteFromBackingStore(entries: AgentMemoryEntry[]): void {
  if (!backingStore || entries.length === 0) return;
  for (const entry of entries) {
    try {
      backingStore.delete(TABLE, entry.id);
    } catch { /* non-fatal */ }
  }
}

/** Cap a list of restored entries per agent: keep the most relevant. */
function capEntries(entries: AgentMemoryEntry[]): AgentMemoryEntry[] {
  if (entries.length <= MAX_ENTRIES_PER_AGENT) return entries;
  return entries
    .sort((a, b) => b.relevance - a.relevance || b.timestamp.localeCompare(a.timestamp))
    .slice(0, MAX_ENTRIES_PER_AGENT);
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

export async function initAgentMemory(store: Store): Promise<void> {
  backingStore = store;

  // Restore from persistence
  try {
    const rows = await readAll(store, TABLE);
    for (const row of rows) {
      const entry = row as unknown as AgentMemoryEntry;
      if (!entry.agentId) continue;
      const existing = memories.get(entry.agentId) ?? [];
      existing.push(entry);
      memories.set(entry.agentId, existing);
    }
    // Cap restored entries per agent (most relevant kept) so a bloated backing
    // store can't re-inflate the Map past MAX_ENTRIES_PER_AGENT.
    for (const [agentId, entries] of memories) {
      memories.set(agentId, capEntries(entries));
    }
    if (rows.length > 0) {
      console.log(`[agent-memory] Restored ${rows.length} memory entries for ${memories.size} agents`);
    }
  } catch {
    // Table may not exist yet — that's fine
  }
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Record a new learning/pattern/correction for an agent.
 */
export function recordAgentMemory(
  tenantId: string,
  agentId: string,
  kind: AgentMemoryEntry['kind'],
  content: string,
  source: string,
): AgentMemoryEntry {
  const key = memKey(tenantId, agentId);
  const entry: AgentMemoryEntry = {
    id: `amem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    tenantId,
    agentId,
    timestamp: new Date().toISOString(),
    kind,
    content,
    source,
    relevance: 1.0,
  };

  const entries = memories.get(key) ?? [];
  entries.push(entry);

  // Evict oldest low-relevance entries if over limit
  if (entries.length > MAX_ENTRIES_PER_AGENT) {
    entries.sort((a, b) => b.relevance - a.relevance || b.timestamp.localeCompare(a.timestamp));
    const evicted = entries.splice(MAX_ENTRIES_PER_AGENT);
    // Drop evicted entries from the backing store too — otherwise Postgres rows
    // accumulate past the cap and a restore re-inflates the in-memory Map.
    deleteFromBackingStore(evicted);
  }

  memories.set(key, entries);

  // Persist immediately
  if (backingStore) {
    try {
      backingStore.insert(TABLE, entry.id, entry as unknown as Record<string, unknown>);
    } catch { /* non-fatal */ }
  }

  return entry;
}

/**
 * Get all memory entries for an agent, sorted by relevance.
 */
export function getAgentMemory(tenantId: string, agentId: string): AgentMemoryEntry[] {
  const entries = memories.get(memKey(tenantId, agentId)) ?? [];
  return [...entries].sort((a, b) => b.relevance - a.relevance);
}

/**
 * Build a context block suitable for injecting into an agent's system prompt.
 * Returns empty string if the agent has no memories.
 */
export function buildAgentMemoryContext(tenantId: string, agentId: string): string {
  const entries = getAgentMemory(tenantId, agentId);
  if (entries.length === 0) return '';

  // Take top 10 most relevant entries
  const top = entries.slice(0, 10);

  const lines = top.map((e) => {
    const kindLabel = e.kind.charAt(0).toUpperCase() + e.kind.slice(1);
    return `- [${kindLabel}] ${e.content}`;
  });

  return `\n\n## Your Accumulated Knowledge (from previous executions)\n${lines.join('\n')}\n\nApply these learnings to improve your output quality.`;
}

/**
 * After an execution completes, extract learnings and store them.
 * Called from persona-api after each step execution.
 */
export function extractAndStoreMemory(
  tenantId: string,
  agentId: string,
  executionId: string,
  stepName: string,
  output: string,
): void {
  // Auto-extract patterns: if output mentions corrections, improvements, or key decisions
  const patterns = [
    { regex: /(?:correction|fix|mistake|error|wrong)[:—]\s*(.{20,120})/gi, kind: 'correction' as const },
    { regex: /(?:lesson|insight|takeaway|key finding)[:—]\s*(.{20,120})/gi, kind: 'learning' as const },
    { regex: /(?:pattern|best practice|recommendation)[:—]\s*(.{20,120})/gi, kind: 'pattern' as const },
  ];

  for (const { regex, kind } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(output)) !== null) {
      recordAgentMemory(tenantId, agentId, kind, match[1].trim(), executionId);
    }
  }

  // Always store a brief execution summary as a learning
  const summary = `Executed step "${stepName}" — ${output.length} chars output`;
  recordAgentMemory(tenantId, agentId, 'learning', summary, executionId);
}

// ---------------------------------------------------------------------------
// Structured memory document (3-tier: history + facts with confidence)
// Shape adopted from bytedance/deer-flow — see
// packages/memory-pipeline/src/agent-memory-schema.ts (third_party/NOTICE).
// This presents the live per-agent memory through that canonical schema.
// ---------------------------------------------------------------------------

export interface MemoryFact { content: string; category?: string; confidence?: number; createdAt?: string; }
export interface AgentMemoryDocument {
  agentId: string;
  version: string;
  lastUpdated: string;
  history: { recent: string };
  facts: MemoryFact[];
}

/** Shape an agent's live memory into the adopted AgentMemory document. */
export function getAgentMemoryDocument(tenantId: string, agentId: string): AgentMemoryDocument {
  const entries = getAgentMemory(tenantId, agentId);
  const facts: MemoryFact[] = entries
    .filter((e) => e.kind !== 'preference')
    .map((e) => ({
      content: e.content,
      category: e.kind,
      confidence: Math.round(e.relevance * 100) / 100,
      createdAt: e.timestamp,
    }))
    .slice(0, 50);
  const execs = new Set(entries.map((e) => e.source)).size;
  return {
    agentId,
    version: '1.0',
    lastUpdated: entries[0]?.timestamp ?? new Date().toISOString(),
    history: { recent: `${entries.length} memories across ${execs} executions` },
    facts,
  };
}

/**
 * Decay relevance of old memories. Call periodically.
 */
export function decayMemories(decayFactor: number = 0.95): void {
  for (const [agentId, entries] of memories) {
    for (const entry of entries) {
      entry.relevance *= decayFactor;
    }
    // Remove entries below threshold — and delete them from the backing store
    // too, so decayed rows don't linger in Postgres and get re-restored.
    const filtered = entries.filter(e => e.relevance > 0.1);
    if (filtered.length !== entries.length) {
      const dropped = entries.filter(e => e.relevance <= 0.1);
      deleteFromBackingStore(dropped);
    }
    memories.set(agentId, filtered);
  }
}

/**
 * Get summary for all agents that have memory.
 */
export function getAllAgentMemorySnapshots(tenantId: string): AgentMemorySnapshot[] {
  // Iterating the whole Map would now return every tenant's memory AND emit the
  // composite key as an agentId. Filter on the entries' own tenantId rather than
  // parsing the key, so the check is on the data itself.
  const snapshots: AgentMemorySnapshot[] = [];
  for (const entries of memories.values()) {
    const mine = entries.filter(e => e.tenantId === tenantId);
    if (mine.length === 0) continue;
    snapshots.push({
      agentId: mine[0]!.agentId,
      totalEntries: mine.length,
      entries: [...mine].sort((a, b) => b.relevance - a.relevance),
    });
  }
  return snapshots;
}

// Export/import for gateway-persistence integration
export function _exportData(): Record<string, unknown>[] {
  const all: Record<string, unknown>[] = [];
  for (const entries of memories.values()) {
    for (const e of entries) {
      all.push({ ...e } as unknown as Record<string, unknown>);
    }
  }
  return all;
}

export function _importData(rows: Record<string, unknown>[]): void {
  memories.clear();
  for (const row of rows) {
    const entry = row as unknown as AgentMemoryEntry;
    if (!entry.agentId) continue;
    const existing = memories.get(entry.agentId) ?? [];
    existing.push(entry);
    memories.set(entry.agentId, existing);
  }
  // Cap restored entries per agent (most relevant kept) so a bloated backing
  // store can't re-inflate the Map past MAX_ENTRIES_PER_AGENT.
  for (const [agentId, entries] of memories) {
    memories.set(agentId, capEntries(entries));
  }
}
