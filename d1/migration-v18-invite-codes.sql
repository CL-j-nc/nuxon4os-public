-- ============================================================
-- Nuxon 4 OS — Migration v18: Invite Codes
-- ============================================================

CREATE TABLE IF NOT EXISTS invite_codes (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  label      TEXT,
  max_uses   INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1
);

INSERT OR IGNORE INTO schema_version (version) VALUES (18);
