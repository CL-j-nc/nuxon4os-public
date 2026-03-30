-- ==========================================================================
-- Nuxon 4 OS — Migration v12: Integration Hub
--
-- Phase: Self-service integration layer
-- Changes: ALTER api_keys + 5 new tables
-- All tables include tenant_id for multi-tenant isolation (Constitution §5)
-- ==========================================================================

-- ── Version guard ──
INSERT OR IGNORE INTO schema_version (version) VALUES (12);

-- ==========================================================================
-- 1. Patch api_keys — add status + last_used_at
-- ==========================================================================
-- D1/SQLite ADD COLUMN is idempotent-safe (errors silently if col exists
-- when wrapped in a migration that only runs once via schema_version guard)

ALTER TABLE api_keys ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE api_keys ADD COLUMN last_used_at INTEGER;

-- ==========================================================================
-- 2. Tool Registry — every invocable capability in the platform
-- ==========================================================================
CREATE TABLE IF NOT EXISTS tool_registry (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_id         TEXT NOT NULL UNIQUE,                -- e.g. 'founder.summarize', 'connector.slack.post'
  display_name    TEXT NOT NULL,
  description     TEXT,
  mode            TEXT NOT NULL DEFAULT 'both',        -- input | output | both
  trigger_support TEXT NOT NULL DEFAULT '["manual"]',  -- JSON array: webhook, cron, manual
  required_scopes TEXT NOT NULL DEFAULT '[]',          -- JSON array of scope strings
  args_schema     TEXT NOT NULL DEFAULT '{}',          -- JSON Schema for Portal form generation
  handler_type    TEXT NOT NULL DEFAULT 'builtin',     -- builtin | service_binding | http | queue
  handler_config  TEXT NOT NULL DEFAULT '{}',          -- JSON: routing config for the handler
  category        TEXT NOT NULL DEFAULT 'custom',      -- ai, retrieval, productivity, communication, devops, payments, custom
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tool_registry_category ON tool_registry(category);
CREATE INDEX IF NOT EXISTS idx_tool_registry_mode ON tool_registry(mode);

-- ==========================================================================
-- 3. Integration Configs — saved integration graphs (input → route → output)
-- ==========================================================================
CREATE TABLE IF NOT EXISTS integration_configs (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  tenant_id       TEXT NOT NULL REFERENCES tenants(id),
  name            TEXT NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  config_json     TEXT NOT NULL DEFAULT '{}',          -- full integration graph
  enabled         INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_integration_configs_tenant ON integration_configs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_integration_configs_enabled ON integration_configs(tenant_id, enabled);

-- ==========================================================================
-- 4. Integration Logs — per-invocation audit trail
-- ==========================================================================
CREATE TABLE IF NOT EXISTS integration_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       TEXT NOT NULL,
  tool_id         TEXT NOT NULL,
  request_id      TEXT NOT NULL,
  direction       TEXT NOT NULL DEFAULT 'invoke',      -- invoke | ingest | schedule
  status          TEXT NOT NULL DEFAULT 'ok',          -- ok | error | timeout
  error_code      TEXT,
  error_message   TEXT,
  duration_ms     INTEGER,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_intlogs_tenant_time ON integration_logs(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_intlogs_request ON integration_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_intlogs_tool ON integration_logs(tenant_id, tool_id);

-- ==========================================================================
-- 5. Scheduled Triggers — cron-driven integration firing
-- ==========================================================================
CREATE TABLE IF NOT EXISTS scheduled_triggers (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  tenant_id       TEXT NOT NULL REFERENCES tenants(id),
  integration_id  TEXT NOT NULL REFERENCES integration_configs(id),
  input_id        TEXT NOT NULL,                       -- tool_id of the input node
  cron_expr       TEXT NOT NULL,                       -- e.g. '*/5 * * * *'
  timezone        TEXT NOT NULL DEFAULT 'UTC',
  last_run_at     INTEGER,
  next_run_at     INTEGER,
  status          TEXT NOT NULL DEFAULT 'active',      -- active | paused | deleted
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sched_tenant ON scheduled_triggers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sched_next_run ON scheduled_triggers(status, next_run_at);

-- ==========================================================================
-- 6. Async Jobs — long-running task tracking
-- ==========================================================================
CREATE TABLE IF NOT EXISTS async_jobs (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  tenant_id       TEXT NOT NULL REFERENCES tenants(id),
  type            TEXT NOT NULL,                       -- tool_invoke | batch_ingest | integration_run
  status          TEXT NOT NULL DEFAULT 'pending',     -- pending | running | completed | failed
  input_json      TEXT DEFAULT '{}',
  output_json     TEXT,
  error           TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_jobs_tenant ON async_jobs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON async_jobs(tenant_id, status);
