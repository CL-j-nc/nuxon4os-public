-- ==========================================================================
-- Nuxon 4 OS — Migration v23: Native Semantic Continuity MVP
--
-- Purpose:
--   Canonical continuity layer across agents, sessions, tasks, semantic state,
--   repo handoff state, and live runtime reconciliation.
--
-- Design:
--   - continuity_threads  = canonical thread-level state
--   - continuity_entries  = append-only handoff / decision / reconcile log
--   - continuity_bindings = task / topic / agent / session / subject bindings
-- ==========================================================================

INSERT INTO schema_version (version) VALUES (23);

CREATE TABLE IF NOT EXISTS continuity_threads (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL DEFAULT 'default',
  continuity_key        TEXT,
  title                 TEXT,
  status                TEXT NOT NULL DEFAULT 'active',
  latest_handoff        TEXT NOT NULL DEFAULT '{}',
  semantic_state_json   TEXT NOT NULL DEFAULT '{}',
  runtime_state_json    TEXT NOT NULL DEFAULT '{}',
  repo_state_json       TEXT NOT NULL DEFAULT '{}',
  task_state_json       TEXT NOT NULL DEFAULT '{}',
  decision_state_json   TEXT NOT NULL DEFAULT '{}',
  source_of_truth_json  TEXT NOT NULL DEFAULT '{}',
  conflict_state_json   TEXT NOT NULL DEFAULT '{"status":"clear","items":[]}',
  last_reconciled_at    INTEGER,
  created_by            TEXT,
  updated_by            TEXT,
  created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at            INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_continuity_threads_tenant_key
  ON continuity_threads(tenant_id, continuity_key);
CREATE INDEX IF NOT EXISTS idx_continuity_threads_tenant_status
  ON continuity_threads(tenant_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS continuity_entries (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  thread_id     TEXT NOT NULL,
  tenant_id     TEXT NOT NULL DEFAULT 'default',
  entry_type    TEXT NOT NULL,
  actor_kind    TEXT NOT NULL DEFAULT 'system',
  actor_id      TEXT,
  source_ref    TEXT,
  summary       TEXT,
  payload_json  TEXT NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (thread_id) REFERENCES continuity_threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_continuity_entries_thread
  ON continuity_entries(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_continuity_entries_tenant_type
  ON continuity_entries(tenant_id, entry_type, created_at DESC);

CREATE TABLE IF NOT EXISTS continuity_bindings (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  thread_id      TEXT NOT NULL,
  tenant_id      TEXT NOT NULL DEFAULT 'default',
  binding_type   TEXT NOT NULL,
  binding_id     TEXT NOT NULL,
  role           TEXT,
  state_json     TEXT NOT NULL DEFAULT '{}',
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (thread_id) REFERENCES continuity_threads(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_continuity_bindings_unique
  ON continuity_bindings(tenant_id, thread_id, binding_type, binding_id);
CREATE INDEX IF NOT EXISTS idx_continuity_bindings_lookup
  ON continuity_bindings(tenant_id, binding_type, binding_id, updated_at DESC);
