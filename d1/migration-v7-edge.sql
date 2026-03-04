-- Nuxon 4 OS – Edge Gateway Schema
-- (c) 2024-2026 CL-j-nc, BSL 1.1
-- Migration v7: Edge agent management tables

-- edge_agents: registered edge agents
CREATE TABLE IF NOT EXISTS edge_agents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  agent_key_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offline' CHECK(status IN ('online', 'offline', 'error')),
  meta_json TEXT DEFAULT '{}',
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_edge_agents_tenant ON edge_agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_edge_agents_status ON edge_agents(status);

-- edge_tasks: tasks dispatched to edge agents
CREATE TABLE IF NOT EXISTS edge_tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'connector.run',
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'succeeded', 'failed')),
  result_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (agent_id) REFERENCES edge_agents(id)
);
CREATE INDEX IF NOT EXISTS idx_edge_tasks_agent ON edge_tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_edge_tasks_status ON edge_tasks(status);

-- edge_enroll_tokens: one-time enrollment tokens
CREATE TABLE IF NOT EXISTS edge_enroll_tokens (
  token TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by_agent TEXT
);
