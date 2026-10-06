CREATE TABLE IF NOT EXISTS deployment_identity (
  id TEXT PRIMARY KEY CHECK (id = 'singleton'),
  tenant_id TEXT NOT NULL
);
