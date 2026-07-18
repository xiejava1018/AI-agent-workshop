# OpenClaw 技术架构详解

## 一句话定位

Pi Agent 是"引擎"，OpenClaw 是"产品层"。OpenClaw 基于 Pi Agent SDK（`@mariozechner/pi-coding-agent`，TypeScript 智能体引擎）构建，把一个面向终端的编码智能体包装成可自托管、多通道、带控制平面的个人/团队 AI 助手运行时。`openclaw` 命令启动一个常驻 Gateway，背后以**进程内嵌入**方式调用 Pi 的 `AgentSession` 完成思考与工具执行。

## 整体分层

从源码视角（`src/`）自上而下：

```
CLI 层            entry.ts → run-main.ts → command-registry（命令注册/快路径）
Gateway 层        常驻控制平面：WebSocket · HTTP · 通道管理 · 节点管理 · 事件流
Channel/Routing/Plugin 层   多通道适配 · 8 级路由 + sessionKey · manifest 能力注册
Auto-Reply / Agent 执行层    dispatch → get-reply → agent-runner → embedded PI
AI Provider 层     Anthropic · OpenAI · Ollama · Bedrock · Gemini · Copilot …
基础设施层         Nodes · Canvas · Config(TOML) · Sessions(JSONL) · Security · Cron · Daemon
```

主线数据流：聊天软件收到消息 → Gateway 接住 → Routing 解析出 agent + sessionKey → Agent 执行层经 Lane 排队调 Pi 引擎 → 模型生成回复 → 经 Channel 回发。Gateway 是"总服务台"，Control UI / CLI / Channel / Node 全部连到它，Agent 在背后调用模型、工具与记忆。

## 与 Pi Agent 的集成方式（关键）

集成模型不是子进程、也不是 RPC，而是**进程内直接 import 并实例化 Pi 的 `AgentSession`**。官方文档原文："Instead of spawning pi as a subprocess or using RPC mode, OpenClaw directly imports and instantiates pi's `AgentSession` via `createAgentSession()`."

复用的 Pi 包（`docs.claw.so/engine/pi/`，scope `@mariozechner/*`，v0.49.3）：
- `pi-ai`：LLM 抽象（`Model`、`streamSimple`、provider API）
- `pi-agent-core`：Agent loop、工具执行、`AgentMessage`
- `pi-coding-agent`：`createAgentSession`、`SessionManager`、`AuthStorage`、`ModelRegistry`、内置工具
- `pi-tui`：本地 TUI 组件

主入口 `runEmbeddedPiAgent()`（`src/agents/pi-embedded-runner/run.ts`）传入 `{ cwd, agentDir, authStorage, modelRegistry, model, thinkingLevel, systemPrompt, tools, customTools, sessionManager, settingsManager, skills, contextFiles, additionalExtensionPaths }`，随后 `session.prompt(...)`。进程内嵌入带来完整生命周期控制、自定义工具注入、每通道系统提示词、会话持久化（分支/压缩）、多账号 Auth 轮换等能力。

## Gateway 控制平面

默认监听 `127.0.0.1:18789`，同时暴露 WebSocket（主控制协议）与 HTTP（Control UI、Hooks 回调、工具调用、Webhook、OpenResponses）。源码 `src/gateway/server.impl.ts`、`server/ws-connection.ts`、`server-methods.ts`。

四层 WS 协议（官方证实）：
1. 连接层（`ws-connection.ts` + `message-handler.ts`）：握手认证、Challenge/Response、10s 握手超时。
2. 协议层（`gateway/protocol/index.ts`）：AJV 帧结构校验、统一错误码。
3. 方法层（`server-methods.ts`）：`authorizeGatewayMethod(role, scope)` 鉴权 + 方法分发。
4. 事件层（`server-broadcast.ts` + `server-chat.ts`）：流式事件广播、慢消费者丢弃、幂等缓存。

三个"总闸"：连接总闸（`connect` 握手）、权限总闸（role/scope）、带宽总闸（`MAX_PAYLOAD_BYTES`）。承载角色：Control UI、CLI、Channel、Node（`role:"node"`，仅允许 `node.*` 方法）、事件流。配置热重载由 `startGatewayConfigReloader` 监听文件变化，能热更的走 `applyHotReload`，否则请求进程重启。

## Channel 层

通道以 `registerChannel({ id, label, start, stop, send })` 能力注册形式进入系统；核心（会话/路由/权限/回复流）由 OpenClaw 负责，平台协议细节（Telegram Bot API、Slack Socket Mode、Matrix homeserver 等）由插件承担，通过 `openclaw.plugin.json` 声明。

官方 + 插件覆盖：Telegram、WhatsApp、Discord、Slack、Google Chat、Signal、BlueBubbles、WebChat，以及 Matrix / Mattermost / Teams / LINE / Zalo / QQ / WeChat（插件）。`accountId` 是一级实体，同一通道可跑多账号、故障隔离。官方口径为"20+ 平台"（社区列出约 20 个），"25+"属社区/营销说法。

## Routing 层

`src/routing/` 把入站消息稳定映射到"Agent + Session"。8 级优先级（高→低）：
1. peer（私聊对象 ID） 2. parent peer（线程/回复链） 3. guild+roles 4. guild 5. team 6. account 7. channel 8. default agent。

`sessionKey`（`src/routing/session-key.ts`）格式：私聊 `agent:{agentId}:{channel}:{accountId}:direct:{peerId}`；群/频道 `agent:{agentId}:{channel}:{accountId}:{peerKind}:{peerId}`（`peerKind = direct|group|channel|thread|...`）。作用三合一：串联同会话历史上下文、作为 Lane 并发隔离的键、定位存储文件分区。

## Agent 执行层（Auto-Reply）

流水线 `src/auto-reply/` + `src/agents/`：`dispatch.ts`（typing/block/final 事件、资源释放）→ `dispatch-from-config.ts`（去重、Hooks、TTS）→ `get-reply.ts`（路由解析、`/think`/`/model`/`/reset` 指令、媒体预处理）→ `get-reply-run.ts`（系统前缀、队列策略、thinking 等级）→ `pi-embedded-runner/run.ts`（Lane 排队、模型选择、执行循环）→ `run/attempt.ts`（真实 LLM 调用+工具执行）→ `pi-embedded-subscribe.ts`（流式分离）→ `model-fallback.ts`。

Lane 并发模型（官方证实）：每 Session 独占一个 Session Lane，所有 Session 共享一个 Global Lane；由 `concurrency`（最大并发）与 `maxPending`（最大排队）控制。QueueMode：`interrupt`（中断当前 run）/ `steer`（追加到当前 run 上下文）/ `steer-backlog` / `followup`（等当前 run 结束）/ `collect`（合并批处理防抖）/ `queue`（普通排队）。

上下文守护（官方证实）：`src/agents/context-window-guard.ts` 定义 `CONTEXT_WINDOW_HARD_MIN_TOKENS = 16000`（硬红线，触发拒绝）与 `CONTEXT_WINDOW_WARN_BELOW_TOKENS = 32000`（软告警，触发压缩）。配套 Pi 扩展：`compaction-safeguard`（自适应 token 预算 + 工具/文件摘要）与 `context-pruning`（基于 Cache-TTL 剪枝），路径推入 `createAgentSession` 的 `additionalExtensionPaths`。默认超时 `agents.defaults.timeoutSeconds = 600`。

## Tool 架构层

以 `exec`/`process` 替换 bash（官方证实）：`createOpenClawCodingTools()` 配合 `bash-tools.ts` 在传入 `AgentSession` 前覆盖 Pi 的 `bash` 工具；`read/edit/write` 走沙箱定制。`splitSdkTools()` 统一策略过滤：返回 `{ builtInTools: [], customTools: toToolDefinitions(tools) }`——所有工具都经 `customTools` 注入，使策略过滤、沙箱、扩展工具集跨 provider 一致；`toToolDefinitions()` 做 `AnyAgentTool[] → ToolDefinition[]` 转换。

新增 OpenClaw 工具（`src/agents/tools/`）：`messaging`、`browser`、`canvas`、`sessions`、`cron`、`gateway`；渠道专属工具经 `channel-tools.ts` 注入（discord/telegram/slack/whatsapp-actions）。装配后由 `pi-tools.policy.ts`（allowlist/denylist）按 profile/provider/agent/group/sandbox 过滤，再经 schema 归一化、AbortSignal 包裹。沙箱作用于工具执行，不作用于 Gateway 进程本身。

## Session & Auth 层

基于 Pi 的 `SessionManager`（JSONL 持久化），`src/config/sessions/store.ts` 按 `sessionKey` 分区。多 Auth Profile 轮换由 `model-fallback.ts` 的 `runWithModelFallback()` 实现：遍历候选 profile → 执行 → 限流/认证失败则标记冷却、轮换下一 → 全失败返回错误。`FailoverError`（`src/agents/failover-error.ts`）是模型回退类，携带 `{ reason, provider, model, profileId, status }`，`classifyFailoverReason()` 返回 `auth|rate_limit|quota|timeout|...`。上述压缩扩展即在此层挂载。

鉴权层级：`authorizeGatewayMethod()` 实施 RBAC——角色 `operator`/`node`；`operator` 细粒度 scope = `operator.read`/`write`/`admin`/`approvals`/`pairing`。陌生来源消息进入配对审批流（配对码 → approve/reject），危险工具（如 bash）可按规则要求人工审批。敏感操作写入 `src/security/audit.ts` 审计日志。

## 记忆 / Skills / 部署

记忆（`src/memory/`）作为 sidecar：长期记忆以 workspace 文件为基础，主要是 `MEMORY.md` 与 `memory/YYYY-MM-DD*.md`，叠加 memory search、active memory、dreaming、memory wiki 等检索/整理路径。社区文章还列 `SOUL.md`/`IDENTITY.md`/`HEARTBEAT.md`/`USER.md`/`AGENTS.md`/`BOOTSTRAP.md`/`TOOLS.md` 作为人格/身份/配置文件（四件套为社区验证，官方架构文档未逐条列名）。

Skills / ClawHub（`src/agents/skills.ts`）：技能核心是 `SKILL.md`（YAML 元数据 + 指令）。官方 CLI 规范命令是 `openclaw skills install <slug>`（插件用 `openclaw plugins install clawhub:...`）；社区文章出现的 `npx clawhub install` 为社区口径。

Cron（`src/cron/`）定时任务；RBAC 与审计见上；`src/daemon/` 支持 Linux systemd、Windows schtasks，含 PID 管理、`SIGTERM → drain → close` 优雅关停；`src/config/io.ts` 为 TOML 配置，支持热重载；部署形态包括 Docker、`systemd`/daemon 守护、nginx/caddy 反向代理 + TLS 外网暴露，单机默认 `~/.openclaw/{config.toml, sessions/, workspace/}`。

## 技术栈

- 语言/运行时：TypeScript + ESM。Node 版本官方安装文档记为 Node 22.22.3+ / 24.15+ / 25.9+，推荐 Node 24（社区源码导读记为 22.12+，以官方为准）。启动器 `openclaw.mjs` 校验版本后 respawn 到 `src/entry.ts`。
- 包管理：pnpm。
- 前端：`ui/src/` 为控制台 Web UI（Vite 风格入口，Web Components/原生组件，含 service worker 与 i18n），仅作为 Gateway 操作面，经 WS 协议调用后端。
- 通信协议：Gateway 客户端 `ws://127.0.0.1:18789`，使用版本化 JSON 帧（`EventFrame`/`RequestFrame`/`ResponseFrame`/`HelloOk`/`PROTOCOL_VERSION`）；错误类型 `GatewayClientRequestError` 携带 `gatewayCode/details/retryable/retryAfterMs`；HTTP 承载 Control UI、Hook、工具调用、Webhook、OpenResponses。另可扮演 ACP bridge / ACP agents / MCP 角色。

## 对"重建 MateClaw"的架构启示

OpenClaw 的架构本身就是一份现成的"Pi Agent 产品层"蓝图：Gateway（WS 控制面 + 四层协议）、Channel（20+ 渠道 adapter）、Routing（sessionKey 隔离）、Agent 执行（Lane 并发 + 16K/32K 上下文守护）、Tool（splitSdkTools 统一沙箱）、Session&Auth（JSONL + 模型回退 + RBAC + 审计）、记忆/Skills/Cron/daemon 一应俱全。你用 Node + Vue 重建时，这套分层可直接对齐——只需把 OpenClaw 的 TUI/原生 Web UI 换成 Vue，并把 MateClaw 专属的工作流 DSL、6 pattern 触发器、LLM Wiki 知识库、per-agent MCP、Dreaming 整合补进对应层。

## 可信度标注（重要）

| 项 | 标注 |
|---|---|
| 端口 18789、四层 WS 协议、8 级路由、Lane/QueueMode、上下文守护 16K/32K、splitSdkTools、compaction-safeguard/context-pruning、FailoverError | 高可信（官方架构/引擎文档证实） |
| 包作用域 `@mariozechner/pi-coding-agent`（v0.49.3） | 与较新版 `@earendil-works/*`（v0.80.7）冲突，OpenClaw 锁旧版，fork 时留意 |
| 渠道数 "25+" | 中：官方口径 "20+" |
| GitHub 18 万+ Star / MIT | 中低：无法独立从 GitHub 核实 |
| MEMORY/SOUL/IDENTITY/HEARTBEAT 四件套 | 中：官方仅确认 `MEMORY.md` 与 `memory/YYYY-MM-DD*.md` |
| `npx clawhub install` | 低：官方规范为 `openclaw skills install <slug>` |
| Node 版本 | 以官方 `install/node` 为准（22.22.3+/24.15+/25.9+，推荐 24） |

## 参考来源

1. [Pi Integration Architecture | Claw（官方文档）](https://docs.claw.so/engine/pi/)
2. [OpenClaw 系统架构详解（中文文档）](https://openclaw-docs.dx3n.cn/tutorials/concepts/system-architecture)
3. [智能体循环 Agent Loop（中文文档）](https://openclaw-docs.dx3n.cn/tutorials/concepts/agent-loop)
4. [架构 · OpenClaw — AgentWay](https://agentway.dev/zh/openclaw/architecture)
5. [OpenClaw 源码导读：网关、通道、插件与运行时（gu.log）](https://liangqianxing.github.io/posts/openclaw-source-code-analysis/)
6. [Node.js 安装要求（官方文档）](https://docs.openclaw.ai/install/node)
7. [Skills — OpenClaw 官方 CLI 文档](https://docs.openclaw.ai/cli/skills)
8. [Chat channels — OpenClaw 官方文档](https://docs.openclaw.ai/channels)
9. [OpenClaw 完全指南：7 个 MD 文件 + 12 个核心目录（知乎）](https://zhuanlan.zhihu.com/p/2017732228092814019)
