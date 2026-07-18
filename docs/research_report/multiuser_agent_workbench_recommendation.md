# 多用户 AI Agent 工作台：技术选型与架构建议

## 直接结论

针对你的需求——用户注册登录后拥有独立 workspace、在 workspace 里调用 Agent 能力（多 Agent 编排、工具/MCP、记忆、技能），前端用 Vue3——我的建议是：

**以 Pi Agent 作 Agent 引擎 + 自建 NestJS/Fastify 多租户后端 + Postgres（行级安全 RLS）+ Vue3 前端**。这条路线 JS/TS 技术栈统一、对多租户隔离有完全控制权、没有开源协议雷区，且 Pi Agent 已被 OpenClaw 验证过工程可行性。

**不要把 OpenClaw 直接当多用户底座**——它是个人/单机向的产品，原生 RBAC 不是终端用户多租户。但你可以把它当作"单租户内核的架构参考"，把它验证过的 Gateway、Lane 并发、上下文守护、工具沙箱、会话管理等模式，封装进你自己每 workspace 隔离的多租户壳里。

**想最快验证 MVP**：可用 Dify 作后端 API + 自写 Vue3 前端（多用户体系最成熟），但要先厘清其许可证对"多租户服务"的商业授权要求（见下文风险）。

## 一、为什么 OpenClaw 不能直接扛多用户

这是最关键的事实，决定了前述"复用 OpenClaw 产品层"的建议需要加一个前提。OpenClaw 官方文档明确：它的 RBAC 是 operator/node scope，"是单个可信 Gateway 运维域内的护栏，而非面向终端用户的多租户隔离；要在人与人/团队/机器之间做强隔离，应为每个租户运行独立的 Gateway（独立 OS 用户或主机）"。换句话说，OpenClaw 的角色只有 `operator`（控制面）/ `node`（能力主机）两类，scope 是 `operator.read/write/admin/pairing/approvals`，它解决的是"谁能动 Gateway"，不是"用户 A 看不到用户 B 的数据"。

Pi Agent 本身是一个可嵌入的 TypeScript/Node 库（`createAgentSession`、`ModelRuntime`、`SessionManager`、`InMemoryCredentialStore`），文档未提供任何内建多租户抽象。因此正确的姿势是：用 Pi Agent 当引擎，自己写一个多租户后端来编排"每用户/每 workspace 的独立空间、独立密钥、独立配额、独立数据"。

## 二、成熟框架对比（面向多用户 Agent 平台）

| 框架 | 原生多用户/多租户 | 技术栈 | 自托管 | 协议 | 自定义 Vue3 前端 |
|---|---|---|---|---|---|
| **Pi Agent + 自建后端** | 需自建（引擎无租户抽象） | TypeScript/Node | 是 | MIT 类宽松 | 是（全自研前端） |
| **Dify** | ✅ 原生（Account/Tenant=workspace/TenantAccountJoin，JWT+Redis，角色 OWNER/ADMIN/EDITOR/NORMAL，OAuth） | Python + Next.js | 是 | 修改版 Apache 2.0（多租户服务需商业授权） | ✅ 每应用即 REST API |
| **LangGraph Platform** | ⚠️ 需自建（每次请求自定义鉴权 + 资源级 owner 授权） | Python | 库可自托管；Platform 商业 | 库 MIT；Platform 付费 | ✅ 有 JS SDK，鉴权仅 Python 完善 |
| **n8n** | ⚠️ 团队/项目 RBAC，非终端用户租户；RBAC 仅付费计划 | Node.js | 是 | fair-code（非标准开源） | ✅ REST API，但偏自动化编排 |
| **Mastra / VoltAgent / Agno** | ❌ 开发者向框架，无内建多用户平台 | Mastra/VoltAgent 为 TS | 库级开源 | MIT/Apache | ⚠️ 需自建用户体系与网关 |

结论：平台级多用户开源项目里 Dify 最成熟，但它是 Python + 自带前端，且许可证对多租户服务有商业约束；Pi Agent 是 TS 引擎、无租户包袱、最适合你"Vue3 前端 + 自己掌控后端"的设想；Mastra 是 Pi Agent 的 TS 同生态替代引擎，可作为备选。

## 三、推荐架构（Pi Agent 引擎 + 多租户后端 + Vue3）

分层如下：

身份与租户层（NestJS）：注册/登录，JWT access + refresh（refresh 存 Redis 可主动注销），密码 bcrypt/argon2，可选 OAuth（GitHub/Google）。登录后解析出 `tenant_id`/`workspace_id`，后续所有操作强制带该上下文。

Workspace 隔离层：每个用户拥有一个 workspace，内含自己的 agents、sessions、memory 文件、skills、files、API keys、配额。Pi Agent 的 `cwd`（工作区目录）与 `agentDir`（配置）按 workspace 区分，`sessionKey` 编码进 `tenantId + workspaceId + userId`，作为并发隔离键与存储分区键。

Agent 引擎层：每个请求用 Pi Agent 的 `createAgentSession` 在进程内创建会话，运行时注入该 workspace 的凭证（`setRuntimeApiKey` / `InMemoryCredentialStore` 按请求覆盖），工具/MCP 经 `defineTool` + 钩子接入审批沙箱。复用 OpenClaw 验证过的模式：Lane 并发（同 session 串行、每 workspace 全局并发封顶 3-5）、上下文守护（硬 16K / 软 32K）、`splitSdkTools` 统一沙箱过滤。

持久化层：Postgres，每张租户表加 `tenant_id`/`workspace_id` 列，并用 RLS（Row-Level Security）做数据库层兜底——即使应用层出 bug，也读不到别的租户数据。向量库（pgvector / Qdrant）按 `tenant_id` 命名空间隔离 collection。

网关与流式层：NestJS 暴露 REST（管理接口）+ WebSocket/SSE（流式推 Vue3）。注意 Pi Agent 的流式只在进程内事件订阅，SSE/WS 网络层必须自建（参考 OpenClaw 的 Gateway 四层 WS 协议）。

前端层（Vue3 + TS + Pinia + Element Plus + Tailwind）：登录/注册页、workspace 仪表盘、Agent 目录、工作台（聊天/任务流）、记忆查看器、技能管理、设置（API Key、配额）、监控。构建产物内嵌进 Node 服务静态目录，做到"一个进程服务两端"。

## 四、多租户隔离要点（防踩坑）

数据隔离采用"单库单 schema + 每表 `tenant_id` + Postgres RLS"的共享 schema 模式，所有会话/记忆/文件/向量记录都带 `tenant_id`，RLS 作第二道防线。

密钥策略推荐"平台统一 Key + 每用户配额为主，BYO Key 可选覆盖为辅"。Pi Agent 支持运行时注入 `setRuntimeApiKey` / `InMemoryCredentialStore`，天然适配 BYOK；配额对 token、每日调用次数、并发数做限制。

并发与配额利用 Pi 两级队列：同会话严格串行（保上下文一致），每 workspace 全局并发封顶 3-5（工程经验值，非文档硬值），超额排队（collect/queue 模式），并对 token 与日调用数限额。

防跨用户泄漏的铁律：所有 DB 查询强制按 `tenant_id`/`sessionKey` 过滤；`tenantId` 一律由服务端会话推导，绝不信任客户端传入；API Key 只存后端，前端经你自己的网关转发到引擎；RLS 兜底拦截越权读。

## 五、实施路径（分期）

阶段 0（2 周，技术验证）：NestJS + Vue3 骨架；Pi Agent `createAgentSession` 跑通单会话流式 + 1 工具 + 1 模型；Postgres 连通。

阶段 1（4-6 周，MVP 多用户闭环）：注册/登录/JWT、workspace 创建、每 workspace 独立 session + 记忆文件、基础 Vue3 工作台、Postgres 持久化 + `tenant_id` 隔离。

阶段 2（6-8 周，Agent 能力）：多 Agent 编排（Supervisor + 委派树）、Skills、MCP 接入、工具审批沙箱、BYOK + 配额、RLS 加固。

阶段 3（6-8 周，平台化）：工作流 DSL + 触发器、知识库、监控大盘、审计、Docker Compose 部署与加固、并发/配额治理。

合计约 5-8 个月（2-3 人全栈）；若只做"调用单 Agent + 基础多用户"，MVP 可压到 6-10 周。

## 六、风险与提醒

Dify 许可证雷区（重要）：langgenius/dify 的 LICENSE 规定，若用其源码"运行多租户服务"，除非获得 Dify 书面授权，否则须购买商业许可。仅以"调用其已发布应用的 REST API"形式对接风险较低，但商用前务必与法务/官方确认——这也是我更推荐自建 Pi Agent 后端而非"套 Dify 源码"做 SaaS 的原因。

OpenClaw 不可直接多租户（已证实）：见第一节，跨用户隔离需分 Gateway 或自建壳。

Pi Agent 版本漂移：OpenClaw 锁的是 `@mariozechner/pi-coding-agent` v0.49.3，最新为 `@earendil-works/*` v0.80.7，fork/改造时对齐版本与 API。

并发上限 3-5 是工程经验值，文档只说全局 lane "可配置"，不是写死默认值；实际按服务器内存与模型延迟调优。

## 七、一句话建议

用 Pi Agent 当引擎、NestJS 写多租户后端、Postgres+RLS 做隔离、Vue3 做前端；把 OpenClaw 当成"单租户内核的架构样板"而非"多用户底座"。这条路线前期比"套 Dify"多写一些用户体系与隔离代码，但换来完全的自主可控、统一 TS 技术栈、无许可证风险，最适合你要长期拥有的多用户 Agent 工作台。

## 参考来源

1. [Operator scopes - OpenClaw Docs](https://docs.openclaw.ai/gateway/operator-scopes)
2. [SDK · Docs · Pi](https://pi.dev/docs/latest/sdk)
3. [OpenClaw-Book: 7.3 Queue and Concurrency Control](https://www.openclawbook.xyz/en/ch07-piagent-runtime-core/7.3-queue-and-concurrency-control)
4. [User & Workspace Management | Dify (DeepWiki)](https://deepwiki.com/kaznishi/dify/8-user-and-workspace-management)
5. [Dify API 快速开始](https://docs.dify.ai/zh/use-dify/publish/developing-with-apis)
6. [langgenius/dify LICENSE](https://github.com/langgenius/dify/blob/main/LICENSE)
7. [Custom Authentication and Access Control for LangGraph Platform](https://www.langchain.com/blog/custom-authentication-and-access-control-in-langgraph)
8. [Organize work in projects | n8n Docs](https://docs.n8n.io/administer/manage-users-and-access/set-permissions-and-roles-rbac/organize-work-in-projects)
9. [Mastering PostgreSQL RLS for Multi-Tenancy](https://ricofritzsche.me/mastering-postgresql-row-level-security-rls-for-rock-solid-multi-tenancy/)
10. [Mastra vs VoltAgent: TypeScript Agent Frameworks](https://vadimall.com/posts/mastra-vs-voltagent-typescript-agent-frameworks)
