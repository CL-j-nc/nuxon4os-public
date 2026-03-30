-- ⚠️ DEPRECATED — Use d1/000-bootstrap.sql instead
-- This standalone file is superseded by the unified bootstrap schema.
-- Kept for reference only. Do NOT run directly.
--
-- Nuxon 4 OS — AI Organization Operating Console
-- Copyright (c) 2024-2026 CL-j-nc. All Rights Reserved.
-- Licensed under the Business Source License 1.1 (BSL). See LICENSE file.

-- ═══════════════════════════════════════════════════════════
-- Agent Hierarchy Schema v2
-- ═══════════════════════════════════════════════════════════

-- 1. agent_registry
CREATE TABLE IF NOT EXISTS agent_registry (
  agent_id TEXT PRIMARY KEY,
  tenant_id TEXT DEFAULT 'default',
  name TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'L1',   -- L1|L2|L3|L4
  status TEXT DEFAULT 'active',       -- active|degraded|retired
  health_score REAL DEFAULT 1.0,
  proposal_id INTEGER,
  worker_url TEXT,
  spec_json TEXT,
  created_at INTEGER NOT NULL,
  retired_at INTEGER,
  FOREIGN KEY (proposal_id) REFERENCES agent_spawn_proposals(id)
);
CREATE INDEX IF NOT EXISTS idx_ar_level ON agent_registry(level, status);
CREATE INDEX IF NOT EXISTS idx_ar_tenant ON agent_registry(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_ar_health ON agent_registry(health_score);

-- 2. Add fingerprint + level to agent_spawn_proposals
ALTER TABLE agent_spawn_proposals ADD COLUMN fingerprint TEXT;
ALTER TABLE agent_spawn_proposals ADD COLUMN agent_level TEXT DEFAULT 'L1';
CREATE UNIQUE INDEX IF NOT EXISTS idx_asp_fingerprint ON agent_spawn_proposals(fingerprint)
  WHERE status IN ('proposal','approved');

-- 3. agent_health_log (hourly snapshots)
CREATE TABLE IF NOT EXISTS agent_health_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  tenant_id TEXT DEFAULT 'default',
  success_rate REAL,
  total_events INTEGER DEFAULT 0,
  avg_latency_ms REAL,
  tokens_used INTEGER DEFAULT 0,
  health_score REAL,
  ts INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agent_registry(agent_id)
);
CREATE INDEX IF NOT EXISTS idx_ahl_agent ON agent_health_log(agent_id, ts);
