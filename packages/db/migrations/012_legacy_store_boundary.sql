CREATE TABLE IF NOT EXISTS kv_store (
    _table TEXT NOT NULL,
    id TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (_table, id)
);
CREATE INDEX IF NOT EXISTS idx_kv_store_table ON kv_store(_table);
