-- migration-v21-patent-alignment.sql
-- Patent alignment: Agent hierarchy (P03) + Decision cache (P10) + Model registry (P04) + Event priority (P09) + Event correlations (P09) + Workflow DAG (P06)

-- Phase 1: Agent Hierarchy (P03)
ALTER TABLE agents ADD COLUMN parent_agent_id TEXT;
ALTER TABLE agents ADD COLUMN hierarchy_level INTEGER NOT NULL DEFAULT 3;
ALTER TABLE agents ADD COLUMN permission_scope TEXT DEFAULT '{}';
ALTER TABLE agents ADD COLUMN delegation_chain TEXT DEFAULT '[]';
CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents(tenant_id, parent_agent_id);
CREATE INDEX IF NOT EXISTS idx_agents_level ON agents(tenant_id, hierarchy_level);

-- Phase 2: Decision Cache (P10)
CREATE TABLE IF NOT EXISTS decision_cache (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  tenant_id TEXT NOT NULL DEFAULT 'default',
  fingerprint TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source TEXT,
  decision_action TEXT NOT NULL,
  decision_target TEXT,
  decision_confidence REAL,
  decision_reason TEXT,
  model_used TEXT,
  hit_count INTEGER NOT NULL DEFAULT 0,
  ttl_seconds INTEGER NOT NULL DEFAULT 300,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_decision_cache_fp ON decision_cache(tenant_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_decision_cache_expires ON decision_cache(expires_at);

-- Phase 3: Model Registry (P04)
CREATE TABLE IF NOT EXISTS model_registry (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  tenant_id TEXT NOT NULL DEFAULT 'system',
  model_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  endpoint_url TEXT,
  cf_model_id TEXT,
  tier TEXT NOT NULL DEFAULT 'free',
  max_context_tokens INTEGER DEFAULT 4096,
  cost_per_input_token REAL DEFAULT 0,
  cost_per_output_token REAL DEFAULT 0,
  latency_p50_ms INTEGER,
  latency_p99_ms INTEGER,
  success_rate REAL DEFAULT 1.0,
  capabilities TEXT DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  priority_weight REAL DEFAULT 1.0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_model_registry_name ON model_registry(model_name);
CREATE INDEX IF NOT EXISTS idx_model_registry_tier ON model_registry(tier, status);

-- Seed default models
INSERT OR IGNORE INTO model_registry (id, model_name, provider, cf_model_id, tier, max_context_tokens, cost_per_input_token, cost_per_output_token, latency_p50_ms, success_rate, capabilities, priority_weight)
VALUES
  ('m_llama70b', 'llama-3.3-70b', 'workers-ai', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'free', 4096, 0, 0, 200, 0.95, '["chat","reasoning"]', 1.0),
  ('m_qwen30b', 'qwen3-30b', 'workers-ai', '@cf/qwen/qwen3-30b-a3b-fp8', 'free', 4096, 0, 0, 250, 0.93, '["chat","reasoning"]', 0.9),
  ('m_gpt4omini', 'gpt-4o-mini', 'openai', NULL, 'cheap', 128000, 0.00015, 0.0006, 500, 0.98, '["chat","reasoning","coding"]', 1.2),
  ('m_gpt4o', 'gpt-4o', 'openai', NULL, 'strong', 128000, 0.0025, 0.01, 800, 0.99, '["chat","reasoning","coding","analysis"]', 1.5);

-- Phase 4: Event Priority + Correlation (P09)
ALTER TABLE events ADD COLUMN priority INTEGER NOT NULL DEFAULT 2;
CREATE INDEX IF NOT EXISTS idx_events_priority ON events(tenant_id, priority, created_at);

CREATE TABLE IF NOT EXISTS event_correlations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  tenant_id TEXT NOT NULL DEFAULT 'default',
  source_event_id TEXT NOT NULL,
  target_event_id TEXT NOT NULL,
  correlation_type TEXT NOT NULL,
  strength REAL NOT NULL DEFAULT 0.5,
  metadata TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_event_corr_source ON event_correlations(tenant_id, source_event_id);
CREATE INDEX IF NOT EXISTS idx_event_corr_target ON event_correlations(tenant_id, target_event_id);
CREATE INDEX IF NOT EXISTS idx_event_corr_type ON event_correlations(tenant_id, correlation_type);

-- Phase 5: Workflow DAG (P06)
ALTER TABLE execution_ledger ADD COLUMN step_dependencies TEXT DEFAULT '[]';
ALTER TABLE execution_ledger ADD COLUMN step_index INTEGER DEFAULT 0;
ALTER TABLE execution_ledger ADD COLUMN parallel_group TEXT;

-- Phase 6: Rule EMA scoring (P02)
ALTER TABLE ai_learned_rules ADD COLUMN ema_score REAL DEFAULT 0.5;
ALTER TABLE ai_learned_rules ADD COLUMN ema_precision REAL DEFAULT 0.5;
ALTER TABLE ai_learned_rules ADD COLUMN ema_recall REAL DEFAULT 0.5;
ALTER TABLE ai_learned_rules ADD COLUMN traffic_split_pct REAL DEFAULT 0;
ALTER TABLE ai_learned_rules ADD COLUMN ab_test_id TEXT;

-- Schema version
INSERT INTO schema_version (version) VALUES (21);
