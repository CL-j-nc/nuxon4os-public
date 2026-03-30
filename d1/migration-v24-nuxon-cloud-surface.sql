-- ==========================================================================
-- Nuxon 4 OS — Migration v24: Task OS Cloud Control Surface
--
-- Purpose:
--   Persist Task OS scaffold state in D1 so task-orchestrator and
--   conversation-surface can run inside Cloudflare Worker runtime without
--   depending on the local filesystem bridge.
-- ==========================================================================

INSERT INTO schema_version (version) VALUES (24);

CREATE TABLE IF NOT EXISTS nuxon_task_runtime (
  task_id           TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL DEFAULT 'default',
  input_text        TEXT,
  summary           TEXT,
  status            TEXT NOT NULL DEFAULT 'queued',
  task_json         TEXT NOT NULL DEFAULT '{}',
  connection_json   TEXT NOT NULL DEFAULT '{}',
  handshake_json    TEXT NOT NULL DEFAULT '{}',
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_nuxon_task_runtime_status_updated
  ON nuxon_task_runtime(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS nuxon_task_runtime_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id           TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  event_source      TEXT NOT NULL DEFAULT 'unknown',
  payload_json      TEXT NOT NULL DEFAULT '{}',
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (task_id) REFERENCES nuxon_task_runtime(task_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nuxon_task_runtime_events_task_time
  ON nuxon_task_runtime_events(task_id, created_at ASC, id ASC);
