ALTER TABLE runtime_schedules ADD COLUMN archived_at TIMESTAMPTZ;
CREATE INDEX runtime_schedules_owner ON runtime_schedules(tenant_id,user_id,created_at DESC) WHERE archived_at IS NULL;
