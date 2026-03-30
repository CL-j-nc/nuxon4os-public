-- Migration v10: Add tenant_id and agent_id to ai_model_logs
-- Required by updated logUsage() in ai-model-router
ALTER TABLE ai_model_logs ADD COLUMN tenant_id TEXT DEFAULT 'default';
ALTER TABLE ai_model_logs ADD COLUMN agent_id TEXT DEFAULT 'unknown';
