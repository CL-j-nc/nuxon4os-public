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

27 Cloudflare Workers across 5 deployment layers, communicating via Queues and Service Bindings:

```
                         ┌──────────────────────────────────────────────────┐
                         │            Cloudflare Edge Network               │
                         ├──────────────────────────────────────────────────┤
                         │                                                  │
  Push ──▸ webhook-gateway ──▸ Queue ──▸ event-router ──▸ rule match?      │
  Pull ◂── poller-worker ────────────────────┘     │          │            │
                                                   │     ┌────┴────┐       │
                          semantic-analyzer ◂───────┘     ▼        ▼       │
                                                   ai-agent   execute     │
                          mapping-engine ◂── Truth Layer  │    (0 tok)    │
                          state-updater  ◂── Episodes     │               │
                                                   ┌──────┴──────┐        │
                                                   ▼      ▼      ▼        │
                                              planner  memory  executor   │
                                                                          │
                          evolution-worker ──▸ AI→Rule distillation        │
                          observer-worker ──▸ Bottleneck → Proposals       │
                          meta-agent-worker ──▸ Health scoring + retire    │
                          agent-factory ──▸ Agent lifecycle management     │
                          governance-worker ──▸ Risk scoring + approval    │
                          edge-gateway ──▸ Cloud↔Edge bidirectional ctrl   │
                                                                          │
                         ├──────────────────────────────────────────────────┤
                         │  D1 (53 tables)  │  R2  │  4 Queues  │  2 DOs  │
                         └──────────────────────────────────────────────────┘

  Factory Dashboard (Next.js → CF Pages)  ·  SDK (@nuxon4os/sdk)  ·  Edge Agent (Node.js)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Compute | 27 Cloudflare Workers (5-layer deployment) |
| Database | Cloudflare D1 (53 tables, SQLite at edge) |
| Storage | Cloudflare R2 |
| Queue | Cloudflare Queues (webhook-events, ai-decisions, ai-feedback, failed-events DLQ) |
| State | Durable Objects (IdempotencyDO, AgentStateDO) |
| AI Models | GPT-4o, Gemini 2.0 Flash, Llama 3.3, Qwen 3 (via model router) |
| Frontend | Next.js App Router factory dashboard → Cloudflare Pages |
| Billing | Stripe (Checkout + Customer Portal) |
| SDK | TypeScript, CJS/ESM/DTS, zero runtime deps |
| Edge | Edge Agent — zero-dep Node.js agent for private networks |

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
bash scripts/deploy-factory-dashboard.sh
# Or push to main — GitHub Actions deploys automatically

# 5. Build and deploy dashboard
cd apps/factory-dashboard && npm install && npm run build
wrangler pages deploy dist --project-name=nuxon4os-dashboard
```

## Project Structure

```
nuxon4os/
├── workers/                        # 27 Cloudflare Workers
│   ├── webhook-gateway/            #   L0  Event ingestion + idempotency
│   ├── rate-limiter/               #   L0  Request rate limiting
│   ├── connector-registry/         #   L0  Adapter spec registry
│   ├── connector-marketplace/      #   L0  Community connector marketplace
│   ├── semantic-analyzer/          #   L0  Zero-token semantic decomposition
│   ├── notifier-worker/            #   L0  Telegram / Notion notifications
│   ├── event-log-worker/           #   L0  Full event audit trail
│   ├── ai-model-router/            #   L0  Multi-model selection + budget
│   ├── telegram-command-worker/    #   L0  Bidirectional Telegram control
│   ├── notion-webhook-worker/      #   L0  Notion integration
│   ├── poller-worker/              #   L1  Pull-mode polling (5 cursor strategies)
│   ├── event-router/               #   L1  Queue consumer + rule matching
│   ├── ai-memory-worker/           #   L1  Decision memory
│   ├── ai-planner-worker/          #   L1  Task decomposition
│   ├── ai-executor-worker/         #   L1  Deterministic execution
│   ├── mapping-engine/             #   L1  Semantic compiler (Truth Layer)
│   ├── state-updater/              #   L1  Entity/Episode state memory
│   ├── ai-agent-core/              #   L2  AI reasoning orchestrator
│   ├── observer-worker/            #   L3  System self-review (hourly)
│   ├── evolution-worker/           #   L3  AI→Rule distillation (daily)
│   ├── meta-agent-worker/          #   L3  L4 health scoring + retirement
│   ├── agent-factory-worker/       #   L3  Agent proposal → deployment
│   ├── governance-worker/          #   L3  Policy engine + risk scoring
│   ├── edge-gateway/               #   L3  Cloud↔Edge bidirectional control
│   ├── claude-code-handler/        #   L3  Claude Code hooks integration
│   ├── tenant-factory-worker/      #   L3  Multi-tenant provisioning
│   ├── dashboard-api-worker/       #   L4  Dashboard API gateway
│   └── shared/                     #       Event schema, adapter runtime, truth anchor
│
├── apps/
│   ├── dashboard/                  # React 18 + Vite Dashboard (23 pages)
│   │   ├── src/pages/              #   Maestro, Overview, Events, Agents, Connectors,
│   │   │                           #   Evolution, Governance, EdgeAgents, Marketplace,
│   │   │                           #   Settings, Usage, Cost, Tenants, etc.
│   │   ├── src/components/         #   Layout, UI components, Maestro 3D scene
│   │   ├── src/lib/                #   API client, hooks, i18n
│   │   └── tools/launch-bomb/      #   Automated demo video pipeline
│   └── factory-dashboard/          # Primary Next.js factory dashboard
│
├── sdk/                            # @nuxon4os/sdk (TypeScript, CJS/ESM/DTS)
├── edge-agent/                     # Lightweight Node.js agent (zero deps, single file)
├── durable-objects/                # IdempotencyDO, AgentStateDO
├── d1/                             # 000-bootstrap.sql + 12 migration files
├── packs/                          # Versioned mapping rulesets (Truth Layer v2)
├── scripts/                        # deploy-all.sh, migrate.sh, obfuscate.mjs
├── tools/                          # Claude Code hook, macOS app monitor
│   ├── hooks/claude-code-hook.sh   #   Event bus hook for Claude Code
│   └── monitors/app-monitor.mjs   #   Desktop app process monitor
├── tests/                          # Vitest (4 test files, 51 tests)
├── docs/                           # Project manual, refactor plan, copyright materials
├── .github/workflows/              # CI/CD (5-layer sequential deploy)
├── CONSTITUTION.md                 # 10 non-negotiable system rules
├── CLAUDE.md                       # Claude Code project guidance
├── LICENSE                         # BSL 1.1 (→ Apache 2.0 in 2029)
└── PATENTS                         # Patent protection notice
```

## Key Design Decisions

**Rule-first, AI-as-fallback**: Every event hits the rule engine first (0 tokens). AI is only called when no rule matches. Learned rules accumulate over time, driving token cost toward zero.

**Token budget controller**: Daily (50K) and hourly (10K) token limits. When exceeded, system auto-switches to free models (Llama/Qwen on Cloudflare Workers AI) or defers non-critical decisions.

**Event Identity Schema**: Every event carries `event_id`, `trace_id`, `span_id`, `idempotency_key` — enabling full distributed tracing and exactly-once processing via Durable Objects.

**Stateless reasoning (V2)**: AI agent core returns `action_schema` (structured JSON with rollback_id) instead of executing directly. The caller handles execution, enabling policy gates and audit trails.

## CI/CD

Push to `main` triggers 5-layer sequential deployment via GitHub Actions:

```
Layer 0: gateway, registry, marketplace, semantic, telegram, notifier, event-log, model-router, rate-limiter, notion  (10 workers, no deps)
Layer 1: poller, memory, planner, executor, event-router, mapping-engine, state-updater                               (7 workers, deps on L0)
Layer 2: ai-agent-core                                                                                                (1 worker, deps on L1)
Layer 3: observer, evolution, meta-agent, factory, governance, edge-gateway, claude-code, tenant-factory              (8 workers, deps on L2)
Layer 4: dashboard-api → SDK build → factory dashboard build + Pages deploy                                           (1 worker + frontend)
```

Requires `CF_API_TOKEN` secret in GitHub repo settings.

## License

[Business Source License 1.1](LICENSE) — Copyright (c) 2024-2026 CL-j-nc

Production use requires a commercial license. Non-production use (development, testing, personal projects) is permitted. Converts to Apache 2.0 on 2029-02-27.
