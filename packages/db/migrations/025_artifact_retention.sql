-- Ephemeral input artifacts (public demo visitors) expire; NULL means kept until archived.
ALTER TABLE input_artifacts ADD COLUMN expires_at TIMESTAMPTZ;
-- The shared ephemeral pool is counted, and expired rows purged, per tenant on every ephemeral upload.
CREATE INDEX input_artifacts_ephemeral ON input_artifacts(tenant_id,expires_at) WHERE expires_at IS NOT NULL AND archived_at IS NULL;
