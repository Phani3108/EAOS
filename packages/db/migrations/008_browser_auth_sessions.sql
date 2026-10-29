CREATE TABLE IF NOT EXISTS browser_auth_sessions (
  id TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_browser_sessions_expiry ON browser_auth_sessions ((data->>'expiresAt'));
