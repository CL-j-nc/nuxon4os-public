INSERT INTO schema_version (version) VALUES (31);

CREATE TABLE IF NOT EXISTS nuxon_runtime_preparations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  source_registration_id TEXT NOT NULL UNIQUE,
  source_draft_id TEXT NOT NULL,
  status TEXT NOT NULL,
  executor_type TEXT NOT NULL,
  preparation_payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  processed_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nuxon_runtime_preparations_tenant_created
  ON nuxon_runtime_preparations(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nuxon_runtime_preparations_status_created
  ON nuxon_runtime_preparations(status, created_at DESC);
