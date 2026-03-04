-- CloudBrain — AI Organization Operating Console
-- Copyright (c) 2024-2026 CL-j-nc. All Rights Reserved.
-- Licensed under the Business Source License 1.1 (BSL). See LICENSE file.

-- ═══════════════════════════════════════════════════════════
-- Migration V3: Billing & Usage Metering
-- CloudBrain v1 — Revenue MVP
-- ═══════════════════════════════════════════════════════════

-- ─── 1. Usage Daily (per-tenant per-key daily rollup) ────
CREATE TABLE IF NOT EXISTS usage_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  api_key_id TEXT,
  date TEXT NOT NULL,
  calls INTEGER DEFAULT 0,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  UNIQUE(tenant_id, api_key_id, date)
);

CREATE INDEX IF NOT EXISTS idx_usage_tenant_date ON usage_daily(tenant_id, date);
CREATE INDEX IF NOT EXISTS idx_usage_key_date ON usage_daily(api_key_id, date);

-- ─── 2. Usage Monthly (fast billing lookup) ─────────────
CREATE TABLE IF NOT EXISTS usage_monthly (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  month TEXT NOT NULL,
  calls INTEGER DEFAULT 0,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  UNIQUE(tenant_id, month)
);

CREATE INDEX IF NOT EXISTS idx_usage_monthly_tenant ON usage_monthly(tenant_id, month);

-- ─── 3. Extend tenants with billing fields ──────────────
-- (ALTER TABLE IF NOT EXISTS not supported in SQLite, safe to re-run)
ALTER TABLE tenants ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE tenants ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE tenants ADD COLUMN plan_calls_limit INTEGER DEFAULT 1000;
ALTER TABLE tenants ADD COLUMN plan_tokens_limit INTEGER DEFAULT 100000;
ALTER TABLE tenants ADD COLUMN billing_period_start INTEGER;
ALTER TABLE tenants ADD COLUMN email TEXT;

-- ─── 4. Default plan limits ─────────────────────────────
-- free:  1,000 calls/mo, 100K tokens/mo
-- pro:  50,000 calls/mo, 5M tokens/mo
-- Update existing free tenants
UPDATE tenants SET plan_calls_limit = 1000, plan_tokens_limit = 100000 WHERE plan = 'free' AND plan_calls_limit IS NULL;
UPDATE tenants SET plan_calls_limit = 50000, plan_tokens_limit = 5000000 WHERE plan = 'pro' AND plan_calls_limit IS NULL;
