/**
 * @agentos/memory — Memory Service
 *
 * Vector store (pgvector), episode memory (PostgreSQL), and context bus.
 * Exposes HTTP endpoints on configurable port.
 */

import http from 'node:http';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemoryConfig {
    port: number;
    databaseUrl: string;
    embeddingModel: string;
    embeddingDimensions: number;
}

const config: MemoryConfig = {
    port: parseInt(process.env.MEMORY_PORT ?? '3002', 10),
    databaseUrl: process.env.DATABASE_URL ?? 'postgresql://eaos:eaos-dev-password@localhost:5432/eaos',
    embeddingModel: 'text-embedding-3-small',
    embeddingDimensions: 1536,
};

// ---------------------------------------------------------------------------
// Lightweight pg pool (dynamic import)
// ---------------------------------------------------------------------------

interface PgPool {
    query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
    end(): Promise<void>;
}

let pool: PgPool;

async function getPool(): Promise<PgPool> {
    if (pool) return pool;
    const { default: pg } = await import('pg');
    const Pool = pg.Pool ?? (pg as unknown as { Pool: new (c: Record<string, unknown>) => PgPool }).Pool;
    pool = new Pool({ connectionString: config.databaseUrl, max: 5 });
    return pool;
}

// ---------------------------------------------------------------------------
// Bootstrap — create tables if they don't exist
// ---------------------------------------------------------------------------

const BOOTSTRAP_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS memory_vectors (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  namespace TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mv_namespace ON memory_vectors(namespace);

CREATE TABLE IF NOT EXISTS memory_episodes (
  id BIGSERIAL PRIMARY KEY,
  execution_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  task_id TEXT,
  action JSONB NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_me_exec ON memory_episodes(execution_id);
CREATE INDEX IF NOT EXISTS idx_me_worker ON memory_episodes(worker_id);
`;

// ---------------------------------------------------------------------------
// Embedding helper — uses OpenAI-compatible API or falls back to random vec
// ---------------------------------------------------------------------------

/** Raised when no embedding provider is configured. Not retryable. */
export class EmbeddingsNotConfiguredError extends Error {
    readonly name = 'EmbeddingsNotConfiguredError';
    constructor() {
        super(
            'OPENAI_API_KEY is not set, so no real embeddings can be produced. ' +
                'Set it, or set MEMORY_ALLOW_SYNTHETIC_EMBEDDINGS=true for local ' +
                'development (synthetic vectors can be searched but never stored).',
        );
    }
}

/**
 * An embedding plus where it came from.
 *
 * `synthetic` vectors are hash-derived and carry no semantic meaning. Cosine
 * similarity over them produces confident-looking numbers that mean nothing, so
 * they are opt-in, always reported, and never written to the database — a stored
 * synthetic vector would silently corrupt every future search against that
 * namespace, with no way to identify it after the fact.
 */
interface Embedding {
    vector: number[];
    basis: 'measured' | 'synthetic';
}

async function embed(text: string): Promise<Embedding> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        if (process.env.MEMORY_ALLOW_SYNTHETIC_EMBEDDINGS !== 'true') {
            throw new EmbeddingsNotConfiguredError();
        }
        // Deterministic pseudo-random vector for local dev only.
        const vec: number[] = [];
        let h = 0;
        for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
        for (let i = 0; i < config.embeddingDimensions; i++) {
            h = ((h << 5) - h + i) | 0;
            vec.push(((h & 0xffff) / 0x10000) * 2 - 1);
        }
        // Normalize
        const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
        return { vector: vec.map(v => v / mag), basis: 'synthetic' };
    }

    const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model: config.embeddingModel, input: text }),
    });

    if (!res.ok) throw new Error(`Embedding API error: ${res.status}`);
    const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return { vector: data.data[0].embedding, basis: 'measured' };
}

// ---------------------------------------------------------------------------
// Memory Service
// ---------------------------------------------------------------------------

class MemoryService {
    private server: http.Server | null = null;

    async start(): Promise<void> {
        const db = await getPool();
        await db.query(BOOTSTRAP_SQL);

        this.server = http.createServer(async (req, res) => {
            const url = new URL(req.url ?? '/', `http://localhost:${config.port}`);
            const path = url.pathname;
            const method = req.method ?? 'GET';

            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

            try {
                // Health
                if (path === '/health') {
                    res.writeHead(200);
                    res.end(JSON.stringify({ status: 'ok', service: 'memory' }));
                    return;
                }

                const body = method === 'POST' ? await readBody(req) : {};

                // POST /upsert — add document to vector store
                if (path === '/upsert' && method === 'POST') {
                    const { namespace, content, metadata } = body as { namespace: string; content: string; metadata?: Record<string, unknown> };
                    if (!namespace || !content) { send(res, 400, { error: 'namespace and content required' }); return; }
                    const emb = await embed(content);
                    // A synthetic vector must never be persisted: it is
                    // indistinguishable from a real one once stored, and it
                    // degrades every subsequent kNN query in this namespace.
                    if (emb.basis === 'synthetic') {
                        send(res, 503, {
                            error: 'Refusing to store a synthetic embedding',
                            reason:
                                'No embedding provider is configured. Set OPENAI_API_KEY. ' +
                                'Synthetic vectors are searchable in dev but are never written, ' +
                                'because a stored one would silently corrupt this namespace.',
                            embeddingBasis: emb.basis,
                        });
                        return;
                    }
                    const { rows } = await db.query(
                        `INSERT INTO memory_vectors (namespace, content, embedding, metadata) VALUES ($1, $2, $3::vector, $4) RETURNING id`,
                        [namespace, content, `[${emb.vector.join(',')}]`, JSON.stringify(metadata ?? {})],
                    );
                    send(res, 200, { id: rows[0].id, embeddingBasis: emb.basis });
                    return;
                }

                // POST /search — semantic search
                if (path === '/search' && method === 'POST') {
                    const { namespace, query, topK, minSimilarity } = body as {
                        namespace: string; query: string; topK?: number; minSimilarity?: number;
                    };
                    if (!namespace || !query) { send(res, 400, { error: 'namespace and query required' }); return; }
                    const emb = await embed(query);
                    const k = topK ?? 5;
                    const minSim = minSimilarity ?? 0.5;
                    const { rows } = await db.query(
                        `SELECT id, content, metadata, 1 - (embedding <=> $1::vector) AS similarity
                         FROM memory_vectors
                         WHERE namespace = $2 AND 1 - (embedding <=> $1::vector) >= $3
                         ORDER BY embedding <=> $1::vector
                         LIMIT $4`,
                        [`[${emb.vector.join(',')}]`, namespace, minSim, k],
                    );
                    // `embeddingBasis` travels with the results so a caller can
                    // tell a real semantic match from a meaningless dev one. The
                    // similarity numbers look identical either way.
                    send(res, 200, { results: rows, embeddingBasis: emb.basis });
                    return;
                }

                // POST /episode — record episode
                if (path === '/episode' && method === 'POST') {
                    const { executionId, workerId, taskId, action, result } = body as {
                        executionId: string; workerId: string; taskId?: string; action: unknown; result: unknown;
                    };
                    if (!executionId || !workerId) { send(res, 400, { error: 'executionId and workerId required' }); return; }
                    await db.query(
                        `INSERT INTO memory_episodes (execution_id, worker_id, task_id, action, result) VALUES ($1, $2, $3, $4, $5)`,
                        [executionId, workerId, taskId ?? '', JSON.stringify(action), JSON.stringify(result)],
                    );
                    send(res, 200, { ok: true });
                    return;
                }

                // GET /episodes?executionId=xxx&workerId=yyy&limit=50
                if (path === '/episodes' && method === 'GET') {
                    const execId = url.searchParams.get('executionId');
                    const workerId = url.searchParams.get('workerId');
                    const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
                    let sql = 'SELECT * FROM memory_episodes WHERE 1=1';
                    const params: unknown[] = [];
                    if (execId) { params.push(execId); sql += ` AND execution_id = $${params.length}`; }
                    if (workerId) { params.push(workerId); sql += ` AND worker_id = $${params.length}`; }
                    params.push(limit);
                    sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
                    const { rows } = await db.query(sql, params);
                    send(res, 200, { episodes: rows });
                    return;
                }

                send(res, 404, { error: 'Not found' });
            } catch (err) {
                console.error('[memory]', err);
                send(res, 500, { error: (err as Error).message });
            }
        });

        this.server.listen(config.port, () => {
            console.log(`🧠 Memory service listening on port ${config.port}`);
            console.log(`   Vector Store: pgvector (${config.embeddingDimensions}d)`);
            console.log(`   Embedding: ${process.env.OPENAI_API_KEY ? config.embeddingModel : 'deterministic dev vectors'}`);
            console.log(`   Database: ${config.databaseUrl.replace(/:[^@]+@/, ':***@')}`);
        });
    }

    async stop(): Promise<void> {
        if (this.server) this.server.close();
        if (pool) await pool.end();
        console.log('🧠 Memory service stopped');
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function send(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status);
    res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
            catch { resolve({}); }
        });
    });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const memory = new MemoryService();

memory.start().catch((err) => {
    console.error('Failed to start memory service:', err);
    process.exit(1);
});

process.on('SIGTERM', () => memory.stop());
process.on('SIGINT', () => memory.stop());

export { MemoryService };
export type { MemoryConfig };
