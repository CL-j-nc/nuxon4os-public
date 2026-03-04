-- Nuxon 4 OS — Universal Connector Architecture
-- Migration v6: Connector Registry + Adapter + Standard Event
-- Copyright (c) 2024-2026 CL-j-nc. All Rights Reserved.

-- ============================================================
-- 1. Connectors — HOW the system connects to external systems
-- ============================================================
CREATE TABLE IF NOT EXISTS connectors (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('push', 'pull')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'error', 'disabled')),
  endpoint TEXT,                          -- URL for pull; webhook path for push
  auth_json TEXT DEFAULT '{}',            -- encrypted auth config (api_key, oauth, header, etc.)
  schedule TEXT,                          -- cron expression for pull connectors
  cursor_json TEXT DEFAULT '{}',          -- cursor strategy config
  adapter_id TEXT,                        -- FK to adapters.id
  retry_max INTEGER DEFAULT 3,
  retry_delay_ms INTEGER DEFAULT 1000,
  rate_limit_rpm INTEGER DEFAULT 60,      -- requests per minute
  description TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (adapter_id) REFERENCES adapters(id)
);

CREATE INDEX IF NOT EXISTS idx_connectors_tenant ON connectors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_connectors_mode ON connectors(mode);
CREATE INDEX IF NOT EXISTS idx_connectors_status ON connectors(status);

-- ============================================================
-- 2. Adapters — HOW raw data is transformed into Standard Events
-- ============================================================
CREATE TABLE IF NOT EXISTS adapters (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  source TEXT NOT NULL,                   -- logical source name (e.g. 'sap-erp', 'stripe', 'github')
  spec_json TEXT NOT NULL DEFAULT '{}',   -- adapter specification (field mappings, transforms)
  version INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_adapters_tenant ON adapters(tenant_id);
CREATE INDEX IF NOT EXISTS idx_adapters_source ON adapters(source);

-- ============================================================
-- 3. Connector State — runtime state for pull connectors
-- ============================================================
CREATE TABLE IF NOT EXISTS connector_state (
  connector_id TEXT PRIMARY KEY,
  cursor TEXT,                            -- last cursor position (opaque string)
  last_success_at INTEGER,
  last_error TEXT,
  consecutive_errors INTEGER DEFAULT 0,
  FOREIGN KEY (connector_id) REFERENCES connectors(id) ON DELETE CASCADE
);

-- ============================================================
-- 4. Connector Runs — execution audit log
-- ============================================================
CREATE TABLE IF NOT EXISTS connector_runs (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'success', 'error')),
  fetched_count INTEGER DEFAULT 0,
  emitted_count INTEGER DEFAULT 0,
  error TEXT,
  cursor_before TEXT,
  cursor_after TEXT,
  FOREIGN KEY (connector_id) REFERENCES connectors(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_connector_runs_connector ON connector_runs(connector_id);
CREATE INDEX IF NOT EXISTS idx_connector_runs_started ON connector_runs(started_at);

-- ============================================================
-- 5. Upgrade events table — add Standard Event fields
-- ============================================================
-- Note: D1 ALTER TABLE only supports ADD COLUMN, not MODIFY.
-- These are additive and backward-compatible.

ALTER TABLE events ADD COLUMN tenant_id TEXT DEFAULT 'default';
ALTER TABLE events ADD COLUMN type TEXT;
ALTER TABLE events ADD COLUMN subject TEXT;
ALTER TABLE events ADD COLUMN trace_id TEXT;
ALTER TABLE events ADD COLUMN occurred_at INTEGER;
ALTER TABLE events ADD COLUMN connector_id TEXT;
ALTER TABLE events ADD COLUMN schema_version TEXT DEFAULT '3.0';

CREATE INDEX IF NOT EXISTS idx_events_tenant ON events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_trace ON events(trace_id);
