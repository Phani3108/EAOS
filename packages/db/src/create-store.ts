/**
 * Store selection that never crashes the process.
 *
 * The previous three-way ternary in server.ts had two failure modes, both fatal
 * during module evaluation:
 *
 *   - default path → `new PersistentStore()` → `mkdirSync(cwd + '/.agentos-data')`
 *     with no try/catch → EROFS on any read-only filesystem (Vercel, Lambda,
 *     a container with a read-only root, a distroless image).
 *   - `DATABASE_URL` set → `new PostgresStore()`, whose `all()` throws by
 *     design, called synchronously by eight `init*Store()` functions at import.
 *
 * Storage is an operational concern, so degrading loudly beats refusing to boot:
 * a process that starts and reports `persistence: "ephemeral"` on /api/health can
 * be diagnosed. A process that exits before it opens a port cannot.
 */

import { existsSync, mkdirSync, accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { InMemoryStore, type Store } from './connection.js';
import { PersistentStore } from './persistent-store.js';

export type StoreMode = 'postgres' | 'file' | 'ephemeral';

export interface CreateStoreOptions {
  /** Postgres connection string. When set, Postgres wins. */
  databaseUrl?: string;
  /** Directory for the file-backed store. Defaults to `<cwd>/.agentos-data`. */
  dataDir?: string;
  /** Force in-memory regardless of the above (tests). */
  forceEphemeral?: boolean;
  /** Injected so the caller owns the pg dependency. */
  postgresFactory?: () => Store;
}

export interface CreateStoreResult {
  store: Store;
  mode: StoreMode;
  /** Where the file store writes, when mode === 'file'. */
  path?: string;
  /**
   * Why we are not on the mode that was asked for. Surface this on
   * /api/health — silent degradation to ephemeral is how state "disappears".
   */
  degradedReason?: string;
}

/** Is `dir` usable — existing and writable, or creatable? */
function ensureWritableDir(dir: string): { ok: true } | { ok: false; reason: string } {
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      return { ok: true };
    }
    accessSync(dir, constants.W_OK);
    return { ok: true };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return { ok: false, reason: `${dir}: ${e.code ?? 'unknown'} ${e.message}` };
  }
}

/**
 * Pick a store. Never throws.
 *
 * Precedence: forceEphemeral → Postgres → writable file dir → ephemeral.
 */
export function createStore(options: CreateStoreOptions = {}): CreateStoreResult {
  const { databaseUrl, dataDir, forceEphemeral, postgresFactory } = options;

  if (forceEphemeral) {
    return { store: new InMemoryStore(), mode: 'ephemeral' };
  }

  if (databaseUrl && postgresFactory) {
    try {
      return { store: postgresFactory(), mode: 'postgres' };
    } catch (err) {
      // Fall through rather than exit: an unreachable database at boot is a
      // transient condition, and a process that is up can report it.
      const reason = `Postgres unavailable: ${(err as Error).message}`;
      const fallback = tryFileStore(dataDir);
      return fallback ?? { store: new InMemoryStore(), mode: 'ephemeral', degradedReason: reason };
    }
  }

  const fileStore = tryFileStore(dataDir);
  if (fileStore) return fileStore;

  return {
    store: new InMemoryStore(),
    mode: 'ephemeral',
    degradedReason:
      `No writable data directory (${dataDir ?? join(process.cwd(), '.agentos-data')}) and no DATABASE_URL. ` +
      'All state is in memory and will be lost on restart. Set DATA_DIR to a writable path or set DATABASE_URL.',
  };
}

function tryFileStore(dataDir?: string): CreateStoreResult | null {
  const dir = dataDir ?? join(process.cwd(), '.agentos-data');
  const writable = ensureWritableDir(dir);
  if (!writable.ok) return null;
  try {
    return { store: new PersistentStore(dir), mode: 'file', path: join(dir, 'store.json') };
  } catch (err) {
    // Includes the duplicate-open guard in PersistentStore — a real bug that
    // should surface, but not as a boot crash.
    console.error(`[create-store] file store unavailable: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Read a whole table from either store shape.
 *
 * `PostgresStore` implements `Store` but its `all()` THROWS — callers are meant
 * to use `allAsync()`, signalled only by an `isAsync` boolean. Eight
 * `init*Store()` functions called `all()` synchronously, so setting
 * `DATABASE_URL` — the documented production configuration — crashed the gateway
 * at import. This helper is the one place that difference is handled.
 */
export async function readAll(store: Store, table: string): Promise<Record<string, unknown>[]> {
  const maybeAsync = store as Store & {
    allAsync?: (t: string) => Promise<Record<string, unknown>[]>;
  };
  if (typeof maybeAsync.allAsync === 'function') {
    return maybeAsync.allAsync(table);
  }
  return store.all(table);
}
