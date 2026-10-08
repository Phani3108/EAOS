-- Schedule templates stored the legacy scheduler's log-wait `timeout` (UI default
-- 120 s) as timeoutMs, the hard deadline of every durable attempt, so scheduled
-- multi-step runs failed where /api/execute succeeded. Nothing else writes that
-- key into a schedule template, so it is dropped and the runtime default applies.
DO $$
DECLARE tenant TEXT;
BEGIN
    FOR tenant IN SELECT id FROM tenants LOOP
        -- runtime_schedules forces row-level security, so each tenant's rows are updated under that tenant's scope.
        PERFORM set_config('app.tenant_id', tenant, true);
        UPDATE runtime_schedules SET data = data #- '{template,payload,timeoutMs}' WHERE tenant_id = tenant AND data #> '{template,payload}' ? 'timeoutMs';
    END LOOP;
    PERFORM set_config('app.tenant_id', '', true);
END $$;
