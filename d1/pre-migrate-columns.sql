-- ==========================================================================
-- Pre-migration: Add missing columns to existing tables
-- Run BEFORE 000-bootstrap.sql on databases with old schema
-- Each ALTER TABLE will fail silently if column already exists
-- ==========================================================================

-- ai_decisions: add tenant_id, agent_id
ALTER TABLE ai_decisions ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE ai_decisions ADD COLUMN agent_id TEXT;

-- ai_memory: add tenant_id
ALTER TABLE ai_memory ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';

-- ai_model_logs: add tenant_id, agent_id, provider, error_message
ALTER TABLE ai_model_logs ADD COLUMN tenant_id TEXT;
ALTER TABLE ai_model_logs ADD COLUMN agent_id TEXT;
ALTER TABLE ai_model_logs ADD COLUMN provider TEXT;
ALTER TABLE ai_model_logs ADD COLUMN error_message TEXT;

-- sensor_events: add tenant_id
ALTER TABLE sensor_events ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';

-- proposals: add tenant_id, trace_id, detail
ALTER TABLE proposals ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE proposals ADD COLUMN trace_id TEXT;
ALTER TABLE proposals ADD COLUMN detail TEXT;
