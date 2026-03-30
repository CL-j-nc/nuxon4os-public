CREATE TABLE IF NOT EXISTS publish_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  content_pack_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  idempotency_key TEXT NOT NULL,
  scheduled_for TEXT,
  claimed_by_executor_id TEXT,
  claimed_at TEXT,
  submitted_at TEXT NOT NULL,
  published_at TEXT,
  result_url TEXT,
  external_post_id TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_publish_jobs_idempotency
  ON publish_jobs (tenant_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_publish_jobs_tenant_created
  ON publish_jobs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_publish_jobs_tenant_status_created
  ON publish_jobs (tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS publish_attempts (
  id TEXT PRIMARY KEY,
  publish_job_id TEXT NOT NULL,
  executor_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  trace_r2_key TEXT,
  screenshot_r2_key TEXT,
  started_at TEXT,
  finished_at TEXT,
  error_code TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_publish_attempts_job_started
  ON publish_attempts (publish_job_id, started_at DESC);

CREATE TABLE IF NOT EXISTS executor_nodes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  last_heartbeat_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_executor_nodes_tenant_status
  ON executor_nodes (tenant_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS executor_leases (
  id TEXT PRIMARY KEY,
  publish_job_id TEXT NOT NULL UNIQUE,
  executor_id TEXT NOT NULL,
  lease_until TEXT NOT NULL,
  heartbeat_at TEXT,
  status TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_executor_leases_executor_status
  ON executor_leases (executor_id, status, lease_until);
