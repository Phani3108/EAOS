CREATE TABLE workspace_records (
    tenant_id TEXT NOT NULL,
    family TEXT NOT NULL CHECK (family IN ('knowledge','memory','configuration','notification_channel','notification_rule','webhook_endpoint','webhook_subscription')),
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id,family,id),
    FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX workspace_records_owner ON workspace_records(tenant_id,user_id,family,updated_at DESC) WHERE archived_at IS NULL;

CREATE TABLE workspace_chat_sessions (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    data JSONB NOT NULL,
    sequence INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id,id),
    FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX workspace_chat_owner ON workspace_chat_sessions(tenant_id,user_id,updated_at DESC) WHERE archived_at IS NULL;
CREATE TABLE workspace_chat_messages (
    tenant_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id,session_id,id),
    UNIQUE (tenant_id,session_id,sequence),
    FOREIGN KEY (tenant_id,session_id) REFERENCES workspace_chat_sessions(tenant_id,id)
);

CREATE TABLE workspace_connections (
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    connector_id TEXT NOT NULL,
    secret_ref JSONB NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('configured','verifying','verified','expired','revoked','unsupported','unavailable')),
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id,user_id,connector_id),
    FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id),
    CHECK (secret_ref->>'provider' IN ('vault','aws','gcp','azure'))
);
CREATE INDEX workspace_connections_connector ON workspace_connections(tenant_id,connector_id,status);

CREATE TABLE runtime_usage_budgets (
    tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
    limit_micros BIGINT NOT NULL CHECK (limit_micros >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE runtime_usage_reservations (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    estimate_micros BIGINT NOT NULL CHECK (estimate_micros >= 0),
    actual_micros BIGINT CHECK (actual_micros >= 0),
    status TEXT NOT NULL CHECK (status IN ('reserved','settled','released')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settled_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id,id),
    UNIQUE (tenant_id,run_id,step_id,attempt),
    FOREIGN KEY (tenant_id,run_id,step_id) REFERENCES runtime_steps(tenant_id,run_id,step_id)
);
CREATE INDEX runtime_usage_ledger ON runtime_usage_reservations(tenant_id,status,created_at);

CREATE TABLE runtime_step_attempts (
    tenant_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    worker_attempt INTEGER NOT NULL,
    fencing_token INTEGER NOT NULL,
    status TEXT NOT NULL,
    inputs JSONB NOT NULL,
    output JSONB,
    error TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id,run_id,step_id,attempt),
    FOREIGN KEY (tenant_id,run_id,step_id) REFERENCES runtime_steps(tenant_id,run_id,step_id),
    FOREIGN KEY (tenant_id,run_id,worker_attempt) REFERENCES runtime_attempts(tenant_id,run_id,attempt)
);
ALTER TABLE runtime_artifacts ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE runtime_artifacts ADD COLUMN content_hash TEXT;
CREATE TABLE runtime_artifact_parents (
    tenant_id TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    PRIMARY KEY (tenant_id,artifact_id,parent_id),
    FOREIGN KEY (tenant_id,artifact_id) REFERENCES runtime_artifacts(tenant_id,id),
    FOREIGN KEY (tenant_id,parent_id) REFERENCES runtime_artifacts(tenant_id,id),
    CHECK (artifact_id <> parent_id)
);

CREATE TABLE runtime_schedules (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active','paused','completed','failed')),
    schedule_type TEXT NOT NULL CHECK (schedule_type IN ('once','interval','cron','event')),
    next_run_at TIMESTAMPTZ,
    version INTEGER NOT NULL DEFAULT 1,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id,id),
    FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX runtime_schedules_due ON runtime_schedules(tenant_id,next_run_at) WHERE status='active';
CREATE TABLE runtime_trigger_receipts (
    tenant_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    delivery_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    run_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id,source_id,delivery_id),
    FOREIGN KEY (tenant_id,run_id) REFERENCES runtime_runs(tenant_id,id)
);
CREATE TABLE runtime_deliveries (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    connector_id TEXT NOT NULL,
    delivery_key TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued','sending','delivered','failed','inconclusive','unsupported')),
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_owner TEXT,
    lease_until TIMESTAMPTZ,
    fencing_token INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id,id),
    UNIQUE (tenant_id,connector_id,delivery_key),
    FOREIGN KEY (tenant_id,run_id) REFERENCES runtime_runs(tenant_id,id),
    FOREIGN KEY (tenant_id,user_id,connector_id) REFERENCES workspace_connections(tenant_id,user_id,connector_id)
);
CREATE INDEX runtime_deliveries_ready ON runtime_deliveries(tenant_id,status,available_at);

DO $$
DECLARE relation TEXT;
BEGIN
    FOREACH relation IN ARRAY ARRAY['workspace_records','workspace_chat_sessions','workspace_chat_messages','workspace_connections','runtime_usage_budgets','runtime_usage_reservations','runtime_step_attempts','runtime_artifact_parents','runtime_schedules','runtime_trigger_receipts','runtime_deliveries'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', relation);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', relation);
        EXECUTE format('CREATE POLICY workspace_tenant ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))', relation);
    END LOOP;
END $$;
