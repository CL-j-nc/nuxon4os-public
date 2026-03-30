-- ⚠️ DEPRECATED — Use d1/000-bootstrap.sql instead
-- This standalone file is superseded by the unified bootstrap schema.
-- Kept for reference only. Do NOT run directly.
--
-- Nuxon 4 OS — AI Organization Operating Console
-- Copyright (c) 2024-2026 CL-j-nc. All Rights Reserved.
-- Licensed under the Business Source License 1.1 (BSL). See LICENSE file.

-- Events table: stores all webhook events for audit + tracing
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  source TEXT,
  env TEXT DEFAULT 'production',
  payload TEXT,
  status TEXT DEFAULT 'pending',
  created_at INTEGER,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
