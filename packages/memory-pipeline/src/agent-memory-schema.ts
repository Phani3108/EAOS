/**
 * EAOS Agent Memory schema — persistent per-agent memory.
 *
 * Three tiers: `user` context, `history`, and `facts` (with confidence). Backs EAOS's
 * episodic/semantic memory (replacing the interface-only VectorStore).
 *
 * Provenance: schema adopted from bytedance/deer-flow (MIT). See third_party/NOTICE.
 */

export interface MemorySummary {
  summary: string;
  updatedAt: string;
}

/** A discrete remembered fact (deer-flow fields: content, category, confidence). */
export interface MemoryFact {
  content: string;
  category?: string;
  confidence?: number; // 0..1
  createdAt?: string;
}

export interface AgentMemory {
  version: string;
  lastUpdated: string;
  user: {
    workContext: MemorySummary;
    personalContext: MemorySummary;
    topOfMind: MemorySummary;
  };
  history: {
    recentMonths: MemorySummary;
    earlierContext: MemorySummary;
    longTermBackground: MemorySummary;
  };
  facts: MemoryFact[];
}

/** Empty memory document, matching deer-flow's default structure verbatim. */
export function createEmptyMemory(nowIso?: string): AgentMemory {
  const ts = nowIso ?? new Date().toISOString();
  const empty = (): MemorySummary => ({ summary: '', updatedAt: '' });
  return {
    version: '1.0',
    lastUpdated: ts,
    user: { workContext: empty(), personalContext: empty(), topOfMind: empty() },
    history: { recentMonths: empty(), earlierContext: empty(), longTermBackground: empty() },
    facts: [],
  };
}
