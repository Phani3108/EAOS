CREATE TABLE platform_event_offsets (
    tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
    next_sequence BIGINT NOT NULL DEFAULT 0 CHECK (next_sequence>=0)
);
ALTER TABLE platform_event_offsets ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_event_offsets FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_offsets_tenant ON platform_event_offsets USING (tenant_id=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
ALTER TABLE runtime_events ADD COLUMN stream_sequence BIGINT;
CREATE UNIQUE INDEX runtime_stream_sequence ON runtime_events(tenant_id,stream_sequence);

CREATE FUNCTION runtime_actor_active(scope TEXT, actor TEXT, required JSONB DEFAULT '[]') RETURNS BOOLEAN
LANGUAGE SQL STABLE AS $$
    SELECT NOT EXISTS (SELECT 1 FROM platform_memberships m WHERE m.tenant_id=scope AND m.user_id=actor AND (m.state<>'active' OR NOT ('*'=ANY(m.persona_scopes)) AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(required) p WHERE NOT p=ANY(m.persona_scopes))))
$$;
CREATE OR REPLACE FUNCTION runtime_ancestors_active(scope TEXT, run TEXT) RETURNS BOOLEAN
LANGUAGE SQL STABLE AS $$
    WITH RECURSIVE ancestry AS (
        SELECT r.id,r.user_id,r.parent_run_id,r.status,r.deadline_at,r.snapshot,0 AS level FROM runtime_runs r WHERE r.tenant_id=scope AND r.id=run
        UNION ALL
        SELECT r.id,r.user_id,r.parent_run_id,r.status,r.deadline_at,r.snapshot,a.level+1 FROM runtime_runs r JOIN ancestry a ON r.id=a.parent_run_id WHERE r.tenant_id=scope AND a.level<6
    )
    SELECT NOT EXISTS (SELECT 1 FROM ancestry WHERE (level>0 AND status NOT IN ('queued','running','paused')) OR level>5 OR deadline_at<=NOW() OR NOT runtime_actor_active(scope,user_id,COALESCE(snapshot->'requiredPersonas','[]')))
$$;
