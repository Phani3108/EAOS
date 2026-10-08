-- The gateway's database login: a separate role that owns nothing.
--
-- Production refuses to run the gateway as the database owner, a superuser or a
-- BYPASSRLS role (verifyDeploymentStorage in services/gateway/src/server.ts):
-- row-level security does not apply to those, so tenant isolation would rest on
-- application code alone. Migrations run as the owner; the gateway runs as this
-- login, with only the privileges below.
--
-- deploy/docker-compose.production.yml runs this as the owner after every
-- migration run, so the grants follow the schema. It is idempotent: it creates the
-- login once, sets its password to EAOS_APP_DB_PASSWORD, and re-applies the grants.
-- For a database you provision yourself (psql 15 or newer):
--
--   EAOS_APP_DB_PASSWORD=... psql "<owner connection URL>" -v ON_ERROR_STOP=1 \
--     [-v app_role=<login name, default eaos_app>] -f deploy/postgres/app-role.sql
--
-- A table added by a new migration needs its grant added here as well; until it
-- is, the gateway's queries against that table fail with "permission denied".

\set ON_ERROR_STOP on
\if :{?app_role}
\else
  \set app_role eaos_app
\endif

\getenv app_password EAOS_APP_DB_PASSWORD
\if :{?app_password}
  SELECT length(:'app_password') >= 16 AS app_password_ok \gset
\else
  \set app_password_ok false
\endif
\if :app_password_ok
\else
  DO $$ BEGIN RAISE EXCEPTION 'Set EAOS_APP_DB_PASSWORD (16 characters or more) before provisioning the gateway login'; END $$;
\endif

-- The ALTER ROLE below strips privileges, so pointing app_role at the owner would
-- demote the account that runs migrations and still leave RLS bypassed.
SELECT :'app_role' = current_user OR EXISTS (
  SELECT FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba
  WHERE d.datname = current_database() AND r.rolname = :'app_role'
) AS app_role_is_owner \gset
\if :app_role_is_owner
  DO $$ BEGIN RAISE EXCEPTION 'The gateway login must be a separate role, not the database owner or the role running this script'; END $$;
\endif

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_role', :'app_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'app_role') \gexec
-- Re-asserted on every run, so a login altered by hand cannot keep an attribute
-- that bypasses row-level security.
ALTER ROLE :"app_role" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'app_password';

GRANT USAGE ON SCHEMA public TO :"app_role";
GRANT SELECT, INSERT, UPDATE ON tenants, users, setup_state, deployment_identity, browser_auth_sessions TO :"app_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON api_keys TO :"app_role";
GRANT SELECT, INSERT, UPDATE ON runtime_definitions, runtime_runs, runtime_jobs, runtime_steps, runtime_attempts, runtime_approvals, runtime_artifacts, runtime_events TO :"app_role";
GRANT SELECT, INSERT, UPDATE ON workspace_records, workspace_chat_sessions, workspace_chat_messages, workspace_connections TO :"app_role";
GRANT SELECT, INSERT, UPDATE ON runtime_usage_budgets, runtime_usage_reservations, runtime_step_attempts, runtime_artifact_parents, runtime_schedules, runtime_trigger_receipts, runtime_deliveries, runtime_agent_leases, runtime_children TO :"app_role";
GRANT SELECT, INSERT, UPDATE ON input_artifacts, runtime_input_artifacts, runtime_tool_receipts TO :"app_role";
GRANT SELECT, INSERT ON integration_audit, platform_audit, runtime_connector_observations TO :"app_role";
GRANT SELECT, INSERT, UPDATE ON platform_http_metrics, platform_datasets, platform_evaluations, platform_registry_packages, platform_registry_versions, platform_record_reviews, platform_memberships, platform_event_offsets TO :"app_role";
GRANT SELECT ON kv_store TO :"app_role";
GRANT SELECT, INSERT ON audit_log TO :"app_role";
GRANT EXECUTE ON FUNCTION authenticate_api_key(TEXT), touch_api_key(TEXT), runtime_ancestors_active(TEXT,TEXT), runtime_actor_active(TEXT,TEXT,JSONB) TO :"app_role";
