INSERT INTO schema_version (version) VALUES (30);

ALTER TABLE nuxon_plan_registrations ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nuxon_plan_registrations ADD COLUMN last_error TEXT;
ALTER TABLE nuxon_plan_registrations ADD COLUMN processed_at TEXT;
ALTER TABLE nuxon_plan_registrations ADD COLUMN runtime_payload_json TEXT;
