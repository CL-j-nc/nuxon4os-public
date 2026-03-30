-- ⚠️ DEPRECATED — Use d1/000-bootstrap.sql instead
-- This standalone file is superseded by the unified bootstrap schema.
-- Kept for reference only. Do NOT run directly.
--
-- Nuxon 4 OS — AI Organization Operating Console
-- Copyright (c) 2024-2026 CL-j-nc. All Rights Reserved.
-- Licensed under the Business Source License 1.1 (BSL). See LICENSE file.

-- ═══════════════════════════════════════
-- Observer Schema: sensor_events + proposals
-- ═══════════════════════════════════════

-- Full-fidelity sensor events (Event Identity Schema)
CREATE TABLE IF NOT EXISTS sensor_events (
  event_id TEXT PRIMARY KEY,
  trace_id TEXT,
  span_id TEXT,
  parent_span_id TEXT,
  task_id TEXT,
  run_id TEXT,
  source TEXT NOT NULL,
  agent_id TEXT,
  sensor_id TEXT,
  env TEXT DEFAULT 'production',
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  stage TEXT,
  status TEXT,
  progress REAL,
  payload_json TEXT,
  metrics_json TEXT,
  error_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_se_source ON sensor_events(source);
CREATE INDEX IF NOT EXISTS idx_se_type ON sensor_events(type);
CREATE INDEX IF NOT EXISTS idx_se_ts ON sensor_events(ts);
CREATE INDEX IF NOT EXISTS idx_se_stage ON sensor_events(stage);
CREATE INDEX IF NOT EXISTS idx_se_trace ON sensor_events(trace_id);

-- Observer proposals
CREATE TABLE IF NOT EXISTS proposals (
  proposal_id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,
  summary TEXT,
  data_json TEXT,
  status TEXT DEFAULT 'new'
);

CREATE INDEX IF NOT EXISTS idx_prop_kind ON proposals(kind);
CREATE INDEX IF NOT EXISTS idx_prop_status ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_prop_ts ON proposals(ts);
