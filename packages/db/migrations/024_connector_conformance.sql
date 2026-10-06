CREATE TABLE runtime_connector_observations (
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    action_id TEXT NOT NULL,
    adapter_hash TEXT NOT NULL CHECK (adapter_hash ~ '^[a-f0-9]{64}$'),
    request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    result_hash TEXT NOT NULL CHECK (result_hash ~ '^[a-f0-9]{64}$'),
    connection_version INTEGER NOT NULL,
    transport TEXT NOT NULL CHECK (transport IN ('native_transport','custom_transport')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id,run_id,step_id,request_hash,result_hash),
    FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id),
    FOREIGN KEY (tenant_id,run_id,step_id) REFERENCES runtime_steps(tenant_id,run_id,step_id)
);
CREATE INDEX connector_observation_evidence ON runtime_connector_observations(tenant_id,user_id,adapter_hash,action_id);
ALTER TABLE runtime_connector_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_connector_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY connector_observations_tenant ON runtime_connector_observations USING (tenant_id=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
