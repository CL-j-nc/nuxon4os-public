-- ==========================================================================
-- Nuxon 4 OS — Migration v11: Truth Layer (Meaning-based Persistence)
--
-- Phase: Fusion Architecture v2
-- Tables: 12 new tables for truth/facts/proof/replay/state
-- All tables include tenant_id for multi-tenant isolation
-- ==========================================================================

-- ── 1. Ingest Ledger (Raw Fingerprint anchor) ──
-- Every raw event gets a bit-exact fingerprint before any transformation.
-- This is the immutable truth anchor for replay/audit/dedup.
CREATE TABLE IF NOT EXISTS ingest_ledger (
  ingest_id          TEXT PRIMARY KEY,          -- ULID
  tenant_id          TEXT NOT NULL DEFAULT 'default',
  raw_fingerprint    TEXT NOT NULL,             -- SHA-256(payload + provider_event_id + cursor + source)
  raw_ptr            TEXT,                      -- optional R2/KV pointer for cold storage
  provider_event_id  TEXT,                      -- upstream event ID (Stripe evt_xxx, GitHub delivery ID, etc.)
  source             TEXT NOT NULL,
  cursor             TEXT,                      -- connector cursor at ingest time
  payload_size_bytes INTEGER,
  received_at        INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ingest_tenant ON ingest_ledger(tenant_id, received_at);
CREATE INDEX IF NOT EXISTS idx_ingest_fingerprint ON ingest_ledger(raw_fingerprint);
CREATE INDEX IF NOT EXISTS idx_ingest_provider ON ingest_ledger(provider_event_id);

-- ── 2. Semantic Snapshots (version anchor for deterministic compilation) ──
-- All semantic compiler inputs frozen into one ID.
-- Same snapshot_id + same raw event = identical Facts. Always.
CREATE TABLE IF NOT EXISTS semantic_snapshots (
  snapshot_id        TEXT PRIMARY KEY,          -- hash of all components below
  tenant_id          TEXT NOT NULL DEFAULT 'default',
  adapter_hash       TEXT NOT NULL,             -- hash of adapter code
  schema_ver         TEXT NOT NULL,             -- event schema version
  type_ver           TEXT NOT NULL,             -- type table version
  mapping_ver        TEXT NOT NULL,             -- mapping ruleset version
  identity_ver       TEXT NOT NULL,             -- identity resolver version
  flags_hash         TEXT NOT NULL,             -- feature flags / ECV hash
  created_at         INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_snapshot_tenant ON semantic_snapshots(tenant_id);

-- ── 3. Facts Ledger (strong-typed fact account book) ──
-- The CORE of meaning-based persistence.
-- Append-only. Each fact has provenance + weight vector.
-- Hot: D1 (< 90 days). Cold: R2 archive.
CREATE TABLE IF NOT EXISTS facts_ledger (
  fact_id            TEXT PRIMARY KEY,          -- ULID
  tenant_id          TEXT NOT NULL DEFAULT 'default',
  event_id           TEXT NOT NULL,             -- references event_ir.event_id
  subject_id         TEXT NOT NULL,             -- who/what this fact is about
  path               TEXT NOT NULL,             -- structured path (e.g. "payment.amount", "deploy.status")
  op                 TEXT NOT NULL DEFAULT 'set', -- set/add/remove/increment
  typed_value        TEXT NOT NULL,             -- JSON-encoded typed value
  value_type         TEXT NOT NULL DEFAULT 'string', -- string/number/boolean/enum/ref/datetime
  unit               TEXT,                      -- USD/ms/bytes/count/null
  ref                TEXT,                      -- reference to another entity
  confidence         REAL NOT NULL DEFAULT 1.0, -- 0.0-1.0
  materiality        REAL NOT NULL DEFAULT 0.5, -- 0.0-1.0, how important for decisions
  stability          REAL NOT NULL DEFAULT 1.0, -- 0.0-1.0, how likely to change
  provenance         TEXT NOT NULL DEFAULT 'raw', -- raw/inferred/aggregated/manual
  snapshot_id        TEXT NOT NULL,             -- which semantic snapshot produced this
  created_at         INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_facts_event ON facts_ledger(event_id);
CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts_ledger(tenant_id, subject_id, created_at);
CREATE INDEX IF NOT EXISTS idx_facts_path ON facts_ledger(path);
CREATE INDEX IF NOT EXISTS idx_facts_materiality ON facts_ledger(materiality) WHERE materiality > 0.7;
CREATE INDEX IF NOT EXISTS idx_facts_tenant_time ON facts_ledger(tenant_id, created_at);

-- ── 4. Proof Packs (minimal evidence for high-materiality facts) ──
-- Only for facts where materiality > threshold.
-- Keeps audit cost bounded while ensuring accountability.
CREATE TABLE IF NOT EXISTS proof_packs (
  proof_id           TEXT PRIMARY KEY,          -- ULID
  tenant_id          TEXT NOT NULL DEFAULT 'default',
  event_id           TEXT NOT NULL,
  fact_paths         TEXT NOT NULL DEFAULT '[]', -- JSON array of fact paths covered
  excerpts           TEXT NOT NULL DEFAULT '{}', -- JSON: key excerpts from raw payload
  provenance_ptrs    TEXT NOT NULL DEFAULT '{}', -- JSON: pointers to source evidence
  transform_hashes   TEXT NOT NULL DEFAULT '{}', -- JSON: hash of each transform step
  created_at         INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_proof_event ON proof_packs(event_id);
CREATE INDEX IF NOT EXISTS idx_proof_tenant ON proof_packs(tenant_id);

-- ── 5. Event IR (the compiled event — system's core contract) ──
-- Every downstream worker consumes EventIR, not raw JSON.
CREATE TABLE IF NOT EXISTS event_ir (
  event_id           TEXT PRIMARY KEY,          -- same as events.id
  tenant_id          TEXT NOT NULL DEFAULT 'default',
  ingest_id          TEXT NOT NULL,             -- references ingest_ledger
  snapshot_id        TEXT NOT NULL,             -- references semantic_snapshots
  subject_set        TEXT NOT NULL DEFAULT '[]', -- JSON array: [{id, type, confidence, evidence}]
  facts_count        INTEGER NOT NULL DEFAULT 0,
  proof_pack_id      TEXT,                      -- references proof_packs (nullable)
  weight_vec         TEXT NOT NULL DEFAULT '{}', -- JSON: {confidence, materiality, stability}
  bible_ref          TEXT,                      -- pointer to event_bible record
  policy_version     TEXT,
  compiled_at        INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_ir_tenant ON event_ir(tenant_id, compiled_at);
CREATE INDEX IF NOT EXISTS idx_ir_ingest ON event_ir(ingest_id);
CREATE INDEX IF NOT EXISTS idx_ir_snapshot ON event_ir(snapshot_id);

-- ── 6. Event Bible (structured meaning record — the "Bible Bucket") ──
-- Human-readable + machine-queryable meaning of every event.
CREATE TABLE IF NOT EXISTS event_bible (
  bible_id           TEXT PRIMARY KEY,          -- ULID
  tenant_id          TEXT NOT NULL DEFAULT 'default',
  event_id           TEXT NOT NULL,
  who                TEXT,                      -- primary subject
  what_action        TEXT,                      -- normalized action taxonomy
  what_intent        TEXT,                      -- inferred intent
  when_occurred      INTEGER,                   -- event timestamp
  where_source       TEXT,                      -- source system
  why_context        TEXT,                      -- contextual explanation
  decision           TEXT,                      -- what the system decided
  result             TEXT,                      -- outcome
  feedback           TEXT,                      -- human/system feedback
  rule_id            TEXT,                      -- which rule fired (if any)
  created_at         INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_bible_tenant ON event_bible(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bible_who ON event_bible(who);
CREATE INDEX IF NOT EXISTS idx_bible_action ON event_bible(what_action);

-- ── 7. Drift Reports ──
-- Structured diff when facts/identity/decisions diverge across snapshots or policies.
CREATE TABLE IF NOT EXISTS drift_reports (
  report_id          TEXT PRIMARY KEY,          -- ULID
  tenant_id          TEXT NOT NULL DEFAULT 'default',
  drift_type         TEXT NOT NULL,             -- fact/identity/decision
  event_id           TEXT,
  snapshot_a         TEXT,
  snapshot_b         TEXT,
  policy_a           TEXT,
  policy_b           TEXT,
  diff_json          TEXT NOT NULL DEFAULT '{}', -- structured diff
  invariant_violations TEXT DEFAULT '[]',       -- JSON array of violated invariants
  severity           TEXT NOT NULL DEFAULT 'info', -- info/warning/critical
  created_at         INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_drift_tenant ON drift_reports(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_drift_severity ON drift_reports(severity) WHERE severity != 'info';

-- ── 8. Replay Runs ──
-- Record of every replay execution for audit trail.
CREATE TABLE IF NOT EXISTS replay_runs (
  run_id             TEXT PRIMARY KEY,          -- ULID
  tenant_id          TEXT NOT NULL DEFAULT 'default',
  event_ids          TEXT NOT NULL DEFAULT '[]', -- JSON array of replayed event IDs
  snapshot_id        TEXT NOT NULL,
  policy_version     TEXT,
  facts_produced     INTEGER DEFAULT 0,
  decisions_produced INTEGER DEFAULT 0,
  drift_report_id    TEXT,                      -- references drift_reports if diff found
  duration_ms        INTEGER,
  status             TEXT NOT NULL DEFAULT 'running', -- running/completed/failed
  created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_replay_tenant ON replay_runs(tenant_id, created_at);

-- ── 9. Policy Registry (versioned policy for deterministic decisions) ──
CREATE TABLE IF NOT EXISTS policy_registry (
  policy_id          TEXT PRIMARY KEY,          -- version string (e.g. "v2026.03.05-001")
  tenant_id          TEXT NOT NULL DEFAULT 'default',
  rules_snapshot     TEXT NOT NULL DEFAULT '{}', -- JSON: frozen set of active rules at this version
  config_snapshot    TEXT NOT NULL DEFAULT '{}', -- JSON: thresholds/weights/flags
  parent_policy_id   TEXT,                      -- previous version for rollback
  status             TEXT NOT NULL DEFAULT 'active', -- active/shadow/retired
  promoted_at        INTEGER,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_policy_tenant ON policy_registry(tenant_id, status);

-- ── 10. Rule Genesis (RuleDelta pipeline) ──
-- Every AI-proposed rule goes through: validate → conflict → replay → canary → promote.
CREATE TABLE IF NOT EXISTS rule_genesis (
  genesis_id         TEXT PRIMARY KEY,          -- ULID
  tenant_id          TEXT NOT NULL DEFAULT 'default',
  rule_delta         TEXT NOT NULL,             -- JSON: the proposed rule change
  source             TEXT NOT NULL DEFAULT 'ai', -- ai/manual/evolution
  stage              TEXT NOT NULL DEFAULT 'proposed', -- proposed/validated/conflict_checked/replay_scored/canary/promoted/rejected
  validation_result  TEXT DEFAULT '{}',         -- JSON: syntax check result
  conflict_result    TEXT DEFAULT '{}',         -- JSON: overlap/coverage analysis
  replay_score       REAL,                      -- 0.0-1.0 from shadow replay
  replay_run_id      TEXT,                      -- references replay_runs
  canary_config      TEXT DEFAULT '{}',         -- JSON: tenant subset / traffic %
  canary_result      TEXT DEFAULT '{}',         -- JSON: canary metrics
  target_policy_id   TEXT,                      -- which policy version this promotes into
  decided_by         TEXT,                      -- system/human
  created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_genesis_tenant ON rule_genesis(tenant_id, stage);
CREATE INDEX IF NOT EXISTS idx_genesis_stage ON rule_genesis(stage) WHERE stage != 'promoted' AND stage != 'rejected';

-- ── 11. Subject States (RWKV/Mamba-style state memory) ──
-- Each subject maintains a state machine updated by EventIR.
-- Core state: high materiality + high confidence facts only.
CREATE TABLE IF NOT EXISTS subject_states (
  subject_id         TEXT NOT NULL,
  tenant_id          TEXT NOT NULL DEFAULT 'default',
  state_zone         TEXT NOT NULL DEFAULT 'core', -- core/observation/candidate
  state_json         TEXT NOT NULL DEFAULT '{}',   -- JSON: accumulated state
  version            INTEGER NOT NULL DEFAULT 1,
  last_event_id      TEXT,
  last_updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (tenant_id, subject_id, state_zone)
);
CREATE INDEX IF NOT EXISTS idx_subject_tenant ON subject_states(tenant_id);

-- ── 12. Episode States (event chain aggregation) ──
-- Groups related events into episodes (deploy, incident, transaction).
CREATE TABLE IF NOT EXISTS episode_states (
  episode_id         TEXT PRIMARY KEY,          -- ULID
  tenant_id          TEXT NOT NULL DEFAULT 'default',
  episode_type       TEXT NOT NULL,             -- deploy/incident/transaction/session
  subject_id         TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'open', -- open/closed/archived
  event_count        INTEGER NOT NULL DEFAULT 0,
  first_event_id     TEXT,
  last_event_id      TEXT,
  summary_json       TEXT DEFAULT '{}',         -- JSON: accumulated episode summary
  opened_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  closed_at          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_episode_tenant ON episode_states(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_episode_subject ON episode_states(subject_id);
CREATE INDEX IF NOT EXISTS idx_episode_type ON episode_states(episode_type);

-- ── 13. Invariants Registry (defines system invariants for drift guard) ──
CREATE TABLE IF NOT EXISTS invariants (
  invariant_id       TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL DEFAULT 'default',
  name               TEXT NOT NULL,             -- identity/type/unit/monotonic/proof-required/schema-compat
  rule_json          TEXT NOT NULL DEFAULT '{}', -- JSON: invariant definition
  severity           TEXT NOT NULL DEFAULT 'warning', -- info/warning/critical/blocking
  enabled            INTEGER NOT NULL DEFAULT 1,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_invariants_tenant ON invariants(tenant_id);

-- ── Seed default invariants ──
INSERT OR IGNORE INTO invariants (invariant_id, name, rule_json, severity) VALUES
  ('inv-identity',    'identity',              '{"desc":"Subject primary anchor change requires evidence","check":"subject_set.primary.changed -> proof_required"}',     'critical'),
  ('inv-type',        'type',                  '{"desc":"typed_value type cannot silently change","check":"fact.value_type.changed -> reject_or_migrate"}',               'critical'),
  ('inv-unit',        'unit',                  '{"desc":"Unit change must be convertible and recorded","check":"fact.unit.changed -> conversion_exists"}',                'warning'),
  ('inv-monotonic',   'monotonic',             '{"desc":"Certain fields only increase","check":"schema_version,policy_version -> monotonic_increase"}',                  'blocking'),
  ('inv-proof',       'proof-required-for-actions', '{"desc":"High materiality facts triggering actions must have proof","check":"fact.materiality > 0.8 AND action -> proof_pack_exists"}', 'critical'),
  ('inv-schema',      'schema-compat',         '{"desc":"Mapping output must conform to schema registry","check":"event_ir.facts -> schema_registry.validate"}',         'blocking');

-- ── Record migration version ──
INSERT OR IGNORE INTO schema_version (version) VALUES (11);
