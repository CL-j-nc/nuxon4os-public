-- Migration v17: OAuth connector support
-- One-Click OAuth flow for Marketplace connectors (Slack, GitHub)

-- OAuth state tokens (CSRF protection, 10-minute expiry)
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  marketplace_connector_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- OAuth tokens (encrypted at rest via AES-GCM)
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  connector_id TEXT,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  token_type TEXT DEFAULT 'Bearer',
  scope TEXT,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_oauth_tokens_tenant_provider
  ON oauth_tokens(tenant_id, provider);

-- Add auth_type column to marketplace_connectors
ALTER TABLE marketplace_connectors ADD COLUMN auth_type TEXT DEFAULT 'manual';

-- Track migration version
INSERT INTO schema_version (version, applied_at) VALUES (17, datetime('now'));
