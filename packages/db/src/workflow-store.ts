/**
 * WorkflowStore — Persistent pipeline execution state.
 *
 * Wraps PersistentStore to give the pipeline engine durable state that
 * survives gateway restarts. Serialises Map fields to plain objects on
 * write and reconstructs them on read.
 *
 * Usage:
 *   const store = new WorkflowStore();
 *   store.save(execution);
 *   const restored = store.get(id);
 *   const all = store.list();
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import type { Store } from './connection.js';
import { readAll } from './create-store.js';

// ---------------------------------------------------------------------------
// Serialisable snapshot (Maps replaced with plain objects)
// ---------------------------------------------------------------------------

export interface WorkflowSnapshot {
  id: string;
  graphId: string;
  intent: string;
  status: string;
  /** nodeStates Map serialised as { [nodeId]: NodeState } */
  nodeStates: Record<string, unknown>;
  /** sharedState Map serialised as { [key]: value } */
  sharedState: Record<string, unknown>;
  /** feedbackLoopCounts Map serialised as { [key]: number } */
  feedbackLoopCounts: Record<string, number>;
  startedAt: string;
  completedAt: string | null;
  totalTokensUsed: number;
  totalCostUsd: number;
  statusReports: string[];
  afterActionReport: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapToObject<V>(m: Map<string, V>): Record<string, V> {
  return Object.fromEntries(m.entries());
}

function objectToMap<V>(o: Record<string, V>): Map<string, V> {
  return new Map(Object.entries(o));
}

// ---------------------------------------------------------------------------
// WorkflowStore
// ---------------------------------------------------------------------------

const WORKFLOW_TABLE = 'pipeline_executions';

export class WorkflowStore {
  private store: Store;

  /**
   * Takes the process-wide Store rather than constructing its own.
   *
   * It previously did `new PersistentStore(dataDir)` with `dataDir` undefined,
   * which resolved to the same `<cwd>/.agentos-data/store.json` that server.ts
   * already had open. Each instance held a private table map and serialised only
   * its own tables over the whole file, so whichever debounce fired last silently
   * deleted the other's data — which is why `store.json` on disk contains no
   * `pipeline_executions` table at all.
   */
  constructor(store: Store) {
    this.store = store;
  }

  /**
   * Persist a PipelineExecution. Accepts any object with the required shape
   * (keeps pipeline-engine.ts free of a direct WorkflowStore import by using
   * duck-typing rather than the full generic).
   */
  save(exec: {
    id: string;
    graphId: string;
    intent: string;
    status: string;
    nodeStates: Map<string, unknown>;
    sharedState: Map<string, unknown>;
    feedbackLoopCounts: Map<string, number>;
    startedAt: string;
    completedAt: string | null;
    totalTokensUsed: number;
    totalCostUsd: number;
    statusReports: string[];
    afterActionReport: string | null;
  }): void {
    const snapshot: WorkflowSnapshot = {
      id: exec.id,
      graphId: exec.graphId,
      intent: exec.intent,
      status: exec.status,
      nodeStates: mapToObject(exec.nodeStates),
      sharedState: mapToObject(exec.sharedState),
      feedbackLoopCounts: mapToObject(exec.feedbackLoopCounts),
      startedAt: exec.startedAt,
      completedAt: exec.completedAt,
      totalTokensUsed: exec.totalTokensUsed,
      totalCostUsd: exec.totalCostUsd,
      statusReports: exec.statusReports,
      afterActionReport: exec.afterActionReport,
    };

    const existing = this.store.get(WORKFLOW_TABLE, exec.id);
    if (existing) {
      this.store.update(WORKFLOW_TABLE, exec.id, snapshot as unknown as Record<string, unknown>);
    } else {
      this.store.insert(WORKFLOW_TABLE, exec.id, snapshot as unknown as Record<string, unknown>);
    }
  }

  get(id: string): WorkflowSnapshot | undefined {
    const row = this.store.get(WORKFLOW_TABLE, id);
    if (!row) return undefined;
    return this.rowToSnapshot(row);
  }

  /**
   * Async because `PostgresStore.all()` throws by design — callers must go
   * through `allAsync()`. This method was synchronous and is reached from
   * `initWorkflowStore()` at boot, so it was a ninth way that setting
   * DATABASE_URL crashed the gateway during module evaluation.
   */
  async list(limit = 50): Promise<WorkflowSnapshot[]> {
    const rows = await readAll(this.store, WORKFLOW_TABLE);
    return rows
      .map(r => this.rowToSnapshot(r))
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, limit);
  }

  delete(id: string): void {
    this.store.delete(WORKFLOW_TABLE, id);
  }

  /**
   * Restore Map fields from a snapshot back into a live execution object.
   * Call this when rehydrating the in-memory pipelineExecutions Map on startup.
   */
  rehydrate(snapshot: WorkflowSnapshot): {
    id: string;
    graphId: string;
    intent: string;
    status: string;
    nodeStates: Map<string, unknown>;
    sharedState: Map<string, unknown>;
    feedbackLoopCounts: Map<string, number>;
    startedAt: string;
    completedAt: string | null;
    totalTokensUsed: number;
    totalCostUsd: number;
    statusReports: string[];
    afterActionReport: string | null;
  } {
    return {
      id: snapshot.id,
      graphId: snapshot.graphId,
      intent: snapshot.intent,
      status: snapshot.status,
      nodeStates: objectToMap(snapshot.nodeStates as Record<string, unknown>),
      sharedState: objectToMap(snapshot.sharedState),
      feedbackLoopCounts: objectToMap(snapshot.feedbackLoopCounts),
      startedAt: snapshot.startedAt,
      completedAt: snapshot.completedAt,
      totalTokensUsed: snapshot.totalTokensUsed,
      totalCostUsd: snapshot.totalCostUsd,
      statusReports: snapshot.statusReports,
      afterActionReport: snapshot.afterActionReport,
    };
  }

  private rowToSnapshot(row: Record<string, unknown>): WorkflowSnapshot {
    return row as unknown as WorkflowSnapshot;
  }
}
