ALTER TABLE runtime_jobs ADD COLUMN deadline_at TIMESTAMPTZ;
CREATE INDEX runtime_jobs_deadline ON runtime_jobs(tenant_id,deadline_at) WHERE status='running';
