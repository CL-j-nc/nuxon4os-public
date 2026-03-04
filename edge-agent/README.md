# Nuxon 4 Edge Agent

Lightweight Node.js agent that runs inside private networks, connects to the Nuxon 4 cloud gateway, and executes connector tasks (pull data from internal systems, transform into Standard Events, emit to cloud).

**Zero dependencies** — uses only Node.js built-in modules (`http`, `https`, `crypto`, `fs`, `os`).

## Quick Start

### 1. Generate an enroll token

Via Dashboard or API:

```bash
curl -X POST https://edge-gateway.nuxon4os.workers.dev/v1/edge/tokens \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -d '{"name": "my-agent-token", "ttl": 3600}'
```

### 2. Configure `.env`

```bash
cp .env.example .env
# Edit .env — set CLOUD_URL and ENROLL_TOKEN
```

### 3. Start the mock server (for testing)

```bash
node mock-server.mjs
# Listening on http://localhost:7788
# GET /health — status check
# GET /data   — sample records
```

### 4. Start the agent

```bash
node agent.mjs
```

The agent will:
1. Read `.env` configuration
2. Enroll with the cloud (if not already enrolled)
3. Start heartbeat loop (every 30s)
4. Start task polling loop (every 5s)
5. Execute `connector.run` tasks as they arrive

### 5. Dispatch a task

```bash
curl -X POST https://edge-gateway.nuxon4os.workers.dev/v1/edge/tasks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -d '{
    "type": "connector.run",
    "agent_id": "<your-agent-id>",
    "payload_json": {
      "connector": {
        "endpoint": "http://localhost:7788/data",
        "source": "mock-erp"
      },
      "adapter_spec": {
        "source": { "static": "mock-erp" },
        "type": { "static": "erp.record.created" },
        "subject": { "field": "name" },
        "occurred_at": { "field": "timestamp" },
        "payload": { "passthrough": true },
        "dedup_key": { "field": "id" }
      },
      "tenant_id": "my-tenant"
    }
  }'
```

## Full Demo

Run the automated demo script (requires `ADMIN_KEY`):

```bash
ADMIN_KEY=<your-admin-key> bash demo.sh
```

This starts the mock server, enrolls the agent, dispatches a task, and shows the complete flow.

## CLI Arguments

Configuration can be passed via CLI arguments (overrides `.env`):

```bash
node agent.mjs CLOUD_URL=http://localhost:8787 AGENT_NAME=test-agent
```

## Log Prefixes

| Prefix        | Meaning                          |
|---------------|----------------------------------|
| `[ENROLL]`    | Enrollment with cloud            |
| `[HEARTBEAT]` | Periodic heartbeat report        |
| `[POLL]`      | Task polling                     |
| `[EXECUTE]`   | Task execution (fetch + transform) |
| `[ACK]`       | Task acknowledgment              |

## Architecture

```
┌─────────────────────────────────────────────┐
│            Private Network                  │
│                                             │
│  ┌─────────────┐     ┌──────────────────┐   │
│  │ Internal     │────>│  Edge Agent      │   │
│  │ System       │     │  (agent.mjs)     │──────> Cloud Gateway
│  │ (ERP/CRM/DB)│     │                  │   │    (edge-gateway worker)
│  └─────────────┘     └──────────────────┘   │
│                                             │
└─────────────────────────────────────────────┘
```

The agent polls the cloud for tasks, fetches data from local systems, transforms it using the adapter runtime, and pushes Standard Events (v3.0) back to the cloud.
