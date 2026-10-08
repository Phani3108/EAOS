CREATE TABLE platform_http_metrics (
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    bucket TIMESTAMPTZ NOT NULL,
    method TEXT NOT NULL,
    route TEXT NOT NULL,
    status INTEGER NOT NULL CHECK (status BETWEEN 100 AND 599),
    requests BIGINT NOT NULL CHECK (requests>=0),
    latency_ms DOUBLE PRECISION NOT NULL CHECK (latency_ms>=0),
    PRIMARY KEY (tenant_id,bucket,method,route,status)
);
CREATE TABLE platform_datasets (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    data JSONB NOT NULL,
    readers TEXT[] NOT NULL DEFAULT '{}',
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id,id),
    FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE TABLE platform_evaluations (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    dataset_id TEXT NOT NULL,
    dataset_version INTEGER NOT NULL,
    definition_hash TEXT NOT NULL,
    reviewer_id TEXT NOT NULL,
    stage TEXT NOT NULL CHECK (stage IN ('live','simulation')),
    sample_count INTEGER NOT NULL CHECK (sample_count>0),
    pass_rate DOUBLE PRECISION NOT NULL CHECK (pass_rate BETWEEN 0 AND 1),
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id,id),
    FOREIGN KEY (tenant_id,dataset_id) REFERENCES platform_datasets(tenant_id,id),
    FOREIGN KEY (tenant_id,definition_hash) REFERENCES runtime_definitions(tenant_id,hash),
    FOREIGN KEY (tenant_id,reviewer_id) REFERENCES users(tenant_id,id)
);
CREATE TABLE platform_registry_packages (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('workflow','connector')),
    name TEXT NOT NULL,
    visibility TEXT NOT NULL CHECK (visibility IN ('private','tenant')),
    reviewers TEXT[] NOT NULL DEFAULT '{}',
    revision INTEGER NOT NULL DEFAULT 1,
    active_hash TEXT,
    PRIMARY KEY (tenant_id,id),
    UNIQUE (tenant_id,kind,name),
    FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE TABLE platform_registry_versions (
    tenant_id TEXT NOT NULL,
    package_id TEXT NOT NULL,
    hash TEXT NOT NULL,
    publisher_id TEXT NOT NULL,
    data JSONB NOT NULL,
    origin TEXT NOT NULL,
    license TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected')),
    reviewer_id TEXT,
    evaluation_id TEXT,
    review_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id,package_id,hash),
    FOREIGN KEY (tenant_id,package_id) REFERENCES platform_registry_packages(tenant_id,id),
    FOREIGN KEY (tenant_id,publisher_id) REFERENCES users(tenant_id,id),
    FOREIGN KEY (tenant_id,reviewer_id) REFERENCES users(tenant_id,id),
    FOREIGN KEY (tenant_id,evaluation_id) REFERENCES platform_evaluations(tenant_id,id)
);
ALTER TABLE platform_registry_packages ADD CONSTRAINT registry_active_version FOREIGN KEY (tenant_id,id,active_hash) REFERENCES platform_registry_versions(tenant_id,package_id,hash) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE platform_record_reviews (
    tenant_id TEXT NOT NULL,
    family TEXT NOT NULL,
    record_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    record_version INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    reviewer_id TEXT NOT NULL,
    readers TEXT[] NOT NULL DEFAULT '{}',
    expires_at TIMESTAMPTZ NOT NULL,
    source_run_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id,family,record_id),
    FOREIGN KEY (tenant_id,family,record_id) REFERENCES workspace_records(tenant_id,family,id),
    FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id),
    FOREIGN KEY (tenant_id,reviewer_id) REFERENCES users(tenant_id,id),
    FOREIGN KEY (tenant_id,source_run_id) REFERENCES runtime_runs(tenant_id,id)
);
CREATE TABLE platform_memberships (
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user','operator','admin')),
    persona_scopes TEXT[] NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('active','suspended')),
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id,user_id),
    FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id)
);
CREATE TABLE platform_audit (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    resource TEXT NOT NULL,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id,id),
    FOREIGN KEY (tenant_id,actor_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX platform_audit_history ON platform_audit(tenant_id,created_at DESC,id);
CREATE INDEX platform_evaluation_evidence ON platform_evaluations(tenant_id,definition_hash,created_at DESC);
ALTER TABLE platform_http_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_http_metrics FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_http_tenant ON platform_http_metrics USING (tenant_id=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
ALTER TABLE platform_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_datasets FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_datasets_tenant ON platform_datasets USING (tenant_id=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
ALTER TABLE platform_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_evaluations FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_evaluations_tenant ON platform_evaluations USING (tenant_id=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
ALTER TABLE platform_registry_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_registry_packages FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_packages_tenant ON platform_registry_packages USING (tenant_id=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
ALTER TABLE platform_registry_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_registry_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_versions_tenant ON platform_registry_versions USING (tenant_id=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
ALTER TABLE platform_record_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_record_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_records_tenant ON platform_record_reviews USING (tenant_id=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
ALTER TABLE platform_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_memberships_tenant ON platform_memberships USING (tenant_id=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
ALTER TABLE platform_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_audit_tenant ON platform_audit USING (tenant_id=current_setting('app.tenant_id',true)) WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
