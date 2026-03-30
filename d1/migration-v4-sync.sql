-- Migration v4: Cross-AI sync snapshots
-- Enables Claude Code ↔ ChatGPT progress sharing through Nuxon 4 OS pipeline

CREATE TABLE IF NOT EXISTS sync_snapshots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  agent TEXT NOT NULL,           -- 'claude-code', 'chatgpt', 'cursor', etc.
  type TEXT DEFAULT 'progress',  -- 'progress', 'architecture', 'task', 'handoff'
  summary TEXT NOT NULL,         -- human-readable summary
  data TEXT DEFAULT '{}',        -- JSON payload with structured details
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_tenant_agent ON sync_snapshots(tenant_id, agent, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_tenant_time ON sync_snapshots(tenant_id, created_at DESC);
