CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_identity ON users (tenant_id, id);

CREATE TABLE runtime_definitions (
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    hash TEXT NOT NULL,
    definition_id TEXT NOT NULL,
    version TEXT NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, hash)
);

CREATE TABLE runtime_runs (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    persona TEXT NOT NULL,
    definition_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued','running','paused','completed','failed','rejected','cancelled','unsupported','inconclusive','simulated')),
    mode TEXT NOT NULL CHECK (mode IN ('live','simulation')),
    snapshot JSONB NOT NULL,
    request_key TEXT,
    request_hash TEXT NOT NULL,
    parent_run_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, user_id, request_key),
    FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id),
    FOREIGN KEY (tenant_id, definition_hash) REFERENCES runtime_definitions(tenant_id, hash),
    FOREIGN KEY (tenant_id, parent_run_id) REFERENCES runtime_runs(tenant_id, id),
    CHECK (snapshot @> jsonb_build_object('id',id,'tenantId',tenant_id,'userId',user_id,'status',status,'mode',mode))
);
CREATE INDEX runtime_runs_history ON runtime_runs (tenant_id, created_at DESC);
CREATE INDEX runtime_runs_status ON runtime_runs (tenant_id, status, created_at DESC);

CREATE TABLE runtime_jobs (
    tenant_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued','running','waiting','completed','failed','cancelled')),
    payload JSONB NOT NULL,
    priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_owner TEXT,
    lease_until TIMESTAMPTZ,
    fencing_token INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, run_id),
    FOREIGN KEY (tenant_id, run_id) REFERENCES runtime_runs(tenant_id, id)
);
CREATE INDEX runtime_jobs_ready ON runtime_jobs (tenant_id, status, available_at, priority DESC);
CREATE INDEX runtime_jobs_expiry ON runtime_jobs (lease_until) WHERE status='running';

CREATE TABLE runtime_steps (
    tenant_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    status TEXT NOT NULL,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, run_id, step_id),
    FOREIGN KEY (tenant_id, run_id) REFERENCES runtime_runs(tenant_id, id)
);

CREATE TABLE runtime_attempts (
    tenant_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    fencing_token INTEGER NOT NULL,
    worker_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running','completed','failed','expired','waiting','cancelled')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    error TEXT,
    PRIMARY KEY (tenant_id, run_id, attempt),
    FOREIGN KEY (tenant_id, run_id) REFERENCES runtime_jobs(tenant_id, run_id)
);

CREATE TABLE runtime_artifacts (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    output_key TEXT NOT NULL,
    provenance TEXT NOT NULL CHECK (provenance IN ('live','simulated')),
    content JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, run_id, step_id, output_key),
    FOREIGN KEY (tenant_id, run_id, step_id) REFERENCES runtime_steps(tenant_id, run_id, step_id)
);

CREATE TABLE runtime_approvals (
    tenant_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','expired')),
    artifact_digest TEXT NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
    decided_at TIMESTAMPTZ,
    decided_by TEXT,
    reason TEXT,
    PRIMARY KEY (tenant_id, run_id, step_id, attempt),
    FOREIGN KEY (tenant_id, run_id, step_id) REFERENCES runtime_steps(tenant_id, run_id, step_id)
);
CREATE INDEX runtime_approvals_pending ON runtime_approvals (tenant_id, status, requested_at);

CREATE TABLE runtime_events (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    type TEXT NOT NULL,
    data JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivering','delivered')),
    lease_owner TEXT,
    lease_until TIMESTAMPTZ,
    fencing_token INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, run_id) REFERENCES runtime_runs(tenant_id, id)
);
CREATE INDEX runtime_events_pending ON runtime_events (tenant_id, status, created_at);

DO $$
DECLARE relation TEXT;
BEGIN
    FOREACH relation IN ARRAY ARRAY['runtime_definitions','runtime_runs','runtime_jobs','runtime_steps','runtime_attempts','runtime_artifacts','runtime_approvals','runtime_events'] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', relation);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', relation);
        EXECUTE format('CREATE POLICY runtime_tenant ON %I USING (tenant_id = current_setting(''app.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))', relation);
    END LOOP;
END $$;
