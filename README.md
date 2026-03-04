# Nuxon 4 OS — Event-Driven AI Control Plane

> **Who decides whether to call AI? Not the model. The runtime. Based on events.**

Nuxon 4 OS is an event-driven AI governance platform built entirely on the Cloudflare edge stack. It receives webhook events, makes intelligent decisions using AI, and **automatically learns** — converting repeated AI decisions into deterministic rules that execute with **zero tokens and millisecond latency**.

## How It Works

```
Event arrives → Rule Engine (0 tokens) → Match? → Execute deterministically
                                       → No match? → AI reasons → Action returned
                                                   → Pattern learned → Rule created
                                                   → Next time: 0 tokens
```

**First call**: AI processes the event, spends tokens, returns a decision.
**Second call** (same pattern): Rule matches, skips AI entirely. Zero tokens. 3ms.

## Architecture

19 Cloudflare Workers running at the edge, communicating via Queues and Service Bindings:

```
                         ┌──────────────────────────────────────────┐
                         │          Cloudflare Edge Network          │
                         ├──────────────────────────────────────────┤
                         │                                          │
Webhook ──▸ webhook-gateway ──▸ Queue ──▸ event-router             │
                                              │                     │
                              ┌───────────────┼───────────────┐     │
                              ▼               ▼               ▼     │
                        ai-agent-core   notifier-worker  event-log  │
                              │                                     │
                    ┌─────────┼─────────┐                           │
                    ▼         ▼         ▼                           │
              ai-model-  ai-planner  ai-memory                     │
              router     worker      worker                        │
                                                                    │
              observer-worker ──▸ Proposals ──▸ Notifications       │
              evolution-worker ──▸ Rules ──▸ Rule Engine            │
              governance-worker ──▸ Policy enforcement              │
                                                                    │
                         ├──────────────────────────────────────────┤
                         │  D1 (SQLite)  │  R2  │  Queues  │  DO   │
                         └──────────────────────────────────────────┘

Dashboard (Cloudflare Pages)  ·  SDK (@nuxon4os/sdk)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Compute | Cloudflare Workers (21 services) |
| Database | Cloudflare D1 (SQLite at edge) |
| Storage | Cloudflare R2 |
| Queue | Cloudflare Queues |
| State | Durable Objects (idempotency, agent state) |
| AI Models | GPT-4o, Gemini 2.0 Flash, Llama 3.3, Qwen 3 (via model router) |
| Frontend | React 19 + Tailwind CSS + Vite → Cloudflare Pages |
| Billing | Stripe (Checkout + Customer Portal) |
| SDK | TypeScript, CJS/ESM/DTS, zero runtime deps |

## Quick Start

### SDK Usage

```bash
npm install @nuxon4os/sdk
```

```typescript
import { Brain } from '@nuxon4os/sdk';

const brain = new Brain({ apiKey: 'cb_...' });

const result = await brain.run({
  source: 'my-app',
  type: 'user.signup',
  payload: { email: 'user@example.com', plan: 'pro' }
});

// result.action: "execute" | "ignore" | "defer" | "alert"
// result.reason: "Send welcome email and provision account"
// result.tokens_used: 0  (if rule matched)
```

### Self-Hosting

```bash
# 1. Clone
git clone https://github.com/CL-j-nc/nuxon4os.git
cd nuxon4os

# 2. Set up Cloudflare resources
#    - Create D1 database
#    - Create Queues (webhook-events, failed-events, ai-feedback)
#    - Set secrets on each worker (see .env.example)

# 3. Apply D1 schemas
wrangler d1 execute automation-events-db --file=d1/schema.sql
wrangler d1 execute automation-events-db --file=d1/ai-schema.sql
# ... (see d1/ for all schema files)

# 4. Deploy all workers
bash scripts/deploy-v3.sh
# Or push to main — GitHub Actions deploys automatically

# 5. Build and deploy dashboard
cd apps/dashboard && npm install && npm run build
wrangler pages deploy dist --project-name=nuxon4os-dashboard
```

## Project Structure

```
nuxon4os/
├── workers/                    # 21 Cloudflare Workers
│   ├── webhook-gateway/        #   Event ingestion + idempotency
│   ├── event-router/           #   Queue consumer + routing
│   ├── ai-agent-core/          #   AI reasoning service
│   ├── ai-model-router/        #   Multi-model selection + budget
│   ├── ai-executor-worker/     #   Deterministic execution runtime
│   ├── ai-planner-worker/      #   Task decomposition
│   ├── ai-memory-worker/       #   Decision memory
│   ├── evolution-worker/       #   Auto rule learning (daily)
│   ├── observer-worker/        #   System self-review (hourly)
│   ├── governance-worker/      #   Policy engine + risk scoring
│   ├── notifier-worker/        #   Telegram / Notion notifications
│   ├── telegram-command-worker/ #  Bidirectional Telegram control
│   ├── agent-factory-worker/   #   Agent proposal → deployment
│   ├── tenant-factory-worker/  #   Multi-tenant provisioning
│   ├── meta-agent-worker/      #   L4 meta-agent coordination
│   ├── dashboard-api-worker/   #   Dashboard API (~1500 lines)
│   ├── event-log-worker/       #   Full event audit trail
│   ├── claude-code-handler/    #   Claude Code hooks integration
│   ├── rate-limiter/           #   Request rate limiting
│   ├── semantic-analyzer/      #   Rule-based semantic decomposition
│   └── shared/                 #   Event schema, routes, types
├── apps/dashboard/             # React Dashboard (15 pages)
├── sdk/                        # @nuxon4os/sdk
├── d1/                         # D1 schemas + migrations (9 files)
├── durable-objects/            # IdempotencyDO, AgentStateDO
├── scripts/                    # Deploy + setup scripts
├── .github/workflows/          # CI/CD (layered deploy)
└── LICENSE                     # BSL 1.1
```

## Key Design Decisions

**Rule-first, AI-as-fallback**: Every event hits the rule engine first (0 tokens). AI is only called when no rule matches. Learned rules accumulate over time, driving token cost toward zero.

**Token budget controller**: Daily (50K) and hourly (10K) token limits. When exceeded, system auto-switches to free models (Llama/Qwen on Cloudflare Workers AI) or defers non-critical decisions.

**Event Identity Schema**: Every event carries `event_id`, `trace_id`, `span_id`, `idempotency_key` — enabling full distributed tracing and exactly-once processing via Durable Objects.

**Stateless reasoning (V2)**: AI agent core returns `action_schema` (structured JSON with rollback_id) instead of executing directly. The caller handles execution, enabling policy gates and audit trails.

## CI/CD

Push to `main` triggers layered deployment via GitHub Actions:

```
Layer 0: gateway, telegram, notifier, event-log, model-router  (no deps)
Layer 1: memory, planner, executor, event-router                (deps on L0)
Layer 2: ai-agent-core                                          (deps on L1)
Layer 3: observer, evolution, meta-agent, factory, governance   (deps on L2)
Final:   dashboard-api → SDK build → Dashboard build + Pages deploy
```

Requires `CF_API_TOKEN` secret in GitHub repo settings.

## License

[Business Source License 1.1](LICENSE) — Copyright (c) 2024-2026 CL-j-nc

Production use requires a commercial license. Non-production use (development, testing, personal projects) is permitted. Converts to Apache 2.0 on 2029-02-27.
