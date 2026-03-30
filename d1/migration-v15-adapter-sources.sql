-- Migration v15: Adapter Sources — universal tool integration config
-- Stores adapter configurations in D1 so Dashboard can manage them
-- universal-adapter.py fetches config from API instead of local YAML

CREATE TABLE IF NOT EXISTS adapter_sources (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  tenant_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  mode        TEXT NOT NULL DEFAULT 'poll',    -- 'watch' | 'poll' | 'webhook'
  enabled     INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL DEFAULT '{}',      -- mode-specific config
  event_type  TEXT NOT NULL DEFAULT 'activity',
  throttle_sec INTEGER NOT NULL DEFAULT 30,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_adapter_sources_tenant ON adapter_sources(tenant_id, enabled);
CREATE UNIQUE INDEX IF NOT EXISTS idx_adapter_sources_name ON adapter_sources(tenant_id, name);

INSERT OR REPLACE INTO schema_version (version, applied_at)
VALUES (15, datetime('now'));
