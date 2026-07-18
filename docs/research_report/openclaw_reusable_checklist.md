# OpenClaw 产品层可复用清单（基于 Pi Agent + Node.js + Vue 重建 MateClaw）

## 前提：许可证

OpenClaw 采用 **MIT License**（Copyright 2026 OpenClaw Foundation）。MIT 是宽松协议，允许自由使用、复制、修改、合并、再授权与商业闭源分发，唯一硬性要求是**保留版权声明与 LICENSE 文本**。因此你可以直接 fork 后改造，不必仅停留在"参考模式"——但对外分发/商用时务必在产物中保留 OpenClaw 的 MIT 声明与版权头。

复用策略建议：fork OpenClaw 后，砍掉不需要的部分（TUI 终端 UI、非目标渠道、CLI 主导的交互），保留 Gateway / Channel / Routing / Session / Auth / 产品化外壳等模块，把前端替换为 Vue，再补齐 MateClaw 专属特性（工作流 DSL、触发器、知识库、per-agent MCP、Dreaming）。

---

## 一、可直接/改造复用的模块清单

| # | OpenClaw 模块 | 复用方式 | 对应 MateClaw 能力 | 关键说明 |
|---|---|---|---|---|
| 1 | **Gateway 控制平面**（常驻 WebSocket 默认 127.0.0.1:18789 + HTTP，四层 WS 协议：握手→AJV 校验→role/scope 鉴权→事件广播） | 改造复用 | Web 控制台的后端控制面 / SSE 流式通道 | 它是 TS，与你的 Node 栈同语言，可直接改；把它的 TUI/CLI 前端换成 Vue，WS 协议与事件广播机制原样复用 |
| 2 | **Channel 层**（官方+插件 25+ 渠道） | 直接复用/改造 | 8 渠道 IM 接入 | 钉钉、飞书、企业微信、微信、Telegram、Discord、QQ、Slack 等多在其中；这是最值钱的复用点，MateClaw 要的 8 渠道基本能找到现成 adapter 或对等实现 |
| 3 | **Routing 层**（8 级优先级路由 peer→guild→team→account→channel→default，`sessionKey` 并发隔离与持久化分区） | 直接套用 | 多员工/多会话路由与隔离 | sessionKey 隔离模式可直接抄，避免自研踩坑 |
| 4 | **Auto-Reply / Agent 执行层**（Lane 并发模型：每 session 独占 Lane + 全局 Lane；QueueMode：interrupt/steer/collect/queue；上下文守护硬红线 16K / 软告警 32K token） | 直接复用模式 | 并发调度 + 上下文守护 | Lane 模型与 token 红线是生产必踩的坑，OpenClaw 已验证 |
| 5 | **Tool 架构层**（用 exec/process 替换 bash、定制 read/edit/write 走沙箱；`splitSdkTools()` 把工具全走 `customTools` 统一策略过滤与沙箱；新增 messaging/browser/canvas/sessions/cron/gateway 及渠道专属工具） | 改造复用 | 工具生态 + Tool Guard 沙箱 | 你用 Pi 的 `defineTool` + `beforeToolCall`/`afterToolCall` 钩子，可借鉴 `splitSdkTools` 的统一过滤/沙箱思路 |
| 6 | **System Prompt 构造层**（`buildAgentSystemPrompt()` 动态拼装 Tooling / Safety / CLI / Skills / Sandbox / Messaging） | 参考复用 | 数字员工人设/系统提示拼装 | 拼装顺序与分段模板可直接抄，改为对齐你的员工模型 |
| 7 | **Session & Auth 层**（基于 Pi 的 `SessionManager` JSONL，叠加多 Auth Profile 轮换 + `FailoverError` 模型回退；`compaction-safeguard` / `context-pruning` 两个 Pi 扩展） | 改造复用 | 会话持久化 + 多模型故障转移 + 上下文压缩 | JSONL→Postgres 改造由你做；多 Auth 轮换与模型回退逻辑直接复用；两个压缩扩展可原样引入 |
| 8 | **产品化外壳** | 分块复用 | 记忆/定时/审批/审计/部署 | 见下条拆分 |
| 9 | **Skills 体系**（社区 200+ 预置，ClawHub 市场 `npx clawhub install`；`SKILL.md` 格式） | 复用格式 | Skills 技能系统 | `SKILL.md` 与 MateClaw 的技能格式一致，可直接互通；ClawHub 安装分发思路可借鉴（MateClaw 用 `SKILL.md`+`LESSONS.md` 双文件，你可选型） |
| 10 | **守护进程 + 配置热重载**（TOML 配置、daemon 模式、systemd/Docker 部署） | 直接复用 | 部署与运维 | Vue 静态由 Node 服务托管，模式同 MateClaw"一个进程服务两端" |

---

## 二、产品化外壳的可复用子项

| 子项 | 复用方式 | 对应 MateClaw | 说明 |
|---|---|---|---|
| 四层记忆文件（MEMORY / SOUL / IDENTITY / HEARTBEAT.md） | 改造对齐 | AGENTS/SOUL/PROFILE/MEMORY + DREAMS + 每日笔记 | 文件记忆范式可直接套；字段名按你的四层模型重映射，补上 DREAMS.md 与每日笔记 |
| Cron 定时（HEARTBEAT.md 驱动） | 改造复用 | 触发器 Trigger 的 cron pattern | OpenClaw 的 Cron 是触发器子集，扩到 6 pattern 需自建其余 5 种 |
| 审批 RBAC（role+scope：operator.read/write/admin/approvals/pairing） | 扩展改造 | Workspace RBAC + Tool Guard 审批 | OpenClaw 偏个人；扩为企业级 Owner/Admin/Member/Viewer + JWT + 审计需自建 |
| 审计日志 | 直接复用 | 审计 | 事件/操作留痕机制可直接用 |
| 多 Auth Profile 与 Failover | 直接复用 | 14+ 模型故障转移 | 见模块 7 |

---

## 三、OpenClaw 没有、必须从 MateClaw（Java）或自研补齐的部分

这些是 OpenClaw 产品层缺失、而 MateClaw 具备的特性，复用清单之外需重点自研：

1. **工作流 DSL（7 种 step mode：sequential / fan_out / collect / conditional / await_approval / dispatch_channel / write_memory）**——OpenClaw 无工作流引擎，需自建（设计可参考 MateClaw 的"线性 step 数组 + mode 字段"轻量 DSL）。
2. **触发器 6 种 pattern（cron / webhook / channel_message / agent_lifecycle / content_match / workflow_completion）**——OpenClaw 仅 Cron+HEARTBEAT，其余 5 种需自建；多实例部署用 Redis 锁或 ShedLock 式机制防重复触发。
3. **LLM Wiki 知识库（结构化双向链接页面 + 溯源 + Transformations 加工）**——OpenClaw 只有 Canvas + 记忆，需自建 RAG/结构化知识层。
4. **per-agent MCP 绑定（工具不跨员工泄漏）**——Pi 的 `pi-mcp-extension` 提供 MCP 客户端，但 per-agent 隔离逻辑要自己写（对齐 MateClaw 1.3.0+）。
5. **Dreaming 夜间整合**——OpenClaw 有四层记忆但无"每天凌晨整合近 7 天笔记→更新 MEMORY.md"的 Dreaming 机制，需自建定时任务。

---

## 四、工程范式与已验证的坑（照着做能省大量时间）

- **包管理用 pnpm 而非 npm**；**Node ≥ 22**。
- **源码分层**：`ui / gateway / core / runtime / cli`，优先实现 `Plugin` 接口扩展，**不要改核心**。
- **适配国产模型**：实现统一 `ModelAdapter` 接口、严格对齐 `ModelResponse` 格式，否则 Core 解析失败。
- **部署**：Docker socket 权限用 `usermod -aG docker`（漏 `-a` 会丢组）；网关默认绑 `0.0.0.0:18789` 要锁 `loopback`；危险命令用**白名单**而非黑名单。
- **配置严禁交给 AI 自动改**（曾因模型"讨好型人格"编造非法值导致进程死锁崩溃）——给最小权限、人肉改配置。
- **模型静默 fallback 陷阱**：务必在后台记录并展示实际 model 字段，避免偷偷转模型烧钱。
- **巨型 Session 导致 HTTP 400**：需定期 reset 与压缩；`compaction-safeguard` / `context-pruning` 两个扩展已解决此问题，直接引入。
- **记忆向量若缺 embedding key 会降级为文本匹配**：保证 key 配置完整。
- **飞书发图片极难**：必要时刻用 `exec` 直调 API 兜底。

---

## 五、复用优先级建议

最高杠杆（直接 fork 复用，省时最多）：Gateway 控制面、Channel 层（国内渠道）、Routing/sessionKey、Lane 并发与上下文守护、Session & Auth 的模型回退、四层记忆文件范式、Skills 的 SKILL.md 格式、守护进程/部署。

需改造（模式复用 + 适配你的模型）：System Prompt 拼装、Tool 架构的 splitSdkTools、审批 RBAC 扩企业级、Cron→6 pattern 触发器。

必须自研（OpenClaw 缺失）：工作流 DSL、触发器其余 5 pattern、LLM Wiki 知识库、per-agent MCP 隔离、Dreaming 整合。

总体判断：OpenClaw 产品层覆盖了"重建 MateClaw"约 60%-70% 的工程量（尤其渠道、并发、会话、记忆、部署这些最繁琐的部分），剩下的 30%-40%（工作流、触发器、知识库、Dreaming、企业级 RBAC）才是真正要自己写的差异化代码。这也是上一轮估算"fork OpenClaw 改造可把 5-8 个月压到 3-5 个月"的依据。
