-- CloudBrain — AI Organization Operating Console
-- Copyright (c) 2024-2026 CL-j-nc. All Rights Reserved.
-- Licensed under the Business Source License 1.1 (BSL). See LICENSE file.

-- Dashboard Schema — Auth + Multi-tenant + Audit
-- Run: npx wrangler d1 execute automation-events-db --remote --command "$(cat d1/dashboard-schema.sql)"

-- ── Tenants ──
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT DEFAULT 'free',
  config_json TEXT DEFAULT '{}',
  status TEXT DEFAULT 'active',
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

INSERT OR IGNORE INTO tenants (id, name, plan) VALUES ('default', 'Default Tenant', 'pro');

-- ── Users ──
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'viewer',
  status TEXT DEFAULT 'active',
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ── API Keys ──
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  key_prefix TEXT NOT NULL,
  scopes TEXT DEFAULT '["read"]',
  last_used_at INTEGER,
  expires_at INTEGER,
  status TEXT DEFAULT 'active',
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);

-- ── Sessions ──
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  expires_at INTEGER NOT NULL,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ── Audit Logs ──
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  detail_json TEXT DEFAULT '{}',
  ip TEXT,
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_logs(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);

-- ── Events table extensions (add missing columns) ──
-- SQLite doesn't support ADD COLUMN IF NOT EXISTS, so we use a safe approach
-- These may fail if columns already exist — that's OK

-- Add tenant_id to events
-- ALTER TABLE events ADD COLUMN tenant_id TEXT DEFAULT 'default';
-- Add trace_id to events
-- ALTER TABLE events ADD COLUMN trace_id TEXT;
-- Add type to events
-- ALTER TABLE events ADD COLUMN type TEXT;

-- Indexes for new columns (safe to run multiple times)
CREATE INDEX IF NOT EXISTS idx_events_tenant ON events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_events_trace ON events(trace_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
