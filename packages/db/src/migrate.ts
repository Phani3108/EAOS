import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export async function runMigrations(pool: pg.Pool): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(709461)');
    await client.query('CREATE TABLE IF NOT EXISTS eaos_schema_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    const { rows } = await client.query<{ name: string; sha256: string }>('SELECT name, sha256 FROM eaos_schema_migrations');
    const known = new Map(rows.map(row => [row.name, row.sha256]));
    const directory = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
    for (const name of (await readdir(directory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort()) {
      const sql = await readFile(join(directory, name), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      if (known.has(name)) {
        if (known.get(name) !== hash) throw new Error(`Applied migration was modified: ${name}`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO eaos_schema_migrations (name, sha256) VALUES ($1,$2)', [name, hash]);
        await client.query('COMMIT');
        applied.push(name);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    return applied;
  } finally {
    try { await client.query('SELECT pg_advisory_unlock(709461)'); } finally { client.release(); }
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for migrations');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try { console.log(`Applied migrations: ${(await runMigrations(pool)).join(', ') || 'none'}`); }
  finally { await pool.end(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(err => { console.error((err as Error).message); process.exitCode = 1; });
}
