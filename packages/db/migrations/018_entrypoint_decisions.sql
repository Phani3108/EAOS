ALTER TABLE runtime_approvals ADD COLUMN confirmations JSONB NOT NULL DEFAULT '{}';
CREATE INDEX runtime_entrypoint_history ON runtime_runs(tenant_id,(snapshot->'source'->>'type'),created_at DESC);
