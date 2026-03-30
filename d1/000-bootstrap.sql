-- ==========================================================================
-- Nuxon 4 OS — Unified Bootstrap Schema (000-bootstrap.sql)
-- Replaces all standalone schema files + migration-v2
-- All tables include multi-tenant columns from the start
--
-- Generated: 2026-03-04
-- ==========================================================================

-- ── Schema version tracking ──
CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ==========================================================================
-- Core: Tenants & Auth (from dashboard-schema + v2)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS tenants (
  id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name           TEXT NOT NULL,
  plan           TEXT NOT NULL DEFAULT 'free',
  config_json    TEXT DEFAULT '{}',
  status         TEXT NOT NULL DEFAULT 'active',
  -- billing (from v3)
  stripe_customer_id   TEXT,
  stripe_subscription_id TEXT,
  billing_email        TEXT,
  plan_limit_calls     INTEGER NOT NULL DEFAULT 1000,
  plan_limit_tokens    INTEGER NOT NULL DEFAULT 100000,
  billing_period_start INTEGER,
  billing_period_end   INTEGER,
  --
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at     INTEGER
);

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  tenant_id   TEXT NOT NULL REFERENCES tenants(id),
  email       TEXT NOT NULL,
  name        TEXT,
  password_hash TEXT,
  role        TEXT NOT NULL DEFAULT 'viewer',
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_email ON users(tenant_id, email);

CREATE TABLE IF NOT EXISTS api_keys (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  tenant_id  TEXT NOT NULL REFERENCES tenants(id),
  name       TEXT,
  key_hash   TEXT NOT NULL UNIQUE,
  scopes     TEXT DEFAULT '[]',
  expires_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id),
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id),
  user_id    TEXT,
  action     TEXT NOT NULL,
  resource   TEXT,
  detail     TEXT,
  ip_address TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON audit_logs(tenant_id, created_at);

-- ==========================================================================
-- Core: Events (from schema.sql + v2 + v6)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS events (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  tenant_id       TEXT NOT NULL DEFAULT 'default',
  source          TEXT NOT NULL,
  env             TEXT NOT NULL DEFAULT 'production',
  type            TEXT,
  subject         TEXT,
  connector_id    TEXT,
  schema_version  TEXT DEFAULT '3.0',
  trace_id        TEXT,
  payload         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'received',
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_tenant ON events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_trace ON events(trace_id);

-- ==========================================================================
-- Multi-tenant: Agents, Connections, Rules (from v2)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS agents (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  name         TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'ai',
  config_json  TEXT DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_agents_tenant ON agents(tenant_id);

CREATE TABLE IF NOT EXISTS connections (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  name         TEXT NOT NULL,
  type         TEXT NOT NULL,
  config_json  TEXT DEFAULT '{}',
  auth_json    TEXT DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_connections_tenant ON connections(tenant_id);

CREATE TABLE IF NOT EXISTS user_rules (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  tenant_id    TEXT NOT NULL REFERENCES tenants(id),
  name         TEXT NOT NULL,
  description  TEXT,
  source       TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  conditions   TEXT NOT NULL DEFAULT '[]',
  action       TEXT NOT NULL,
  target       TEXT,
  priority     INTEGER NOT NULL DEFAULT 100,
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_user_rules_tenant ON user_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_rules_source_type ON user_rules(source, event_type);

-- ==========================================================================
-- AI: Decisions, Memory, Model Logs (from ai-schema + v2 + v10)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS ai_decisions (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  tenant_id   TEXT NOT NULL DEFAULT 'default',
  agent_id    TEXT,
  event_id    TEXT NOT NULL,
  source      TEXT NOT NULL,
  action      TEXT NOT NULL,
  target      TEXT,
  confidence  REAL,
  reason      TEXT,
  plan        TEXT,
  result      TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_event ON ai_decisions(event_id);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_source ON ai_decisions(source);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_action ON ai_decisions(action);
CREATE INDEX IF NOT EXISTS idx_ai_decisions_tenant ON ai_decisions(tenant_id);

CREATE TABLE IF NOT EXISTS ai_memory (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  tenant_id   TEXT NOT NULL DEFAULT 'default',
  agent_id    TEXT NOT NULL DEFAULT 'default',
  category    TEXT NOT NULL,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  score       REAL DEFAULT 0,
  expiry      INTEGER,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_memory_agent_key ON ai_memory(agent_id, category, key);
CREATE INDEX IF NOT EXISTS idx_ai_memory_category ON ai_memory(category);
CREATE INDEX IF NOT EXISTS idx_ai_memory_tenant ON ai_memory(tenant_id);

CREATE TABLE IF NOT EXISTS ai_model_logs (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  tenant_id       TEXT,
  agent_id        TEXT,
  model           TEXT NOT NULL,
  provider        TEXT,
  tokens_in       INTEGER,
  tokens_out      INTEGER,
  latency_ms      INTEGER,
  success         INTEGER DEFAULT 1,
  error_message   TEXT,
  attempt_number  INTEGER DEFAULT 1,
  request_id      TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ai_model_logs_model ON ai_model_logs(model);
CREATE INDEX IF NOT EXISTS idx_ai_model_logs_created ON ai_model_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_model_logs_tenant ON ai_model_logs(tenant_id);

-- ==========================================================================
-- Observer: Sensor Events & Proposals (from observer-schema + v2)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS sensor_events (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  tenant_id    TEXT NOT NULL DEFAULT 'default',
  trace_id     TEXT,
  span_id      TEXT,
  parent_span  TEXT,
  task_id      TEXT,
  run_id       TEXT,
  source       TEXT NOT NULL,
  type         TEXT NOT NULL,
  stage        TEXT,
  status       TEXT,
  progress     REAL,
  payload      TEXT,
  metrics      TEXT,
  error        TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_sensor_trace ON sensor_events(trace_id);
CREATE INDEX IF NOT EXISTS idx_sensor_task ON sensor_events(task_id);
CREATE INDEX IF NOT EXISTS idx_sensor_source_type ON sensor_events(source, type);
CREATE INDEX IF NOT EXISTS idx_sensor_created ON sensor_events(created_at);
CREATE INDEX IF NOT EXISTS idx_sensor_tenant ON sensor_events(tenant_id);

CREATE TABLE IF NOT EXISTS proposals (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  tenant_id    TEXT NOT NULL DEFAULT 'default',
  trace_id     TEXT,
  kind         TEXT NOT NULL,
  confidence   REAL,
  summary      TEXT,
  detail       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_tenant ON proposals(tenant_id);

-- ==========================================================================
-- Evolution: Learned Rules & Log (from evolution-schema)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS ai_learned_rules (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  source          TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  action          TEXT NOT NULL,
  target          TEXT,
  confidence      REAL NOT NULL DEFAULT 0.5,
  plan            TEXT,
  reason          TEXT,
  origin          TEXT NOT NULL DEFAULT 'ai',
  learned_from    TEXT,
  success_rate    REAL DEFAULT 0,
  hit_count       INTEGER DEFAULT 0,
  tokens_saved    INTEGER DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'proposal',
  promoted_at     INTEGER,
  disabled_at     INTEGER,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_learned_rules_source_type ON ai_learned_rules(source, event_type);
CREATE INDEX IF NOT EXISTS idx_learned_rules_status ON ai_learned_rules(status);

CREATE TABLE IF NOT EXISTS evolution_log (
  id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  run_at             INTEGER NOT NULL DEFAULT (unixepoch()),
  proposals_created  INTEGER DEFAULT 0,
  rules_promoted     INTEGER DEFAULT 0,
  rules_disabled     INTEGER DEFAULT 0,
  summary            TEXT
);

-- ==========================================================================
-- Agent Factory & Hierarchy (from agent-factory + agent-hierarchy)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS agent_registry (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name          TEXT NOT NULL,
  level         TEXT NOT NULL DEFAULT 'L1',
  type          TEXT NOT NULL DEFAULT 'ai',
  config_json   TEXT DEFAULT '{}',
  health_score  REAL DEFAULT 1.0,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_agent_registry_level ON agent_registry(level);

CREATE TABLE IF NOT EXISTS agent_spawn_proposals (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  agent_level     TEXT DEFAULT 'L1',
  reason          TEXT NOT NULL,
  spec_json       TEXT NOT NULL,
  patch_plan_json TEXT,
  fingerprint     TEXT,
  status          TEXT NOT NULL DEFAULT 'proposal',
  approved_by     TEXT,
  approved_at     INTEGER,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_spawn_proposals_status ON agent_spawn_proposals(status);
CREATE INDEX IF NOT EXISTS idx_spawn_proposals_fingerprint ON agent_spawn_proposals(fingerprint);

CREATE TABLE IF NOT EXISTS agent_health_log (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  agent_id        TEXT NOT NULL,
  success_rate    REAL,
  avg_latency_ms  REAL,
  tokens_used     INTEGER,
  health_score    REAL,
  snapshot_at     INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_agent_health_agent ON agent_health_log(agent_id);

-- ==========================================================================
-- Semantic Analysis (from semantic-schema)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS semantic_events (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_id          TEXT NOT NULL,
  source            TEXT NOT NULL,
  complexity_score  REAL DEFAULT 0,
  narrative         TEXT,
  graph_hash        TEXT,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_semantic_event ON semantic_events(event_id);
CREATE INDEX IF NOT EXISTS idx_semantic_source ON semantic_events(source);

CREATE TABLE IF NOT EXISTS semantic_units (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  event_id    TEXT NOT NULL,
  dimension   TEXT NOT NULL,
  value       TEXT NOT NULL,
  confidence  REAL DEFAULT 1.0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_semantic_units_event ON semantic_units(event_id);
CREATE INDEX IF NOT EXISTS idx_semantic_units_dim ON semantic_units(dimension);

-- ==========================================================================
-- Billing (from v3)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS usage_daily (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   TEXT NOT NULL,
  key         TEXT NOT NULL,
  date        TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  UNIQUE(tenant_id, key, date)
);
CREATE INDEX IF NOT EXISTS idx_usage_daily_tenant ON usage_daily(tenant_id, date);

CREATE TABLE IF NOT EXISTS usage_monthly (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id        TEXT NOT NULL,
  month            TEXT NOT NULL,
  total_calls      INTEGER NOT NULL DEFAULT 0,
  total_tokens     INTEGER NOT NULL DEFAULT 0,
  total_events     INTEGER NOT NULL DEFAULT 0,
  UNIQUE(tenant_id, month)
);
CREATE INDEX IF NOT EXISTS idx_usage_monthly_tenant ON usage_monthly(tenant_id, month);

-- ==========================================================================
-- Sync (from v4)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS sync_snapshots (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  tenant_id   TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'progress',
  payload     TEXT NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_sync_tenant_agent ON sync_snapshots(tenant_id, agent_id, created_at);

-- ==========================================================================
-- Runtime (from v5)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS execution_ledger (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  tenant_id       TEXT NOT NULL DEFAULT 'default',
  decision_id     TEXT NOT NULL,
  action          TEXT NOT NULL,
  target          TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  idempotency_key TEXT UNIQUE,
  attempt         INTEGER DEFAULT 1,
  result_json     TEXT,
  rollback_json   TEXT,
  error           TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ledger_decision ON execution_ledger(decision_id);
CREATE INDEX IF NOT EXISTS idx_ledger_status ON execution_ledger(status);

CREATE TABLE IF NOT EXISTS kpi_metrics (
  id                      TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  tenant_id               TEXT NOT NULL DEFAULT 'default',
  period                  TEXT NOT NULL,
  execution_success_rate  REAL,
  rollback_rate           REAL,
  human_override_rate     REAL,
  avg_latency_ms          REAL,
  token_cost              INTEGER,
  snapshot_at             INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_kpi_period ON kpi_metrics(period);

CREATE TABLE IF NOT EXISTS memory_snapshots (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  tenant_id   TEXT NOT NULL DEFAULT 'default',
  agent_id    TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  snapshot    TEXT NOT NULL,
  diff_json   TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_mem_snap_agent ON memory_snapshots(agent_id, version);

CREATE TABLE IF NOT EXISTS action_allowlist (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  tenant_id   TEXT NOT NULL DEFAULT 'default',
  action      TEXT NOT NULL,
  target      TEXT,
  risk        TEXT NOT NULL DEFAULT 'low',
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_allowlist_action ON action_allowlist(tenant_id, action, target);

CREATE TABLE IF NOT EXISTS evolution_scope (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  scope_type  TEXT NOT NULL UNIQUE,
  max_per_run INTEGER NOT NULL DEFAULT 3,
  description TEXT
);
INSERT OR IGNORE INTO evolution_scope (id, scope_type, max_per_run, description) VALUES
  ('es01', 'promote', 3, 'Max rules promoted per run'),
  ('es02', 'disable', 2, 'Max rules disabled per run'),
  ('es03', 'create', 5, 'Max proposals created per run'),
  ('es04', 'confidence_adjust', 10, 'Max confidence adjustments per run');

-- ==========================================================================
-- Connectors (from v6)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS connectors (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  tenant_id       TEXT NOT NULL DEFAULT 'default',
  name            TEXT NOT NULL,
  source          TEXT NOT NULL,
  mode            TEXT NOT NULL DEFAULT 'push',
  schedule        TEXT,
  auth_type       TEXT DEFAULT 'none',
  auth_config     TEXT DEFAULT '{}',
  endpoint_url    TEXT,
  retry_max       INTEGER DEFAULT 3,
  retry_delay_ms  INTEGER DEFAULT 1000,
  rate_limit_rpm  INTEGER DEFAULT 60,
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_connectors_tenant ON connectors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_connectors_source ON connectors(source);

CREATE TABLE IF NOT EXISTS adapters (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  connector_id    TEXT NOT NULL REFERENCES connectors(id),
  name            TEXT NOT NULL,
  version         TEXT DEFAULT '1.0',
  event_type      TEXT NOT NULL,
  field_map_json  TEXT NOT NULL DEFAULT '{}',
  transform_json  TEXT DEFAULT '{}',
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_adapters_connector ON adapters(connector_id);

CREATE TABLE IF NOT EXISTS connector_state (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  connector_id    TEXT NOT NULL REFERENCES connectors(id) UNIQUE,
  cursor          TEXT,
  last_success_at INTEGER,
  last_error      TEXT,
  consecutive_errors INTEGER DEFAULT 0,
  updated_at      INTEGER
);

CREATE TABLE IF NOT EXISTS connector_runs (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  connector_id    TEXT NOT NULL REFERENCES connectors(id),
  status          TEXT NOT NULL DEFAULT 'running',
  events_fetched  INTEGER DEFAULT 0,
  events_emitted  INTEGER DEFAULT 0,
  error           TEXT,
  started_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_connector_runs ON connector_runs(connector_id, started_at);

-- ==========================================================================
-- Edge Gateway (from v7 + v8)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS edge_agents (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL DEFAULT 'default',
  name           TEXT NOT NULL,
  agent_key_hash TEXT NOT NULL,
  hmac_secret    TEXT,
  status         TEXT NOT NULL DEFAULT 'offline',
  meta_json      TEXT DEFAULT '{}',
  last_seen_at   INTEGER,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_edge_agents_tenant ON edge_agents(tenant_id);

CREATE TABLE IF NOT EXISTS edge_tasks (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  tenant_id    TEXT NOT NULL DEFAULT 'default',
  agent_id     TEXT NOT NULL REFERENCES edge_agents(id),
  type         TEXT NOT NULL DEFAULT 'connector.run',
  payload_json TEXT DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'queued',
  result_json  TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_edge_tasks_agent ON edge_tasks(agent_id, status);

CREATE TABLE IF NOT EXISTS edge_enroll_tokens (
  token         TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL DEFAULT 'default',
  expires_at    INTEGER NOT NULL,
  used_at       INTEGER,
  used_by_agent TEXT
);

-- ==========================================================================
-- Metrics (from v8 — hmac_secret already in edge_agents above)
-- ==========================================================================
-- attempt_number and request_id already in ai_model_logs above

-- ==========================================================================
-- Marketplace (from v9)
-- ==========================================================================

CREATE TABLE IF NOT EXISTS marketplace_connectors (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  description       TEXT,
  version           TEXT DEFAULT '1.0.0',
  author            TEXT DEFAULT 'community',
  icon              TEXT,
  category          TEXT,
  manifest_json     TEXT DEFAULT '{}',
  adapter_spec_json TEXT DEFAULT '{}',
  event_schemas_json TEXT DEFAULT '[]',
  downloads         INTEGER DEFAULT 0,
  rating            REAL DEFAULT 0,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_marketplace_category ON marketplace_connectors(category);

CREATE TABLE IF NOT EXISTS installed_connectors (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  connector_id  TEXT NOT NULL REFERENCES marketplace_connectors(id),
  config_json   TEXT DEFAULT '{}',
  auth_json     TEXT DEFAULT '{}',
  enabled       INTEGER NOT NULL DEFAULT 1,
  installed_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER,
  UNIQUE(tenant_id, connector_id)
);
CREATE INDEX IF NOT EXISTS idx_installed_tenant ON installed_connectors(tenant_id);

CREATE TABLE IF NOT EXISTS connector_event_schemas (
  id            TEXT PRIMARY KEY,
  connector_id  TEXT NOT NULL REFERENCES marketplace_connectors(id),
  event_type    TEXT NOT NULL,
  schema_json   TEXT DEFAULT '{}',
  example_json  TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_event_schemas_connector ON connector_event_schemas(connector_id);

-- ==========================================================================
-- Record bootstrap version
-- ==========================================================================
INSERT OR IGNORE INTO schema_version (version) VALUES (10);
