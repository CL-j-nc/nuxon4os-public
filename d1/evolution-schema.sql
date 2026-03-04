-- CloudBrain — AI Organization Operating Console
-- Copyright (c) 2024-2026 CL-j-nc. All Rights Reserved.
-- Licensed under the Business Source License 1.1 (BSL). See LICENSE file.

-- ═══════════════════════════════════════════════════════════
-- Evolution Schema: ai_learned_rules with Promotion Pipeline
-- ═══════════════════════════════════════════════════════════

-- Drop old table if migrating (backup first!)
-- DROP TABLE IF EXISTS ai_learned_rules;

CREATE TABLE IF NOT EXISTS ai_learned_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  source TEXT NOT NULL,
  event_type TEXT DEFAULT '*',
  action TEXT NOT NULL,              -- execute | ignore | defer | notify
  target TEXT,
  confidence REAL DEFAULT 0.0,
  plan TEXT DEFAULT '[]',
  reason TEXT,

  -- Evolution metadata
  origin TEXT DEFAULT 'ai_evolution', -- ai_evolution | manual | imported
  learned_from INTEGER DEFAULT 0,     -- number of AI decisions this was learned from
  success_rate REAL DEFAULT 0.0,

  -- Promotion Pipeline: proposal → approved → active → disabled
  status TEXT DEFAULT 'proposal',
  promoted_at INTEGER,                -- timestamp when promoted to active
  promoted_by TEXT,                   -- 'auto' or user_id

  -- Stats
  hit_count INTEGER DEFAULT 0,        -- times this rule fired in production
  last_hit_at INTEGER,
  tokens_saved INTEGER DEFAULT 0,     -- estimated tokens saved by this rule

  -- Timestamps
  created_at INTEGER NOT NULL,
  updated_at INTEGER,

  -- Active flag for backward compat (derived from status)
  active INTEGER GENERATED ALWAYS AS (CASE WHEN status = 'active' THEN 1 ELSE 0 END) STORED
);

CREATE INDEX IF NOT EXISTS idx_lr_tenant ON ai_learned_rules(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_lr_source ON ai_learned_rules(source, event_type, status);
CREATE INDEX IF NOT EXISTS idx_lr_status ON ai_learned_rules(status);
CREATE INDEX IF NOT EXISTS idx_lr_origin ON ai_learned_rules(origin);

-- ═══════════════════════════════════════════════════════════
-- Evolution Log: track every evolution run
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS evolution_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT,
  run_at INTEGER NOT NULL,
  proposals_created INTEGER DEFAULT 0,
  rules_promoted INTEGER DEFAULT 0,
  rules_disabled INTEGER DEFAULT 0,
  high_failure_count INTEGER DEFAULT 0,
  high_token_count INTEGER DEFAULT 0,
  summary_json TEXT,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_elog_tenant ON evolution_log(tenant_id, run_at);
