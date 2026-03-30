INSERT INTO schema_version (version) VALUES (25);

CREATE TABLE IF NOT EXISTS nuxon_conversations (
  conversation_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  title TEXT,
  tool TEXT NOT NULL DEFAULT 'custom_tool',
  interaction_mode TEXT NOT NULL DEFAULT 'watch',
  runtime TEXT NOT NULL DEFAULT 'desktop',
  permissions_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_nuxon_conversations_updated
  ON nuxon_conversations(updated_at DESC, conversation_id ASC);

CREATE TABLE IF NOT EXISTS nuxon_conversation_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content_text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'unknown',
  task_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (conversation_id) REFERENCES nuxon_conversations(conversation_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_nuxon_conversation_messages_time
  ON nuxon_conversation_messages(conversation_id, created_at ASC, id ASC);
