-- Migration v14: AI Topics + Semantic Slots for Cross-AI Context Sharing
-- Enables topic-based briefing between Claude Code ↔ ChatGPT via Dashboard
--
-- ai_topics:       user-created discussion topics (e.g. "语义槽设计")
-- ai_topic_events: links events to topics with notes (bridges ChatGPT black-box gap)
-- semantic_slots:  A-layer semantic metadata (Identity / Ownership / Source)

CREATE TABLE IF NOT EXISTS ai_topics (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  tenant_id   TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'active',   -- active | archived
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_ai_topics_tenant ON ai_topics(tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_topic_events (
  topic_id    TEXT NOT NULL,
  event_id    TEXT NOT NULL,
  source      TEXT NOT NULL,        -- 'claude-code' | 'chatgpt' | 'manual'
  note        TEXT,                 -- user manual annotation (critical for ChatGPT black-box)
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (topic_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_topic_events_topic ON ai_topic_events(topic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_topic_events_event ON ai_topic_events(event_id);

CREATE TABLE IF NOT EXISTS semantic_slots (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  tenant_id     TEXT NOT NULL,
  topic_id      TEXT,                   -- optional link to ai_topics
  -- A-Layer: Identity
  entity_type   TEXT NOT NULL,          -- 'event' | 'conversation' | 'artifact' | 'decision'
  entity_id     TEXT,                   -- reference to source entity
  subject       TEXT,                   -- human-readable subject line
  -- A-Layer: Ownership
  created_by    TEXT,                   -- who created this slot (user/agent id)
  owned_by      TEXT,                   -- who owns the context (user/agent id)
  -- A-Layer: Source
  source_kind   TEXT NOT NULL,          -- 'claude-code' | 'chatgpt' | 'dashboard' | 'manual'
  source_ref    TEXT,                   -- external reference (conversation id, commit hash, etc.)
  -- Content
  summary       TEXT,                   -- concise semantic summary
  payload_json  TEXT,                   -- full structured payload (JSON)
  -- Meta
  visibility    TEXT NOT NULL DEFAULT 'shared',  -- 'shared' | 'private'
  status        TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'archived'
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_semantic_slots_tenant ON semantic_slots(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_semantic_slots_topic ON semantic_slots(topic_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_semantic_slots_source ON semantic_slots(source_kind, created_at DESC);

-- Schema version bump
INSERT OR REPLACE INTO schema_version (version, applied_at)
VALUES (14, datetime('now'));
