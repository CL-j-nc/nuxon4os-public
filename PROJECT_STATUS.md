# Nuxon 4 OS — 项目状态摘要

> **最后更新**: 2026-03-03
> **版本**: v3.1 Monorepo
> **许可证**: BSL 1.1 (Business Source License)
> **所有者**: CL-j-nc

---

## 一、产品定位

**Nuxon 4 OS — AI Organization Operating Console**

一句话：用一个 API 调用实现任何 Webhook 事件的 AI 自动化决策。

核心价值：
- 接收事件 → 规则匹配（免费）→ AI 决策（消耗 tokens）→ 返回行动建议
- 系统自学习：AI 的高频决策自动沉淀为规则，随时间推移成本趋近于零
- 多租户 SaaS，自助注册，按量计费

---

## 二、技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Edge Network                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  webhook-     │───▸│  event-      │───▸│  ai-agent-   │  │
│  │  gateway      │    │  router      │    │  core        │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                    │                    │          │
│         ▼                    ▼                    ▼          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  event-log   │    │  notifier    │    │  ai-model-   │  │
│  │  worker      │    │  worker      │    │  router      │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│                              │                    │          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  evolution-  │    │  governance- │    │  meta-agent  │  │
│  │  worker      │    │  worker      │    │  worker      │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  agent-      │    │  tenant-     │    │  dashboard-  │  │
│  │  factory     │    │  factory     │    │  api-worker  │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  D1 Database  │  R2 Storage  │  Queues  │  Durable Objects  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Factory Dashboard (Cloudflare Pages) │ SDK (@nuxon4os/sdk) │
└─────────────────────────────────────────────────────────────┘
```

### 技术栈
- **Compute**: Cloudflare Workers (21 个微服务)
- **Database**: Cloudflare D1 (SQLite at edge)
- **Storage**: Cloudflare R2 (snapshots, exports)
- **Queue**: Cloudflare Queues (event pipeline)
- **State**: Cloudflare Durable Objects (idempotency, agent state)
- **Frontend**: Next.js App Router factory dashboard (Cloudflare Pages)
- **SDK**: TypeScript, CJS/ESM/DTS, zero runtime deps (@nuxon4os/sdk)
- **Billing**: Stripe (Checkout + Customer Portal + Webhooks)

---

## 三、功能矩阵

| 模块 | 功能 | 状态 |
|------|------|------|
| **公共 API** | POST /v1/execute (事件决策) | ✅ 完成 |
| **公共 API** | GET /v1/usage (用量查询) | ✅ 完成 |
| **认证** | 自助注册 + JWT + API Key | ✅ 完成 |
| **计费** | Free $0 / Pro $29/mo (Stripe) | ✅ 完成 |
| **用量计量** | 日/月粒度，原子配额检查 | ✅ 完成 |
| **规则引擎** | 规则匹配优先，AI 兜底 | ✅ 完成 |
| **AI 决策** | 多模型路由 (auto/specific) | ✅ 完成 |
| **规则进化** | AI 决策自动沉淀为规则 | ✅ 完成 |
| **Agent 层级** | L1-L4 四级 Agent 体系 | ✅ 完成 |
| **Agent 工厂** | 提案→审批→自动部署 | ✅ 完成 |
| **治理层** | 策略引擎 + 风险评分 + 审批流 | ✅ 完成 |
| **R2 快照** | 系统快照 + 租户导出 + 自复制 | ✅ 完成 |
| **Dashboard** | 15 页面全功能管理控制台 | ✅ 完成 |
| **SDK** | @nuxon4os/sdk Brain.run() | ✅ 完成 |
| **Landing** | 产品首页 + 定价 + API 文档 | ✅ 完成 |
| **Onboarding** | 3 步注册引导 | ✅ 完成 |
| **i18n** | 中英双语 (120+ keys) | ✅ 完成 |
| **多租户** | 完整租户隔离 | ✅ 完成 |
| **IP 保护** | BSL 1.1 + 版权头 + Private repos | ✅ 完成 |

---

## 四、安全加固状态

| 问题 | 修复 | 状态 |
|------|------|------|
| Stripe 时序攻击 | 常数时间 XOR 比较 | ✅ |
| Stripe 重放攻击 | 5 分钟时间戳窗口 | ✅ |
| 密码硬编码盐 | env.PASSWORD_SALT + tenantId | ✅ |
| API Key 权限过大 | role: api-key + requireScope() | ✅ |
| CORS wildcard+credentials | 条件分离 | ✅ |
| URL 参数注入 | encodeURIComponent | ✅ |
| 错误信息泄露 | 统一 "Internal server error" | ✅ |
| 跨租户数据泄露 | 全部查询添加 tenant_id | ✅ |
| 配额竞态条件 | INSERT ON CONFLICT RETURNING 原子化 | ✅ |
| 输入验证缺失 | Email 格式/长度/XSS 过滤 | ✅ |
| account_id 暴露 | 19 个 wrangler.toml 清除 | ✅ |
| 生产域名硬编码 | 环境变量/占位符替换 | ✅ |
| API 版本号泄露 | 响应脱敏 | ✅ |
| GitHub 仓库公开 | 全部 18 个仓库设为 Private | ✅ |
| 依赖许可证审计 | 全部 MIT/Apache/BSD/ISC | ✅ |

---

## 五、文件结构

```
nuxon4os/
├── apps/factory-dashboard/   # Primary factory dashboard (Next.js)
├── workers/                  # 21 Cloudflare Workers
│   ├── dashboard-api-worker/ # 核心 API (1500 行)
│   ├── webhook-gateway/      # 事件入口
│   ├── event-router/         # 事件路由
│   ├── ai-agent-core/        # AI 决策核心
│   ├── ai-model-router/      # 多模型路由
│   ├── evolution-worker/     # 规则进化
│   ├── governance-worker/    # 治理引擎
│   ├── agent-factory-worker/ # Agent 工厂
│   ├── rate-limiter/         # 请求限流
│   ├── semantic-analyzer/   # 语义分解 (rule-based)
│   └── ...                   # 其他 11 个 Worker
├── sdk/                      # @nuxon4os/sdk
├── d1/                       # D1 Schema + Migrations (9 files)
├── durable-objects/          # Durable Objects
├── scripts/                  # deploy-v3.sh, setup-stripe.sh
├── .github/workflows/        # CI/CD
├── LICENSE                   # BSL 1.1
├── .gitignore               # Root gitignore
└── .env.example             # 环境变量模板
```

---

## 六、套餐设计

| | Free | Pro |
|---|---|---|
| 价格 | $0/月 | $29/月 |
| API 调用 | 1,000/月 | 50,000/月 |
| Token 额度 | 100K/月 | 5M/月 |
| 规则引擎 | 无限 | 无限 |
| API Key | 1 个 | 无限 |
| 支持 | 社区 | 优先 |

---

## 七、开发里程碑

| 阶段 | 内容 | 日期 | 状态 |
|------|------|------|------|
| Phase 1 | 核心事件管道 + AI 决策 | 2024-2025 | ✅ |
| Phase 2 | Agent 层级 + 自进化 | 2025 | ✅ |
| Phase 3 | Mission Control + SSE | 2025 | ✅ |
| Phase 4 | 多租户隔离 | 2025 | ✅ |
| Phase 5 | i18n + 治理层 | 2026-02 | ✅ |
| Phase 6 | R2 快照 + 自复制 | 2026-02 | ✅ |
| Phase 7 | Revenue MVP (计费+SDK) | 2026-02 | ✅ |
| Phase 8 | 安全加固 + IP 保护 | 2026-02-27 | ✅ |
| Phase 9 | Stripe 实测 + 上线准备 | — | ⏳ 进行中 |

---

## 八、待办（上线前）

- [ ] Stripe 测试模式端到端验证
- [ ] 自定义域名配置
- [ ] 生产环境 PASSWORD_SALT 设置
- [ ] SDK 发布到 npm
- [ ] 限流升级为 Durable Objects (可选)
- [ ] sessionStorage API Key 改为一次性显示 (可选)

---

## 九、Git 统计

- **总提交**: 27+
- **总 Worker 服务**: 21
- **Dashboard 页面**: 15
- **D1 Schema 文件**: 9
- **核心 API 代码**: ~1,500 行
- **i18n 翻译**: 120+ keys (中/英)
- **依赖**: 全部宽松许可 (MIT/Apache/BSD/ISC)

---

*本文档由 Nuxon 4 OS 开发团队维护。版权所有 (c) 2024-2026 CL-j-nc.*
