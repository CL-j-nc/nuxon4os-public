INSERT INTO schema_version (version) VALUES (32);

CREATE TABLE IF NOT EXISTS content_packs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  industry TEXT NOT NULL,
  topic TEXT NOT NULL,
  style TEXT,
  duration_seconds INTEGER,
  title TEXT,
  hook TEXT,
  script_json TEXT NOT NULL DEFAULT '[]',
  shots_json TEXT NOT NULL DEFAULT '[]',
  hashtags_json TEXT NOT NULL DEFAULT '[]',
  cta TEXT,
  risk_flags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  source_input_json TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_packs_tenant_idempotency
  ON content_packs (tenant_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_content_packs_tenant_created
  ON content_packs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_packs_tenant_status_created
  ON content_packs (tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS content_pack_runs (
  id TEXT PRIMARY KEY,
  content_pack_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  status TEXT NOT NULL,
  generator_mode TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (content_pack_id) REFERENCES content_packs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_content_pack_runs_pack_created
  ON content_pack_runs (content_pack_id, created_at DESC);
