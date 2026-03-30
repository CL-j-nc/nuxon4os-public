INSERT INTO schema_version (version) VALUES (28);

CREATE TABLE IF NOT EXISTS nuxon_plan_draft_events (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  actor_id TEXT,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  event_payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nuxon_plan_draft_events_draft_created
  ON nuxon_plan_draft_events(draft_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nuxon_plan_draft_events_tenant_created
  ON nuxon_plan_draft_events(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nuxon_plan_draft_events_type_created
  ON nuxon_plan_draft_events(event_type, created_at DESC);
