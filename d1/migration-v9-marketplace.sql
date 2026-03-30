-- Migration v9: Connector Marketplace
-- Phase 11: Dynamic connector ecosystem

CREATE TABLE IF NOT EXISTS marketplace_connectors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  version TEXT NOT NULL DEFAULT '1.0.0',
  author TEXT DEFAULT 'nuxon4os',
  icon TEXT,
  category TEXT DEFAULT 'integration',
  manifest_json TEXT NOT NULL,
  adapter_spec_json TEXT,
  event_schemas_json TEXT,
  downloads INTEGER DEFAULT 0,
  rating REAL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS installed_connectors (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  connector_id TEXT NOT NULL,
  config_json TEXT DEFAULT '{}',
  auth_json TEXT DEFAULT '{}',
  enabled INTEGER DEFAULT 1,
  installed_at INTEGER NOT NULL,
  updated_at INTEGER,
  FOREIGN KEY (connector_id) REFERENCES marketplace_connectors(id)
);

CREATE INDEX IF NOT EXISTS idx_installed_tenant ON installed_connectors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_installed_connector ON installed_connectors(connector_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_installed_unique ON installed_connectors(tenant_id, connector_id);

CREATE TABLE IF NOT EXISTS connector_event_schemas (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  schema_json TEXT NOT NULL,
  example_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (connector_id) REFERENCES marketplace_connectors(id)
);

CREATE INDEX IF NOT EXISTS idx_event_schema_connector ON connector_event_schemas(connector_id);
