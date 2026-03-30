INSERT INTO schema_version (version) VALUES (29);

CREATE TABLE IF NOT EXISTS nuxon_plan_registrations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  source_draft_id TEXT NOT NULL UNIQUE,
  registration_type TEXT NOT NULL,
  status TEXT NOT NULL,
  created_by TEXT,
  approved_by TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nuxon_plan_registrations_tenant_created
  ON nuxon_plan_registrations(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nuxon_plan_registrations_status_created
  ON nuxon_plan_registrations(status, created_at DESC);
