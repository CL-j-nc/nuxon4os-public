-- ==========================================================================
-- Nuxon 4 OS — Migration v19: Connector Ecosystem Upgrade
--
-- Phase: Connector/Adapter consolidation
-- Changes: 5 new tables + 4 ALTER TABLE patches
-- All tables include tenant_id for multi-tenant isolation (Constitution §5)
--
-- WARNING: ALTER TABLE ADD COLUMN statements below are NOT re-runnable.
-- SQLite does not support ADD COLUMN IF NOT EXISTS.
-- migrate.sh guards against re-execution by checking schema_version.
-- Do NOT run this file manually if version 19 is already recorded.
-- ==========================================================================

-- ── Version guard ──
INSERT OR IGNORE INTO schema_version (version) VALUES (19);

-- ==========================================================================
-- 1. adapters_v2 — Standalone reusable adapter specs
--    Replaces the old 1:N adapters tied to connectors
-- ==========================================================================
CREATE TABLE IF NOT EXISTS adapters_v2 (
  id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  tenant_id                TEXT NOT NULL,
  source                   TEXT NOT NULL,
  spec_json                TEXT NOT NULL DEFAULT '{}',
  version                  INTEGER NOT NULL DEFAULT 1,
  name                     TEXT NOT NULL,
  description              TEXT,
  marketplace_connector_id TEXT,
  created_at               INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at               INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (marketplace_connector_id) REFERENCES marketplace_connectors(id)
);

CREATE INDEX IF NOT EXISTS idx_adapters_v2_tenant ON adapters_v2(tenant_id);
CREATE INDEX IF NOT EXISTS idx_adapters_v2_source ON adapters_v2(source);
CREATE INDEX IF NOT EXISTS idx_adapters_v2_marketplace ON adapters_v2(marketplace_connector_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_adapters_v2_tenant_source_ver ON adapters_v2(tenant_id, source, version);

-- ==========================================================================
-- 2. connector_templates — Metadata for one-click marketplace installs
--    NOTE: No tenant_id column — intentionally exempt from Constitution §5.
--    Templates are system-level marketplace resources shared across all tenants.
--    Tenant scoping occurs at instantiation time (installed_connectors, connectors, adapters_v2).
-- ==========================================================================
CREATE TABLE IF NOT EXISTS connector_templates (
  id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  marketplace_connector_id TEXT NOT NULL UNIQUE,
  adapter_spec_json        TEXT NOT NULL DEFAULT '{}',
  required_auth_fields     TEXT NOT NULL DEFAULT '[]',
  required_config_fields   TEXT NOT NULL DEFAULT '[]',
  example_config_json      TEXT DEFAULT '{}',
  docs_url                 TEXT,
  created_at               INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at               INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (marketplace_connector_id) REFERENCES marketplace_connectors(id)
);

CREATE INDEX IF NOT EXISTS idx_connector_templates_mc ON connector_templates(marketplace_connector_id);

-- ==========================================================================
-- 3. connector_execution_context — Bridge: marketplace installed → operational
--    Links installed_connectors to operational connectors + adapters_v2
-- ==========================================================================
CREATE TABLE IF NOT EXISTS connector_execution_context (
  id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  tenant_id                TEXT NOT NULL,
  installed_connector_id   TEXT NOT NULL UNIQUE,
  operational_connector_id TEXT,
  adapter_id               TEXT,
  status                   TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'error', 'deleted')),
  error_log                TEXT,
  created_at               INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at               INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (installed_connector_id) REFERENCES installed_connectors(id),
  FOREIGN KEY (operational_connector_id) REFERENCES connectors(id),
  FOREIGN KEY (adapter_id) REFERENCES adapters_v2(id)
);

CREATE INDEX IF NOT EXISTS idx_exec_ctx_tenant ON connector_execution_context(tenant_id);
CREATE INDEX IF NOT EXISTS idx_exec_ctx_installed ON connector_execution_context(installed_connector_id);
CREATE INDEX IF NOT EXISTS idx_exec_ctx_operational ON connector_execution_context(operational_connector_id);
CREATE INDEX IF NOT EXISTS idx_exec_ctx_status ON connector_execution_context(tenant_id, status);

-- ==========================================================================
-- 4. connector_health — Monitoring snapshots
-- ==========================================================================
CREATE TABLE IF NOT EXISTS connector_health (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  connector_id      TEXT NOT NULL,
  tenant_id         TEXT NOT NULL,
  snapshot_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  success_rate      REAL,
  avg_latency_ms    REAL,
  error_rate        REAL,
  last_error        TEXT,
  consecutive_errors INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (connector_id) REFERENCES connectors(id)
);

CREATE INDEX IF NOT EXISTS idx_conn_health_tenant ON connector_health(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conn_health_connector ON connector_health(connector_id);
CREATE INDEX IF NOT EXISTS idx_conn_health_snapshot ON connector_health(tenant_id, snapshot_at);

-- ==========================================================================
-- 5. adapter_spec_cache — Parsed spec cache for runtime performance
--    NOTE: No tenant_id column — indirectly tenant-scoped via adapter_id FK
--    to adapters_v2 (which has tenant_id). Acceptable for a cache table;
--    tenant isolation is enforced at the adapters_v2 query layer.
-- ==========================================================================
CREATE TABLE IF NOT EXISTS adapter_spec_cache (
  adapter_id       TEXT PRIMARY KEY,
  parsed_spec      TEXT NOT NULL DEFAULT '{}',
  validation_ok    INTEGER NOT NULL DEFAULT 0,
  validation_error TEXT,
  cached_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at       INTEGER,
  FOREIGN KEY (adapter_id) REFERENCES adapters_v2(id) ON DELETE CASCADE
);

-- ==========================================================================
-- 6. ALTER connectors — Add adapter_v2_id column
--    Note: adapter_id already exists (FK to old adapters table from v6).
--    New column references the upgraded adapters_v2 table.
-- ==========================================================================
ALTER TABLE connectors ADD COLUMN adapter_v2_id TEXT REFERENCES adapters_v2(id);

-- ==========================================================================
-- 7. ALTER connector_state — Add circuit breaker + health fields
-- ==========================================================================
ALTER TABLE connector_state ADD COLUMN is_circuit_broken INTEGER NOT NULL DEFAULT 0;
ALTER TABLE connector_state ADD COLUMN health_score REAL;
ALTER TABLE connector_state ADD COLUMN last_cursor_at INTEGER;

-- ==========================================================================
-- 8. ALTER oauth_tokens — Link to installed connectors
-- ==========================================================================
ALTER TABLE oauth_tokens ADD COLUMN installed_connector_id TEXT REFERENCES installed_connectors(id);

-- ==========================================================================
-- 9. ALTER marketplace_connectors — Template + auto-install flags
-- ==========================================================================
ALTER TABLE marketplace_connectors ADD COLUMN is_template INTEGER NOT NULL DEFAULT 0;
ALTER TABLE marketplace_connectors ADD COLUMN auto_install_adapter INTEGER NOT NULL DEFAULT 0;

-- ==========================================================================
-- 10. ALTER adapter_sources — Deprecation flag
-- ==========================================================================
ALTER TABLE adapter_sources ADD COLUMN is_deprecated INTEGER NOT NULL DEFAULT 0;
