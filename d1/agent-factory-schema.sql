-- CloudBrain — AI Organization Operating Console
-- Copyright (c) 2024-2026 CL-j-nc. All Rights Reserved.
-- Licensed under the Business Source License 1.1 (BSL). See LICENSE file.

-- ═══════════════════════════════════════════════════════════
-- Agent Factory Schema: spawn proposals + patch plans
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS agent_spawn_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT DEFAULT 'default',
  name TEXT NOT NULL,                -- proposed worker name
  reason TEXT,                       -- why this agent should exist
  spec_json TEXT,                    -- full spec: worker_name, listen_types, route_rule, bindings, expected_io
  patch_plan_json TEXT,              -- generated after approval: files to create, diffs to apply
  status TEXT DEFAULT 'proposal',    -- proposal | approved | rejected | deployed
  created_at INTEGER NOT NULL,
  updated_at INTEGER,
  decided_by TEXT                    -- who approved/rejected: 'admin' | user_id
);

CREATE INDEX IF NOT EXISTS idx_asp_status ON agent_spawn_proposals(status, created_at);
CREATE INDEX IF NOT EXISTS idx_asp_tenant ON agent_spawn_proposals(tenant_id, status);
