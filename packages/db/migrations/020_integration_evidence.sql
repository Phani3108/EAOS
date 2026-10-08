ALTER TABLE workspace_connections ADD COLUMN config JSONB NOT NULL DEFAULT '{}';
ALTER TABLE workspace_connections ADD COLUMN account JSONB;
ALTER TABLE workspace_connections ADD COLUMN secret_version TEXT;
ALTER TABLE workspace_connections ADD COLUMN binding_hash TEXT;
ALTER TABLE workspace_connections ADD COLUMN verified_at TIMESTAMPTZ;

CREATE TABLE input_artifacts (
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    digest TEXT NOT NULL,
    bytes BYTEA NOT NULL CHECK (octet_length(bytes)<=512000),
    extracted_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id,id),
    FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX input_artifacts_owner ON input_artifacts(tenant_id,user_id,created_at DESC);
CREATE TABLE runtime_input_artifacts (
    tenant_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    digest TEXT NOT NULL,
    PRIMARY KEY (tenant_id,run_id,artifact_id),
    FOREIGN KEY (tenant_id,run_id) REFERENCES runtime_runs(tenant_id,id),
    FOREIGN KEY (tenant_id,artifact_id) REFERENCES input_artifacts(tenant_id,id)
);
CREATE TABLE runtime_tool_receipts (
    tenant_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    fencing_token INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('dispatching','completed','failed','inconclusive')),
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id,run_id,step_id),
    FOREIGN KEY (tenant_id,run_id,step_id) REFERENCES runtime_steps(tenant_id,run_id,step_id)
);
CREATE TABLE integration_audit (
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    id TEXT NOT NULL,
    action TEXT NOT NULL,
    resource TEXT NOT NULL,
    success BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id,id),
    FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id)
);
ALTER TABLE input_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE input_artifacts FORCE ROW LEVEL SECURITY;
CREATE POLICY input_artifacts_tenant ON input_artifacts USING (tenant_id=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
ALTER TABLE runtime_input_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_input_artifacts FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_input_artifacts_tenant ON runtime_input_artifacts USING (tenant_id=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
ALTER TABLE runtime_tool_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_tool_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_tool_receipts_tenant ON runtime_tool_receipts USING (tenant_id=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
ALTER TABLE integration_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY integration_audit_tenant ON integration_audit USING (tenant_id=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
