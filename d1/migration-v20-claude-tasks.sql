-- ==========================================================================
-- Nuxon 4 OS — Migration v20: Claude Task Queue
--
-- Phase: Autonomous cloud-based Claude Code execution
-- Changes: 3 new tables (claude_tasks, claude_task_steps, claude_tool_configs)
-- All tables include tenant_id for multi-tenant isolation (Constitution §5)
--
-- Purpose: Task queue system that accepts instructions from Telegram,
-- Dashboard, API, or scheduled triggers, dispatches them to Claude Code,
-- and logs every tool call for auditability and cost tracking.
-- ==========================================================================

-- ── Version guard ──
INSERT OR IGNORE INTO schema_version (version) VALUES (20);

-- ==========================================================================
-- 1. claude_tasks — Task queue
--    Core table for queuing, executing, and tracking Claude Code tasks.
--    Status flow: queued → running → completed | failed | cancelled
-- ==========================================================================
CREATE TABLE IF NOT EXISTS claude_tasks (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  tenant_id         TEXT NOT NULL,
  command           TEXT NOT NULL,
  source            TEXT NOT NULL DEFAULT 'telegram' CHECK(source IN ('telegram', 'dashboard', 'api', 'scheduled')),
  source_message_id TEXT,
  status            TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  priority          INTEGER NOT NULL DEFAULT 5,
  context_json      TEXT DEFAULT '{}',
  result_json       TEXT DEFAULT '{}',
  error             TEXT,
  model             TEXT DEFAULT 'claude-sonnet-4-20250514',
  tokens_used       INTEGER DEFAULT 0,
  cost_cents        REAL DEFAULT 0,
  max_steps         INTEGER DEFAULT 20,
  steps_used        INTEGER DEFAULT 0,
  started_at        INTEGER,
  completed_at      INTEGER,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at        INTEGER
);

-- Queue polling: pick next task by status + priority
CREATE INDEX IF NOT EXISTS idx_claude_tasks_queue
  ON claude_tasks(tenant_id, status, priority, created_at);

-- Tenant isolation
CREATE INDEX IF NOT EXISTS idx_claude_tasks_tenant
  ON claude_tasks(tenant_id);

-- Source lookup (e.g. find task by telegram message_id for reply)
CREATE INDEX IF NOT EXISTS idx_claude_tasks_source
  ON claude_tasks(source, source_message_id);

-- Expiry cleanup
CREATE INDEX IF NOT EXISTS idx_claude_tasks_expires
  ON claude_tasks(status, expires_at);

-- ==========================================================================
-- 2. claude_task_steps — Execution log (each tool call)
--    Immutable audit trail of every action taken during task execution.
-- ==========================================================================
CREATE TABLE IF NOT EXISTS claude_task_steps (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  task_id       TEXT NOT NULL,
  tenant_id     TEXT NOT NULL,
  step_number   INTEGER NOT NULL,
  tool_name     TEXT NOT NULL,
  tool_input    TEXT,
  tool_output   TEXT,
  tokens_used   INTEGER DEFAULT 0,
  duration_ms   INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (task_id) REFERENCES claude_tasks(id) ON DELETE CASCADE
);

-- Steps by task (ordered replay)
CREATE INDEX IF NOT EXISTS idx_claude_task_steps_task
  ON claude_task_steps(task_id, step_number);

-- Tenant isolation
CREATE INDEX IF NOT EXISTS idx_claude_task_steps_tenant
  ON claude_task_steps(tenant_id);

-- Tool usage analytics
CREATE INDEX IF NOT EXISTS idx_claude_task_steps_tool
  ON claude_task_steps(tool_name, created_at);

-- ==========================================================================
-- 3. claude_tool_configs — Available tools and their configs
--    Registry of tools that Claude Code can invoke during task execution.
--    Enables per-tenant tool permissions and configuration.
-- ==========================================================================
CREATE TABLE IF NOT EXISTS claude_tool_configs (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  tenant_id     TEXT NOT NULL,
  tool_name     TEXT NOT NULL,
  description   TEXT,
  enabled       INTEGER DEFAULT 1,
  config_json   TEXT DEFAULT '{}',
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Tenant isolation
CREATE INDEX IF NOT EXISTS idx_claude_tool_configs_tenant
  ON claude_tool_configs(tenant_id);

-- Unique tool per tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_claude_tool_configs_tenant_tool
  ON claude_tool_configs(tenant_id, tool_name);
