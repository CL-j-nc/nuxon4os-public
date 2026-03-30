-- Migration v16: Commands table (instruction-only persistence)
-- Chat messages no longer stored in D1 — they live in ChatSessionDO (hot/warm) and R2 (cold)
-- Only commands (user instructions with business value) are persisted in D1 for audit trail

CREATE TABLE IF NOT EXISTS commands (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  command       TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'dashboard',
  status        TEXT NOT NULL DEFAULT 'pending',
  result        TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_commands_tenant ON commands(tenant_id);
CREATE INDEX IF NOT EXISTS idx_commands_status ON commands(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_commands_created ON commands(tenant_id, created_at DESC);

-- Record schema version
INSERT INTO schema_version (version, applied_at) VALUES (16, datetime('now'));
