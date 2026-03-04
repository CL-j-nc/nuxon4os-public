-- CloudBrain — AI Organization Operating Console
-- Copyright (c) 2024-2026 CL-j-nc. All Rights Reserved.
-- Licensed under the Business Source License 1.1 (BSL). See LICENSE file.

-- AI 决策记录
CREATE TABLE IF NOT EXISTS ai_decisions (
  id TEXT PRIMARY KEY,
  event_id TEXT,
  source TEXT,
  action TEXT,
  target TEXT,
  confidence REAL,
  reason TEXT,
  plan TEXT,
  result TEXT DEFAULT 'pending',
  feedback TEXT,
  created_at INTEGER,
  completed_at INTEGER
);

-- AI 记忆（长期）
CREATE TABLE IF NOT EXISTS ai_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT DEFAULT 'agent-001',
  category TEXT,
  key TEXT,
  value TEXT,
  score REAL,
  created_at INTEGER,
  expires_at INTEGER
);

-- 模型调用日志
CREATE TABLE IF NOT EXISTS ai_model_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  latency_ms INTEGER,
  success INTEGER,
  created_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_decisions_event ON ai_decisions(event_id);
CREATE INDEX IF NOT EXISTS idx_decisions_action ON ai_decisions(action);
CREATE INDEX IF NOT EXISTS idx_memory_agent ON ai_memory(agent_id, category);
CREATE INDEX IF NOT EXISTS idx_model_logs_model ON ai_model_logs(model);
