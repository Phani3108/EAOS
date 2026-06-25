/**
 * Gateway Persistence Layer — Wires all ephemeral stores to the PersistentStore
 *
 * Instead of modifying every store class, this module:
 * 1. On init: restores saved data into each store's internal state
 * 2. On a periodic interval: snapshots dirty stores to PersistentStore
 * 3. On shutdown: flushes everything
 *
 * This means forum threads, blog posts, scheduler jobs, event logs,
 * audit entries, connection records, and course stats all survive restarts.
 *
 * Snapshot rows always get a STABLE, content-derived id so that re-saving the
 * same logical record overwrites it instead of appending a new row. Without
 * this, Postgres' kv_store would grow unbounded (a fresh row every 5s) and a
 * restore would re-ingest thousands of duplicates — poisoning feedback votes,
 * graph edges, scheduler logs and course stats. We never mint time/random ids.
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import type { Store } from './db.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StoreSnapshot {
  name: string;
  save: () => Record<string, unknown>[];
  restore: (rows: Record<string, unknown>[]) => void;
}

/**
 * Async surface of a backing store (PostgresStore). When present, saveAll and
 * restore route through these awaited methods so writes actually land before
 * the next cycle. File-backed (PersistentStore) has no async methods and uses
 * the synchronous path unchanged.
 */
interface AsyncStore {
  allAsync(table: string): Promise<Record<string, unknown>[]>;
  insertAsync(table: string, id: string, data: Record<string, unknown>): Promise<void>;
  deleteAsync(table: string, id: string): Promise<void>;
}

function asAsyncStore(store: Store): AsyncStore | null {
  const candidate = store as unknown as Partial<AsyncStore>;
  if (
    typeof candidate.allAsync === 'function' &&
    typeof candidate.insertAsync === 'function' &&
    typeof candidate.deleteAsync === 'function'
  ) {
    return candidate as AsyncStore;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Stable, content-derived snapshot ids
// ---------------------------------------------------------------------------

/**
 * Derive a STABLE id for a snapshot row so re-saving overwrites instead of
 * appending. Prefers a record's own `id` when it carries one; otherwise builds
 * a deterministic id from the record's content. Never returns a time/random id.
 */
function stableSnapshotId(tableName: string, record: Record<string, unknown>): string {
  // Records that already carry a stable id (forum threads/comments, blog posts,
  // executions, entities, scheduler jobs, audit entries, connections, agent
  // memory, agent evals, …) keep it verbatim.
  const ownId = record.id;
  if (typeof ownId === 'string' && ownId.length > 0) {
    return ownId;
  }

  // Content-derived ids for the records that have no natural id. These flow
  // through the memory_graph / scheduler_data composite snapshots tagged with
  // a `_type` discriminator.
  const type = record._type;

  if (type === 'feedback') {
    // Skill feedback is one vote per (skill, user) — a stable composite key
    // keeps re-saves from stacking duplicate votes.
    return `feedback:${String(record.skillId)}:${String(record.userId)}`;
  }

  if (type === 'edge') {
    // Graph edge identity is the (source, target, relationship) triple.
    return `edge:${String(record.source)}:${String(record.target)}:${String(record.relationship)}`;
  }

  if (type === 'log') {
    // Scheduler logs are bucketed one entry per jobId in the snapshot.
    return `log:${String(record.jobId)}`;
  }

  // Singleton snapshots (e.g. course_stats) collapse onto a per-table key.
  return tableName;
}

// ---------------------------------------------------------------------------
// Gateway Persistence Controller
// ---------------------------------------------------------------------------

let backingStore: Store | null = null;
const registeredStores: StoreSnapshot[] = [];
let saveTimer: ReturnType<typeof setInterval> | null = null;
const SAVE_INTERVAL_MS = 5_000; // Save dirty state every 5 seconds

/**
 * Register a store for persistence.
 * @param name - Table name in PersistentStore
 * @param save - Function that returns all current records as plain objects
 * @param restore - Function that loads records back into the store
 */
export function registerStore(name: string, save: () => Record<string, unknown>[], restore: (rows: Record<string, unknown>[]) => void): void {
  registeredStores.push({ name, save, restore });
}

/**
 * Initialize persistence — call from server.ts after all stores are created.
 * Restores saved state and starts periodic save timer.
 */
export function initGatewayPersistence(store: Store): void {
  backingStore = store;

  const asyncStore = asAsyncStore(store);
  if (asyncStore) {
    // Async backing store (Postgres): restore through awaited reads, then start
    // the periodic save. The function itself stays synchronous for callers.
    void restoreAllAsync(asyncStore);
  } else {
    restoreAllSync(store);
  }

  // Start periodic save
  saveTimer = setInterval(() => {
    saveAll();
  }, SAVE_INTERVAL_MS);
}

function restoreAllSync(store: Store): void {
  let totalRestored = 0;
  for (const reg of registeredStores) {
    try {
      const saved = store.all(reg.name);
      if (saved.length > 0) {
        reg.restore(saved);
        totalRestored += saved.length;
      }
    } catch (err) {
      console.error(`[persistence] Failed to restore ${reg.name}:`, err);
    }
  }

  if (totalRestored > 0) {
    console.log(`[persistence] Restored ${totalRestored} records across ${registeredStores.length} stores`);
  }
}

async function restoreAllAsync(store: AsyncStore): Promise<void> {
  let totalRestored = 0;
  for (const reg of registeredStores) {
    try {
      const saved = await store.allAsync(reg.name);
      if (saved.length > 0) {
        reg.restore(saved);
        totalRestored += saved.length;
      }
    } catch (err) {
      console.error(`[persistence] Failed to restore ${reg.name}:`, err);
    }
  }

  if (totalRestored > 0) {
    console.log(`[persistence] Restored ${totalRestored} records across ${registeredStores.length} stores`);
  }
}

/**
 * Save all registered stores to the backing store.
 * Routes through the awaited async path when the backing store is async,
 * keeping the synchronous file-backed path exactly as before.
 */
export function saveAll(): void {
  if (!backingStore) return;

  const asyncStore = asAsyncStore(backingStore);
  if (asyncStore) {
    void saveAllAsync(asyncStore);
  } else {
    saveAllSync(backingStore);
  }
}

function saveAllSync(store: Store): void {
  for (const reg of registeredStores) {
    try {
      const records = reg.save();
      // Clear existing table and re-insert all records under stable ids
      const existing = store.all(reg.name);
      for (const row of existing) {
        if (row.id && typeof row.id === 'string') {
          store.delete(reg.name, row.id);
        }
      }
      for (const record of records) {
        const id = stableSnapshotId(reg.name, record);
        store.insert(reg.name, id, record);
      }
    } catch (err) {
      console.error(`[persistence] Failed to save ${reg.name}:`, err);
    }
  }
}

async function saveAllAsync(store: AsyncStore): Promise<void> {
  for (const reg of registeredStores) {
    try {
      const records = reg.save();
      // Clear existing table and re-insert all records under stable ids
      const existing = await store.allAsync(reg.name);
      for (const row of existing) {
        if (row.id && typeof row.id === 'string') {
          await store.deleteAsync(reg.name, row.id);
        }
      }
      for (const record of records) {
        const id = stableSnapshotId(reg.name, record);
        await store.insertAsync(reg.name, id, record);
      }
    } catch (err) {
      console.error(`[persistence] Failed to save ${reg.name}:`, err);
    }
  }
}

/**
 * Flush all stores and stop the periodic save timer.
 */
export function flushGatewayPersistence(): void {
  if (saveTimer) {
    clearInterval(saveTimer);
    saveTimer = null;
  }
  saveAll();
}
