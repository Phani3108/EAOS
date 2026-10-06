CREATE TABLE runtime_agent_leases (
    tenant_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    fencing_token INTEGER NOT NULL,
    released_at TIMESTAMPTZ,
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id,run_id,step_id),
    FOREIGN KEY (tenant_id,run_id,step_id) REFERENCES runtime_steps(tenant_id,run_id,step_id)
);
CREATE INDEX runtime_agent_capacity ON runtime_agent_leases(tenant_id,agent_id) WHERE released_at IS NULL;
ALTER TABLE runtime_agent_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_agent_leases FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_agent_tenant ON runtime_agent_leases USING (tenant_id=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
