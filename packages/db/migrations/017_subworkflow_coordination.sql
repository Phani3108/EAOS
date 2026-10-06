ALTER TABLE runtime_runs ADD COLUMN root_run_id TEXT;
ALTER TABLE runtime_runs ADD COLUMN depth INTEGER NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 5);
ALTER TABLE runtime_runs ADD CONSTRAINT runtime_root_scope FOREIGN KEY (tenant_id,root_run_id) REFERENCES runtime_runs(tenant_id,id);
CREATE INDEX runtime_run_parent ON runtime_runs(tenant_id,parent_run_id);
CREATE INDEX runtime_run_root ON runtime_runs(tenant_id,root_run_id);
ALTER TABLE runtime_jobs ADD COLUMN wake_at TIMESTAMPTZ;

CREATE TABLE runtime_children (
    tenant_id TEXT NOT NULL,
    parent_run_id TEXT NOT NULL,
    parent_step_id TEXT NOT NULL,
    child_run_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id,parent_run_id,parent_step_id),
    UNIQUE (tenant_id,child_run_id),
    FOREIGN KEY (tenant_id,parent_run_id,parent_step_id) REFERENCES runtime_steps(tenant_id,run_id,step_id),
    FOREIGN KEY (tenant_id,child_run_id) REFERENCES runtime_runs(tenant_id,id),
    CHECK (parent_run_id <> child_run_id)
);
CREATE FUNCTION runtime_ancestors_active(scope TEXT, run TEXT) RETURNS BOOLEAN
LANGUAGE SQL STABLE AS $$
    WITH RECURSIVE ancestry AS (
        SELECT r.id,r.parent_run_id,r.status,0 AS level FROM runtime_runs r WHERE r.tenant_id=scope AND r.id=run
        UNION ALL
        SELECT r.id,r.parent_run_id,r.status,a.level+1 FROM runtime_runs r JOIN ancestry a ON r.id=a.parent_run_id WHERE r.tenant_id=scope AND a.level<6
    )
    SELECT NOT EXISTS (SELECT 1 FROM ancestry WHERE (level>0 AND status NOT IN ('queued','running','paused')) OR level>5)
$$;

ALTER TABLE runtime_children ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_children FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_children_tenant ON runtime_children USING (tenant_id=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
