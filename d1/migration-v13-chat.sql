-- Migration v13: Chat messages for Claude Code ↔ Dashboard integration
-- Enables webhook+poll chat between Dashboard UI and Claude Code CLI

CREATE TABLE IF NOT EXISTS chat_messages (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  tenant_id   TEXT NOT NULL DEFAULT 'default',
  user_id     TEXT NOT NULL DEFAULT 'system',
  role        TEXT NOT NULL,             -- 'user' | 'assistant'
  content     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'processing' | 'completed'
  metadata    TEXT,                       -- JSON: session_id, tool_calls, etc.
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_chat_tenant_time ON chat_messages(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_pending ON chat_messages(status, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_role ON chat_messages(role, created_at DESC);
