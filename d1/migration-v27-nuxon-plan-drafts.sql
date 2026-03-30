INSERT INTO schema_version (version) VALUES (27);

CREATE TABLE IF NOT EXISTS nuxon_plan_drafts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  created_by TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  target TEXT NOT NULL,
  normalized_intent_json TEXT NOT NULL,
  capability_report_json TEXT NOT NULL,
  strategy_decision_json TEXT NOT NULL,
  artifacts_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nuxon_plan_drafts_tenant_created
  ON nuxon_plan_drafts(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nuxon_plan_drafts_status_created
  ON nuxon_plan_drafts(status, created_at DESC);
