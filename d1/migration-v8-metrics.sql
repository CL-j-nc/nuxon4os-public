-- Migration v8: HMAC secrets + AI model log enhancements
-- Stream C+D: SSE real-time channel & HMAC request signing

-- Add HMAC secret for request signing (stored in plaintext; agent signs with this)
ALTER TABLE edge_agents ADD COLUMN hmac_secret TEXT;

-- AI model log enhancements for retry tracking
ALTER TABLE ai_model_logs ADD COLUMN attempt_number INTEGER DEFAULT 1;
ALTER TABLE ai_model_logs ADD COLUMN request_id TEXT;
