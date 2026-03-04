-- Migration v5: Autonomous Runtime tables
-- Supports deterministic execution, KPI tracking, memory versioning, and bounded evolution

-- ── Execution Ledger ──
-- Every execution is recorded for idempotency, audit, and rollback
CREATE TABLE IF NOT EXISTS execution_ledger (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  idempotency_key TEXT,
  rollback_id TEXT,
  causation_event_id TEXT,
  action_type TEXT NOT NULL,
  action_target TEXT,
  action_schema TEXT DEFAULT '{}',    -- JSON: the full action request
  policy_result TEXT DEFAULT 'none',  -- 'approved', 'blocked', 'none'
  status TEXT DEFAULT 'requested',    -- 'requested', 'started', 'completed', 'failed', 'rolled_back'
  steps_json TEXT DEFAULT '[]',       -- JSON: execution step log
  error TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_idempotency ON execution_ledger(tenant_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_ledger_tenant_status ON execution_ledger(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_rollback ON execution_ledger(rollback_id);

-- ── KPI Metrics ──
-- Hourly snapshots of 5 standard runtime KPIs
CREATE TABLE IF NOT EXISTS kpi_metrics (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  metric TEXT NOT NULL,         -- 'execution_success_rate', 'rollback_rate', 'human_override_rate', 'avg_latency_ms', 'token_cost_per_event'
  value REAL NOT NULL,
  period TEXT DEFAULT 'hourly', -- 'hourly', 'daily'
  period_start INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kpi_tenant_metric ON kpi_metrics(tenant_id, metric, period_start DESC);

-- ── Memory Snapshots ──
-- Version control for agent memory state
CREATE TABLE IF NOT EXISTS memory_snapshots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  diff_json TEXT DEFAULT '{}',
  trigger TEXT DEFAULT 'manual', -- 'manual', 'evolution', 'rollback', 'scheduled'
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_version ON memory_snapshots(tenant_id, agent_id, version);
CREATE INDEX IF NOT EXISTS idx_memory_latest ON memory_snapshots(tenant_id, agent_id, created_at DESC);

-- ── Action Allowlist ──
-- Whitelist of permitted actions; anything not listed is forbidden
CREATE TABLE IF NOT EXISTS action_allowlist (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT DEFAULT '*',
  risk_category TEXT DEFAULT 'low',    -- 'low', 'medium', 'high', 'forbidden'
  max_frequency INTEGER DEFAULT 100,   -- max per hour
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_allowlist_action ON action_allowlist(tenant_id, action, target);

-- ── Evolution Scope ──
-- Bounds what evolution can change per run
CREATE TABLE IF NOT EXISTS evolution_scope (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL UNIQUE,    -- 'route_optimization', 'model_selection', 'retry_strategy', 'memory_pruning'
  max_change_per_run INTEGER DEFAULT 3,
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- Seed evolution scopes
INSERT OR IGNORE INTO evolution_scope (id, scope_type, max_change_per_run, enabled, created_at) VALUES
  ('es-1', 'route_optimization', 5, 1, unixepoch() * 1000),
  ('es-2', 'model_selection', 2, 1, unixepoch() * 1000),
  ('es-3', 'retry_strategy', 3, 1, unixepoch() * 1000),
  ('es-4', 'memory_pruning', 3, 1, unixepoch() * 1000);

-- Seed forbidden action categories (global, tenant_id = '*')
INSERT OR IGNORE INTO action_allowlist (id, tenant_id, action, target, risk_category, max_frequency, enabled, created_at) VALUES
  ('fa-1', '*', 'auth.modify', '*', 'forbidden', 0, 0, unixepoch() * 1000),
  ('fa-2', '*', 'payment.process', '*', 'forbidden', 0, 0, unixepoch() * 1000),
  ('fa-3', '*', 'infra.destroy', '*', 'forbidden', 0, 0, unixepoch() * 1000),
  ('fa-4', '*', 'deploy.production', '*', 'forbidden', 0, 0, unixepoch() * 1000);
