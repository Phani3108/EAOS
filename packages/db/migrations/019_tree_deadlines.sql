ALTER TABLE runtime_runs ADD COLUMN deadline_at TIMESTAMPTZ;
CREATE INDEX runtime_root_deadline ON runtime_runs(tenant_id,deadline_at) WHERE parent_run_id IS NULL AND status IN ('queued','running','paused');
CREATE OR REPLACE FUNCTION runtime_ancestors_active(scope TEXT, run TEXT) RETURNS BOOLEAN
LANGUAGE SQL STABLE AS $$
    WITH RECURSIVE ancestry AS (
        SELECT r.id,r.parent_run_id,r.status,r.deadline_at,0 AS level FROM runtime_runs r WHERE r.tenant_id=scope AND r.id=run
        UNION ALL
        SELECT r.id,r.parent_run_id,r.status,r.deadline_at,a.level+1 FROM runtime_runs r JOIN ancestry a ON r.id=a.parent_run_id WHERE r.tenant_id=scope AND a.level<6
    )
    SELECT NOT EXISTS (SELECT 1 FROM ancestry WHERE (level>0 AND status NOT IN ('queued','running','paused')) OR level>5 OR deadline_at<=NOW())
$$;
