INSERT INTO schema_version (version) VALUES (26);

CREATE TABLE IF NOT EXISTS nuxon_runner_sessions (
  runner_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  tool TEXT NOT NULL DEFAULT 'custom_tool',
  runtime TEXT NOT NULL DEFAULT 'desktop',
  interaction_mode TEXT NOT NULL DEFAULT 'watch',
  install_method TEXT NOT NULL DEFAULT 'file_bundle',
  permissions_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'waiting_for_connection',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  connected_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_heartbeat_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_nuxon_runner_sessions_lookup
  ON nuxon_runner_sessions(tool, runtime, updated_at DESC);
