ALTER TABLE runtime_deliveries ADD COLUMN execution_run_id TEXT;
ALTER TABLE runtime_deliveries ADD CONSTRAINT delivery_execution_scope FOREIGN KEY (tenant_id,execution_run_id) REFERENCES runtime_runs(tenant_id,id);
CREATE INDEX delivery_execution_history ON runtime_deliveries(tenant_id,user_id,execution_run_id);
