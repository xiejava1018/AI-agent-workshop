# MateClaw 深度研究报告

## 摘要

MateClaw 是一个基于 Spring AI Alibaba 构建的开源多智能体 AI 操作系统（multi-agent AI OS），由 mate.vip 开源项目矩阵推出，2026 年起快速迭代，定位为"自部署的多智能体 AI 操作系统 / 数字员工平台"，主打"一个 JAR 包、数据不出门"。它采用纯 Java/Spring 技术栈，通过 StateGraph 多智能体编排、四层记忆与 Dreaming 自我整合机制、MCP 工具协议、工作流与触发器，把多个数字员工包装成一套可自托管、可治理、可主动触达的 AI 系统。截至 2026 年 7 月，其最新稳定版为 v1.8.0（2026-07-12 发布），采用 Apache-2.0 协议，是 Java 企业技术栈中少见的"自部署多智能体 OS"型开源项目。

## 背景与语境：2026 年的"Claw"智能体浪潮

理解 MateClaw，需要先理解 2026 年的命名语境。微信公众号检索显示，2026 年中文 AI 圈出现了一轮"AI 智能体龙虾大战"，"Claw"（爪/钳，谐音"跨"与"抓"）成为智能体产品的流行后缀，衍生出 OpenClaw（开源基线）、百度 DuMate（搭子）、腾讯 QClaw、智谱 GLM-Claw、Kimi Claw、华为云 OfficeClaw 等一众产品。在这一浪潮中，MateClaw 被社区作者称为"Java 生态的团队龙虾"，其差异化在于：不依赖 Python，而是把整套 Agent 运行时、知识管理、记忆与工具塞进一个 Spring Boot JAR 包，面向已有 Java/Spring 运维体系的企业。需要特别澄清的是，MateClaw 与华为云 OfficeClaw 名称相似但无隶属、品牌或技术关系，二者是完全不同的产品（下文详述）。

## 产品定位与核心概念

MateClaw 的一句话定义是：自部署的多智能体 AI 操作系统。多个 Agent 协作拆解任务、调用工具、积累记忆，一个 JAR 包部署，数据不出门。它与聊天机器人或低代码工作流平台的区别，体现在三个核心概念上。

第一个是"数字员工"（Digital Employee）。每位数字员工拥有角色（Role）、目标（Goal）、背景故事（Backstory）、头像与专属配色，并提供 5 个开箱即用职业模板，管理员可在运行时控制台实时监控 token 占用、强制作废卡住的任务。第二个是"主动型 AI"。区别于被动等待提问的聊天框，MateClaw 的触发器可在每天固定时间把简报推送到飞书/钉钉，或在竞品异动时主动 ping 负责人。第三个是"数据不出门"。所有对话、日志、文档与记忆均留在本地，不上训练队列、不跨公网（除非用户自行接出渠道），这切中了企业合规与数据可控的痛点。

## 技术架构

MateClaw 采用四层架构与五大接入面设计，单个 Spring Boot 进程同时承载前后端。底层多智能体编排建立在 spring-ai-alibaba-graph 的 StateGraph 有向图运行时之上，图节点包含推理、行动、观察、计划生成与步骤执行，条件边负责分发。知识引擎与记忆层由 LLM Wiki 与四层记忆生命周期构成；工具层包含 14 个内置工具、MCP 协议与 Tool Guard 安全护栏；全渠道接入通过 ChannelAdapter SPI 实现。

五大接入面分别是：Web 控制台（SSE 流式）、桌面端（Electron 内置 JRE 21，双击即用）、Webchat 嵌入式组件（UMD/ES）、8 个 IM 渠道（钉钉、飞书、企业微信、微信、Telegram、Discord、QQ、Slack，共享同一大脑、记忆与性格），以及面向第三方的 Plugin SDK。技术栈后端为 Spring Boot 3.5 + Spring AI Alibaba 1.1，MyBatis Plus 持久化，Spring Security + JWT 鉴权，Flyway 管理 schema 迁移，流式走 SSE（明确排除 WebFlux）；前端为 Vue 3 + TypeScript + Pinia + Element Plus + TailwindCSS 4，构建产物内嵌进后端 JAR 的 static 目录。数据库开发期用 H2 文件库，生产用 MySQL 8.0+，官方 Docker 栈已切 PostgreSQL 16。

## 核心功能特性

多智能体编排是 MateClaw 的内核。它提供双推理引擎：ReAct（思考—行动—观察循环，适合即时任务）与 Plan-and-Execute（先计划后分步执行并动态重规划，适合复杂任务）。Agent 之间通过 DelegateAgentTool 互相委派，支持并行委派，子 Agent 委派树最深 3 层，有同步、并行、异步三种方式。

Skills 技能系统采用一份 SKILL.md 加一份 LESSONS.md（用得越多越聪明），提供 8 个起步模板、五步创建向导与安装前 Pre-flight 检查，并支持 MCP/ACP 双桥接（可接入 Claude Code、Codex 作为数字员工）。

记忆与 Dreaming 机制是 MateClaw 最具特色的设计。长期记忆由工作空间内的 Markdown 文件构成并注入 system prompt，包括 AGENTS.md（使用说明书）、SOUL.md（身份人格）、PROFILE.md（用户画像）、MEMORY.md（核心事项），以及不注入的 DREAMS.md（整合审计日记）和每日笔记 memory/YYYY-MM-DD.md。记忆生命周期分为四步：当下回合按 token 预算裁剪、对话后异步提取（消息达 4 条默认触发）、夜间 Dreaming 整合、最后文件注入 system prompt。Dreaming 默认每天凌晨 3:00 自动整合最近 7 天的每日笔记，由 LLM 返回是否更新的结构化决策，更新 MEMORY.md 并追加 DREAMS.md，亦可手动触发；短期记忆为上下文窗口（默认 128000 token，超 75% 触发压缩），向量记忆为可插拔 Provider。

MCP（Model Context Protocol）支持 stdio、SSE、Streamable HTTP 三种传输；1.3.0 起支持 per-agent 绑定，工具不跨员工泄漏；1.7.0 起支持身份转发、进度通知与自修复。

Workflow 工作流（1.3.0 新增）采用线性 step 数组加 mode 字段的轻量 DSL，当前支持 7 种 step mode：sequential、fan_out、collect、conditional、await_approval、dispatch_channel、write_memory；提供 JSON 优先的 Monaco 编辑器，不熟悉 DSL 的用户可用自然语言生成工作流草稿。

Trigger 触发器（同为 1.3.0 新增）连接系统事件与自动动作，支持 6 种 pattern：cron、webhook、channel_message、agent_lifecycle、content_match、workflow_completion；多实例部署时 cron 复用 ShedLock 避免重复触发。

LLM Wiki 知识引擎把 PDF、Markdown 或整文件夹消化为带双向链接、摘要与溯源指针的结构化页面，热点缓存自动注入 system prompt；1.3.0 起新增 Transformations 引擎（内置 7 个企业模板），把知识管理从"检索"升级为"加工"。

内置 14 个工具涵盖 Web 搜索、文件读写、Shell、时间、浏览器自动化、图像/视频/音乐生成、TTS/STT、delegate-agent 等，全部经过 Tool Guard（按 RBAC + 审批流 + 路径保护，例如 Shell 强制审批、.env 写拦截）。支持的 LLM 供应商在 14 家到 15 家以上，包括 DashScope（通义千问）、OpenAI、Anthropic、Gemini、DeepSeek、Kimi、MiniMax、智谱、Ollama、LM Studio、MLX、OpenRouter 等，并支持多供应商故障转移（健康追踪 + 冷却窗口，可在设置中拖拽优先级）。

## 部署方式与生态关系

MateClaw 提供三种部署形态：桌面端（捆绑 JRE 21，双击即用）、Docker Compose（约 18 行，docker compose up -d 后访问 http://localhost:18080）、源码运行（mvn spring-boot:run 后端 :18088、前端 :5173），默认登录 admin / admin123。

它深度依赖 Spring AI Alibaba，是 Java 生态补齐多智能体能力的关键拼图。其所属的 mate.vip 项目矩阵还包含 MateCloud（基于 Spring Cloud Alibaba 的 AI 原生 DDD 微服务脚手架，2026-06-29 发布 v5.0.8，是 MateClaw 的底座级兄弟项目）、太一·国央企智能体（mate-hive 企业版，面向国企央企的私有化智能体平台，具备信创适配、等保三级、SM2/3/4 国密加密与多租户隔离，已交付投产，是 MateClaw 能力的企业/政务闭源延伸）。

## 版本演进

MateClaw 迭代极快，2026 年 4 月后进入密集发布期。v1.2.0（2026-05-05）完成基础能力收敛；v1.3.0（2026-05-18）引入 Workflow、Trigger、Wiki 加工器、per-agent MCP 绑定、多模态旁路与 Office 生成工具（DocxRenderTool / XlsxRenderTool / PptxRenderTool / PdfRenderTool，不依赖 npm/Office）；v1.4.0（2026-05-25）是分水岭，定位升级为"企业级 Agent Runtime"，新增持久化 Goal、子员工委派树、Workspace RBAC 与 Tool Guard 审批；v1.5.0（2026-06-07）把 Goal 改为 checklist 验收并让 LLM Wiki 自维护成知识图谱；v1.7.0（2026-07-06）做生产化加固（审批三链路闭环、长任务与成本可见、KB/Deep Research Open API、MCP 身份透传、局域网 SSRF 防护）；v1.8.0（2026-07-12）加入 Content Studio 一句话生成公众号/小红书图文，并新增火山引擎 Provider；当前开发分支为 2.0.0-SNAPSHOT。需要提示，部分来源（如 CSDN 架构文记为 v1.0.418、mate.vip 首页标注"v5.0.8"）与 GitHub Release 的 v1.x 口径不一致，应以 GitHub Release 为准。

## 与主流竞品的对比

为看清 MateClaw 的位置，将其与主流 AI Agent 框架/平台对比如下（星标为约 2026 年初快照，多数项目此后仍在增长；MateClaw 星标量级小、社区早期，数据可信度中等）：

| 维度 | MateClaw | Dify | Coze/扣子 | n8n | LangChain/LangGraph | AutoGen/MetaGPT |
|---|---|---|---|---|---|---|
| 定位 | 自部署多智能体 AI OS | 开源 LLMOps/Agent 平台 | 低代码 Agent 平台 | 工作流自动化 | 开发框架 | 多智能体框架 |
| 技术栈 | Java/Spring + Vue3 | Python + TS | Go + TS | TypeScript | Python | Python |
| 部署 | 单 JAR/桌面/容器自托管 | 自托管+云 | 云 SaaS 为主 | 自托管+云 | 库/SDK 自部署 | 库/SDK 自部署 |
| 协议 | Apache-2.0 | 修改版 Apache-2.0 | Apache-2.0（开源版） | fair-code | MIT | MIT |
| 星标量级 | ~646（早期） | ~13 万 | ~2.1 万 | ~17.5 万 | ~12.7 万 / ~3.1 万 | ~5.5 万 / ~6.4 万 |
| 多 Agent 运行时 | 原生 StateGraph | 工作流节点 | 3.0 多人多 Agent | 工作流为主 | 图/状态机 | 原生多 Agent |
| 数据可控 | 强（数据不出门） | 自托管可控 | 云版出网 | 自托管可控 | 取决于部署 | 取决于部署 |

MateClaw 最大的差异化是纯 Java/Spring 自部署，对已有 Spring 运维体系的企业零心智负担；它填补了 Java 生态"多智能体 OS"的空白，并以 Apache-2.0 协议对二次开发最友好。相对地，Dify、n8n 在星标与生态成熟度上遥遥领先，LangGraph/AutoGen 在多智能体理论深度与第三方基准上更经得起检验，Coze 则胜在低代码与业务人员友好。在"OS / 平台 / 框架"三档中，最贴近 MateClaw 的是 Spring AI Alibaba 生态本身——MateClaw 即构建于其 Agent Framework + Graph 之上。

## 社区、生态与用户反馈

公开数据方面，MateClaw 主仓库为 github.com/mateaix/mateclaw（Gitee 另有镜像），最新 Release v1.8.0 于 2026-07-12 发布，最近提交在 2026-07-15，开发活跃。星标约 646（第三方聚合站 ToolScout 约 24 天前抓取），贡献者尚少，属早期项目。它已被开源中国（OSCHINA）收录，背后为 mate.vip（北京道天地科技有限公司商标品牌），是商业公司驱动的开源项目，但未发现进入开源基金会或获头部云厂商业背书的明确证据。B 站有官方账号发布演示，媒体覆盖集中在 CSDN、51CTO、掘金与 OSCHINA，其中 CSDN 作者 bufegar0 连续发布各版本解读，内容与官方文档高度一致，近似官方运营。

用户反馈的共识优点包括：Java 生态友好、自部署数据不出门、14+ 模型故障转移、企业级治理（审批/审计/RBAC）。痛点方面，v1.7.0 的"生产化加固"清单本身暴露了早期短板——审批链路曾静默挂死、长任务不可见、小上下文窗口易降级、知识库处理失败难排查，说明早期版本生产可用性不足、正被快速修补；面向 Java 工程师的定位也意味着需理解 StateGraph/Agent Runtime 概念，对纯业务人员有门槛。整体口碑偏"技术扎实但年轻、迭代快"，缺乏大规模第三方生产案例背书。

## 重要澄清：MateClaw 不等于华为云 OfficeClaw

检索中"Claw"系命名极易混淆，必须厘清：MateClaw 是 mate.vip 的开源项目（Apache-2.0，Java/Spring AI Alibaba 技术栈，自部署多智能体 OS）；而华为云 OfficeClaw 是华为云自研的企业级办公智能体，2026-04-16 启动邀测，基于自研 Harness 工程底座，聚焦办公场景（内容生成、文件处理、知识搜索、邮件/纪要、PPT 制作），二者无隶属、技术与品牌关系。此外，媒体将 MateClaw 描述为"对标 OpenClaw"，但二者同样是不同项目。本报告所有 MateClaw 数据均不混入 OfficeClaw 信息。

## 综合分析：机会与风险

MateClaw 的机会清晰：第一，它是中文开源界少有的主打"纯 Java/Spring 自部署多智能体 OS"的产品，填补企业 Java 栈空白；第二，"数据不出门 + 主动型 AI + 8 渠道 IM 入口 + 可审批 Tool Guard"精准切中企业合规与落地痛点；第三，Apache-2.0 协议对商业二次开发最友好，且可借力 Spring AI Alibaba 生态。

风险与局限同样需要正视：其一，生态最早期，星标与社区规模远不及成熟竞品；其二，多 Agent 能力相比 LangGraph/AutoGen 的理论深度仍待独立第三方基准验证，官方文档偏产品宣言式；其三，自建 StateGraph 编排 vs 复用成熟方案的长期维护成本需观察；其四，当前以 Gitee/GitHub 中文社区为主，国际化与英文文档覆盖有限。

## 结论

MateClaw 是一个在 2026 年"Claw 智能体浪潮"中快速崛起的 Java 系自部署多智能体 AI 操作系统，技术完成度高、迭代迅猛（半年内从 v1.2 演进到 v1.8.0）。它以纯 Spring 技术栈、数字员工范式、四层记忆与 Dreaming 自我整合、MCP/工作流/触发器，以及"数据不出门"的企业级治理，为 Java 企业与团队提供了一条区别于 Dify/Coze/n8n/LangChain 的独特路径。对于强数据合规、已有 Spring 体系、希望把 AI Agent 真正当"员工"来管理和治理的组织，MateClaw 值得重点评估；但其在社区规模、生产案例与多智能体编排的理论稳健性上仍属早期，选型时应以 Pilot 验证为先。

## 研究局限

本报告综合了官方文档、GitHub/Gitee 仓库、CSDN 与 51CTO 等二次解读、微信公众号检索摘要与第三方星标聚合站。存在以下不确定性：MateClaw 的 GitHub 星标/贡献者确切数字仅来自第三方聚合站，未获官方 API 直读；不同来源对版本号（v1.0.418 / v1.x / "v5.0.8"）存在口径冲突，本报告以 GitHub Release 的 v1.8.0 为准；微信文章因链接解析限制未能获取全文，仅以检索摘要作为趋势佐证；mateaix 与 matevip 仓库的主从关系及是否获 Spring AI Alibaba 官方背书，仍需进一步核实。

## 参考来源

1. [MateClaw：基于 Spring AI Alibaba 的开源多智能体 AI 操作系统（附架构详解）— CSDN](https://blog.csdn.net/bufegar0/article/details/160105547)
2. [MateClaw 1.3.0 正式发布：新增工作流、触发器等能力 — CSDN](https://blog.csdn.net/operationgroup/article/details/161055838)
3. [MateClaw 正式开源（2026-04-05）— CSDN](https://blog.csdn.net/bufegar0/article/details/159846780)
4. [MateClaw v1.4.0 发布解读 — CSDN](https://blog.csdn.net/bufegar0/article/details/161393337)
5. [MateClaw 1.7.0 开源发布 — CSDN](https://blog.csdn.net/bufegar0/article/details/162642341)
6. [从 Spring AI Alibaba 迁移到 MateClaw 踩坑 — 51CTO](https://blog.51cto.com/u_16213327/14659227)
7. [MateClaw 官方文档·项目介绍](https://claw.mate.vip/docs/zh/intro.html)
8. [MateClaw 记忆系统文档](https://claw.mate.vip/docs/zh/memory.html)
9. [mate.vip 开源项目矩阵](https://mate.vip/)
10. [MateClaw GitHub 仓库（mateaix/mateclaw）](https://github.com/mateaix/mateclaw)
11. [MateClaw Gitee 仓库](https://gitee.com/monks-offering/mateclaw)
12. [OSCHINA - MateClaw 项目页](https://www.oschina.net/p/mateclaw)
13. [ToolScout.ai - mateaix/mateclaw 指标](http://toolscout.ai/repo/mateaix-mateclaw)
14. [Dify GitHub 仓库](https://github.com/langgenius/dify)
15. [Coze Studio GitHub 仓库](https://github.com/coze-dev/coze-studio)
16. [n8n GitHub 仓库](https://github.com/n8n-io/n8n)
17. [LangChain GitHub 仓库](https://github.com/langchain-ai/langchain)
18. [LangGraph GitHub 仓库](https://github.com/langchain-ai/langgraph)
19. [Microsoft AutoGen GitHub 仓库](https://github.com/microsoft/autogen)
20. [MetaGPT GitHub 仓库](https://github.com/FoundationAgents/MetaGPT)
21. [Spring AI Alibaba GitHub 仓库](https://github.com/alibaba/spring-ai-alibaba)
22. [华为云 OfficeClaw 办公智能体邀测（IT之家）](https://www.ithome.com/0/940/003.htm)
23. [微信公众号检索：MateClaw 相关文章（弓长9528、迈特云快速开发等，2026 年）](https://weixin.sogou.com/)
