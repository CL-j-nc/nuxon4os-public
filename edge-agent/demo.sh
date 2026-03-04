#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
# Nuxon 4 OS — AI Organization Operating Console
# Copyright (c) 2024-2026 CL-j-nc. All Rights Reserved.
# Licensed under the Business Source License 1.1 (BSL). See LICENSE file.
# ──────────────────────────────────────────────────────────
#
# Edge Agent Demo — runs the full enrollment + task execution flow.
#
# Usage:
#   ADMIN_KEY=<your-admin-key> ./demo.sh
#   ADMIN_KEY=<key> CLOUD_URL=<url> ./demo.sh
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLOUD_URL="${CLOUD_URL:-https://edge-gateway.nuxon4os.workers.dev}"
ADMIN_KEY="${ADMIN_KEY:-}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[DEMO]${NC} $*"; }
ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }

cleanup() {
  log "Cleaning up..."
  [ -n "${MOCK_PID:-}" ] && kill "$MOCK_PID" 2>/dev/null && log "Stopped mock server (PID $MOCK_PID)"
  [ -n "${AGENT_PID:-}" ] && kill "$AGENT_PID" 2>/dev/null && log "Stopped agent (PID $AGENT_PID)"
}
trap cleanup EXIT

# ── Pre-flight checks ──

if [ -z "$ADMIN_KEY" ]; then
  fail "ADMIN_KEY is required. Usage: ADMIN_KEY=<key> ./demo.sh"
fi

command -v node >/dev/null 2>&1 || fail "Node.js is required"
command -v curl >/dev/null 2>&1 || fail "curl is required"

log "=== Nuxon 4 Edge Agent Demo ==="
log "Cloud URL: $CLOUD_URL"
log ""

# ── Step 1: Start mock server ──

log "Step 1: Starting mock server..."
node "$SCRIPT_DIR/mock-server.mjs" &
MOCK_PID=$!
sleep 1

# Verify mock server is running
if curl -s http://localhost:7788/health | grep -q '"ok"'; then
  ok "Mock server running on :7788 (PID $MOCK_PID)"
else
  fail "Mock server failed to start"
fi

# ── Step 2: Create enroll token via cloud API ──

log "Step 2: Creating enroll token..."
ENROLL_RESPONSE=$(curl -s -X POST "$CLOUD_URL/v1/edge/tokens" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -d '{"name": "demo-token", "ttl": 3600}')

ENROLL_TOKEN=$(echo "$ENROLL_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$ENROLL_TOKEN" ]; then
  warn "Could not extract enroll token from response: $ENROLL_RESPONSE"
  warn "Using a placeholder token for demo purposes"
  ENROLL_TOKEN="demo-enroll-token-$(date +%s)"
fi

ok "Enroll token: ${ENROLL_TOKEN:0:20}..."

# ── Step 3: Write .env ──

log "Step 3: Writing .env..."
cat > "$SCRIPT_DIR/.env" <<EOF
CLOUD_URL=$CLOUD_URL
ENROLL_TOKEN=$ENROLL_TOKEN
AGENT_NAME=demo-edge-agent
AGENT_ID=
AGENT_KEY=
EOF
ok ".env written"

# ── Step 4: Start agent ──

log "Step 4: Starting edge agent..."
node "$SCRIPT_DIR/agent.mjs" &
AGENT_PID=$!
sleep 3

if kill -0 "$AGENT_PID" 2>/dev/null; then
  ok "Agent running (PID $AGENT_PID)"
else
  fail "Agent failed to start"
fi

# ── Step 5: Wait for enrollment ──

log "Step 5: Waiting for enrollment..."
sleep 5

if grep -q "AGENT_ID=." "$SCRIPT_DIR/.env" 2>/dev/null; then
  AGENT_ID=$(grep "AGENT_ID=" "$SCRIPT_DIR/.env" | cut -d= -f2)
  ok "Agent enrolled: $AGENT_ID"
else
  warn "Enrollment may not have completed yet (check agent logs above)"
fi

# ── Step 6: Dispatch a connector.run task ──

log "Step 6: Dispatching connector.run task..."

TASK_PAYLOAD=$(cat <<'TASKEOF'
{
  "type": "connector.run",
  "agent_id": "AGENT_ID_PLACEHOLDER",
  "payload_json": {
    "connector": {
      "endpoint": "http://localhost:7788/data",
      "source": "mock-erp",
      "auth": null
    },
    "adapter_spec": {
      "source": { "static": "mock-erp" },
      "type": { "static": "erp.record.created" },
      "subject": { "field": "name" },
      "occurred_at": { "field": "timestamp" },
      "payload": { "passthrough": true },
      "dedup_key": { "field": "id" }
    },
    "tenant_id": "demo-tenant"
  }
}
TASKEOF
)

# Replace agent_id placeholder
if [ -n "${AGENT_ID:-}" ]; then
  TASK_PAYLOAD=$(echo "$TASK_PAYLOAD" | sed "s/AGENT_ID_PLACEHOLDER/$AGENT_ID/")
fi

TASK_RESPONSE=$(curl -s -X POST "$CLOUD_URL/v1/edge/tasks" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -d "$TASK_PAYLOAD")

ok "Task dispatched: $TASK_RESPONSE"

# ── Step 7: Wait and show results ──

log "Step 7: Waiting for task execution..."
sleep 10

log ""
log "=== Demo Complete ==="
log "The agent should have:"
log "  1. Enrolled with the cloud"
log "  2. Started sending heartbeats"
log "  3. Polled and received the connector.run task"
log "  4. Fetched 5 records from mock server"
log "  5. Transformed them into Standard Events (v3.0)"
log "  6. Emitted events to cloud and acknowledged the task"
log ""
log "Check the agent logs above for [ENROLL], [HEARTBEAT], [POLL], [EXECUTE], [ACK] messages."
log ""

# Keep running for a bit so user can see heartbeats
log "Agent will continue running for 15 more seconds (Ctrl+C to stop)..."
sleep 15
