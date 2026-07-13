---
title: "pi-web"
date: 2026-07-05
type: entity
tags: [coding-agent, agent-harness, pi-webui, nextjs, react, llm, open-source]
summary: "Pi coding agent 的本地 Web UI（agegr 出品，1k star）；Next.js + React 前端，复用 pi-coding-agent SDK 以 in-process AgentSession + SSE 驱动，给 Pi 的 TUI 补一个浏览器工作台"
lastReviewed: 2026-07-05
---

# pi-web

## 基本信息

- **类型**：开源 Web UI（产品，[[pi]] 的前端增强，非 fork）
- **出品**：agegr（GitHub `agegr`）
- **对象**：[badlogic/pi-mono](https://github.com/badlogic/pi-mono)（即 Mario Zechner 的 [[pi]]）
- **定位**："Web UI for the pi coding agent"——给 Pi 的 TUI 补一个浏览器工作台
- **License**：MIT
- **npm**：`@agegr/pi-web`（`npx @agegr/pi-web@latest` 或 `npm i -g` 后 `pi-web`）
- **默认端口**：30141（`localhost`）
- **仓库**：https://github.com/agegr/pi-web

## 关键事实

| 维度 | 数据 |
|---|---|
| ⭐ Stars / 🍴 Forks | **1,010 / 201**（2026-07-05） |
| 创建 / 最近推送 | 2026-03-22 / 2026-07-04（活跃） |
| 主语言 | **TypeScript**（Next.js 16 + React 19） |
| 是否 fork | ❌ **独立仓库，非 fork**——依赖 pi 的 npm 包，不改 pi 源码 |
| 版本 | 0.7.8 |
| 核心依赖 | `@earendil-works/pi-ai` ^0.80.3 · `@earendil-works/pi-coding-agent` ^0.80.3 |
| 数据源 | `~/.pi/agent/sessions`（pi 默认会话目录），可用 `PI_CODING_AGENT_DIR` 改 |

## 与 Pi 的关系（核心）

**pi-web = Pi 的 Web 前端皮肤**，与 [[oh-my-pi]] 的"fork 改内核"路线完全不同——它**不动 pi 的源码**，而是把 pi 的两个 npm 包（`pi-coding-agent` + `pi-ai`）作为 SDK 直接 import 进 Next.js 服务端，在进程内创建 `AgentSession` 驱动 agent：

```
Browser  ↔  Next.js Server  ↔  AgentSession (in-process, pi-coding-agent SDK)
                              ↔  读取 ~/.pi/agent/sessions/*.jsonl
```

- **会话浏览（只读）**：直接读 pi 的 `.jsonl` 会话文件（`<encoded-cwd>/<timestamp>_<uuid>.jsonl`），不创建 AgentSession
- **发消息驱动 agent**：`startRpcSession()` 在 Next.js 进程内 `createAgentSession()`，通过 SSE 把 agent 事件推回浏览器
- **模型/skill 配置**：读写 pi 的 `models.json` 与 skill 开关——和 CLI 完全共用配置

所以 pi-web **不替换 pi，而是给 pi 加一个浏览器入口**，CLI 和 Web 读同一份会话、同一份配置，可来回切换。

## 核心功能（README）

- **会话续接**：按项目浏览历史 pi 会话，不用翻终端历史
- **安全分叉**：从某条消息继续，或 fork 成独立会话路线（fork = 新 `.jsonl`；"Edit from here" = 同文件内分支）
- **跨 worktree**：侧栏切换 Git worktree，新会话和文件浏览器跟随 checkout
- **边聊边看代码**：左侧文件树，右侧预览源码/文档/图片/音频/PDF
- **会话状态可见**：顶栏显示上下文用量、成本、compaction 状态、系统提示
- **少在终端配置**：Web UI 管理模型、登录/API key、模型测试、skill 开关

## 技术栈

- **框架**：Next.js 16.2.9（App Router，API Routes 做 SSE）+ React 19
- **样式**：Tailwind CSS 4
- **Markdown**：react-markdown + remark-gfm/math + rehype-katex/raw/sanitize（支持 Mermaid、KaTeX）
- **预览**：mammoth（DOCX）、react-syntax-highlighter、图片/音频/PDF
- **图标**：@lobehub/icons
- **注意**：dev 期禁止 `next build`（污染 `.next/` 影响 dev server）

## 与 oh-my-pi 的对照（都在 Pi 生态里做前端/协作）

| 维度 | [[oh-my-pi]] | **pi-web** |
|---|---|---|
| 形态 | Pi 的 **fork**（改内核，~55k 行 Rust） | Pi 的 **Web 前端**（不改内核，纯 Next.js） |
| 集成方式 | 替换 pi 的 TS 实现 | import pi 的 npm 包做 SDK，in-process 调用 |
| 运行时 | Bun + Rust N-API addon | Node/Next.js（标准 Web 栈） |
| 协作能力 | collab（relay + QR + 浏览器只读观看） | 本地 Web UI（单用户浏览器工作台） |
| 定位 | "满血性能 fork"，IDE 焊接 | "给 TUI 加个浏览器皮肤"，零侵入 |
| 改 pi 源码 | 是（深度改） | **否**（只依赖，不改） |

一句话：**oh-my-pi 重写内核求极致，pi-web 不碰内核求共存**。两者可视为 Pi 生态的两条互补增强路线。

## 对 AI-miniSOC 的启示

pi-web 验证了一个对 AI-miniSOC 很重要的模式：**用 pi-coding-agent SDK 在 Web 服务端 in-process 驱动 AgentSession + SSE 推流**——这正是 pi-web 的 `app/api/agent/[id]/events` SSE 架构，与 AI-miniSOC 当前"Python 父进程 ↔ Node 子进程 JSON-RPC + SSE"的形态高度一致。区别是 pi-web 用 Next.js 直连 SDK（同进程），AI-miniSOC 用 Python 跨进程（隔离更强）。若未来 AI-miniSOC 要做 Web 端"分析师会话工作台"，pi-web 是最直接的参考实现（会话浏览/fork/文件预览/模型配置全套现成）。

**落地路径**：参考 [[pi-web-multi-tenant-ai-minisoc-design]] —— 4 阶段多租户改造（存储/认证/会话/调度/Admin）+ 3 层嵌入 AI-miniSOC（身份单点 + 上下文桥接 + 同域子路径部署），M1/M2/M3 三里程碑，总工作量 16-22 天。

## 相关概念

- [[pi]] — 直接服务对象，pi-web 依赖其 pi-coding-agent/pi-ai 包
- [[oh-my-pi]] — 同属 Pi 生态，但走 fork 改内核路线（对照）
- [[pi-web-ui-comparison]] — Pi Web UI/前端生态横向对比（pi-web / pi-gui / cate / HolyClaude / omp collab-web）
- [[harness-and-loop-engineering]] — pi-web 属 Harness 工程的"传输/UI 抽象"层（Web 形态），不改 Loop
- [[agent-skills]] — pi-web 的 SkillsConfig 面板读写 pi 的 skill 开关
- [[pi-web-multi-tenant-ai-minisoc-design]] — 把本页"对 AI-miniSOC 的启示"落到具体产品设计的 4 阶段改造 + 3 层嵌入方案

## 来源

- GitHub: https://github.com/agegr/pi-web
- npm: https://www.npmjs.com/package/@agegr/pi-web
- 上游 Pi: [[pi]] / [[sources/pi-agent-harness]]
