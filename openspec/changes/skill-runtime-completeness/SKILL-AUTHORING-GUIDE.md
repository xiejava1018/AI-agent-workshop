# Skill 编写与使用指南

> change: skill-runtime-completeness（P4.2 / P4.4 / P4.5）
> 面向：Skill 作者、平台管理员、数字员工配置者
> 配套设计：`design.md`

---

## 1. 什么是 Skill

Skill 是一段 **Markdown 指令包**（`SKILL.md`），告诉 LLM「遇到某类任务时该怎么做」。它改变模型的**思考方式与流程**，而非增加工具。

- **本质**：给 LLM 的操作手册（pi 风格的 SKILL.md）
- **形态**：YAML frontmatter（元数据）+ Markdown 正文（指令）
- **触发**：用户显式 `/skill:<slug>` 或模型自决输出 `<skill>` 块
- **运行**：被加载后会话内可见，模型按其指令行动

---

## 2. SKILL.md 编写规范（P4.2）

### 2.1 文件结构

```markdown
---
name: draw-diagram
description: 生成 SVG 架构图/流程图，导出 PNG
version: 1.0.0
author: skill-team
category: development
tags: [svg, diagram, architecture]
disable-model-invocation: false
---
# Draw Diagram

当用户要求画架构图、流程图、时序图时，按以下流程执行：

1. 确认图的类型（架构 / 流程 / 时序 / 概念图）
2. 用 SVG 语法绘制
3. 调用 rsvg-convert 导出 PNG
...
```

### 2.2 Frontmatter 字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | 展示名，进 system prompt 供模型识别 |
| `description` | ✅ | 一句话说明用途，**进 system prompt**（模型据此决定是否自决调用） |
| `version` | | 语义化版本，默认 `1.0.0` |
| `author` | | 作者标识 |
| `category` | | 分类：`development` / `security` / `productivity` / `general` |
| `tags` | | 标签数组，供精选库筛选 |
| `disable-model-invocation` | | `true` = 仅允许 `/skill:` 显式触发，禁止模型自决调用（用于敏感/不可控 skill）。默认 `false` |

### 2.3 强制约束（P4.1 / P4.3）

materialize（安装/seed）时会校验，不合规直接拒绝（HTTP 422）：

- **`name` 必填** —— 缺失报 `FRONTMATTER_MISSING_NAME`
- **`description` 必填** —— 缺失报 `FRONTMATTER_MISSING_DESCRIPTION`
- **体积 ≤ 512KB** —— 超限报 `SKILL_TOO_LARGE`
- **必须有 frontmatter 块**（`---` 包裹）

> 写 skill 时务必给 `description` 写清楚「这个 skill 干什么、何时该用它」——这是模型自决调用的依据，写得好模型才会主动用。

### 2.4 正文写作要点

- 用**祈使句**描述步骤（「确认…」「调用…」「输出…」）
- 明确**触发条件**（什么任务该用这个 skill）
- 明确**输出格式**（Markdown / JSON / 文件）
- 可引用工具名（模型会话内可见的工具），但不要假设外部状态

---

## 3. `disable-model-invocation` 详解（P4.2）

```yaml
disable-model-invocation: true
```

设为 `true` 后：
- ✅ 用户仍可用 `/skill:<slug>` **显式触发**
- ❌ 模型**不能**自决输出 `<skill>` 块调用它（`skill-block.ts` 会剥离模型的自决块）

**适用场景**：
- 高风险 skill（如删除操作、付费调用）
- 实验性 skill（不想模型随意触发）
- 需要人工确认才执行的流程

---

## 4. Scope 选择指南（P4.2）

| Scope | 用途 | 谁能安装 | 存储路径 |
|-------|------|----------|----------|
| `global` | 平台通用 skill，所有团队复用 | platform OWNER | `SKILLS_ROOT/global/<slug>/` |
| `team` | 团队私有 skill（业务领域知识） | team OWNER/ADMIN | `SKILLS_ROOT/team/<teamId>/<slug>/` |
| `user` | 个人实验性 skill | 任何用户（仅自己） | `SKILLS_ROOT/user/<userId>/<slug>/` |

**解析优先级**：`user > team > global`（同名时高优先级覆盖）。

**建议**：
- 通用能力（code-review、draw-diagram）→ `global`
- 团队业务流程（某团队的安全狩猎方法）→ `team`
- 个人试用/草稿 → `user`

---

## 5. Skill vs MCP：何时用哪个（P4.5）

这是最常见的混淆。一句话区分：

| 维度 | Skill | MCP |
|------|-------|-----|
| **回答的问题** | 「**怎么做**」 | 「**能调什么**」 |
| **本质** | 给 LLM 的**指令/流程知识** | 给 LLM 的**工具/外部能力** |
| **形态** | SKILL.md（文本） | 运行的 server（stdio/sse/http） |
| **改变模型的** | 思考方式、工作流程 | 可用工具集 |
| **配置入口** | 数字员工「Skill 配置」tab | 数字员工「MCP 配置」tab |

### 判断方法

- **想让模型按一套流程/规范做事** → **Skill**
  - 例：code-review 流程、威胁狩猎方法论、方案撰写模板
- **想让模型能访问某个外部系统/数据源** → **MCP**
  - 例：文件系统读写、数据库查询、Jira 操作

### 组合使用

一个数字员工可同时绑 Skill + MCP。典型搭配：
- `threat-hunt`（Skill，定义狩猎流程）+ `siem-mcp`（MCP，提供日志查询工具）
- `code-review`（Skill，定义审查清单）+ `filesystem`（MCP，读代码）

---

## 6. Skill 生命周期

```
作者编写 SKILL.md
      │
      ▼ (来源: builtin / uploaded / git / npm / content)
安装 install / seed-from-builtin
      │  materializeSkill → SKILLS_ROOT 规范存储 + DB SkillPackage
      ▼
绑定到数字员工 (AgentSkillBinding)
      │  或绑定到用户 (UserSkillBinding)
      ▼
开会话 (startRpcSession)
      │  syncSkillToSessionCwd → <cwd>/.pi/skills/<slug>/SKILL.md
      ▼
pi 加载 → frontmatter 进 system prompt
      │
      ├── 用户 /skill:<slug> 显式触发 ──┐
      └── 模型自决 <skill> 块 ──────────┤
                                       ▼
                            按 SKILL.md 指令执行
                                       │
                                       ▼
                       SkillInvocation 记录 (triggerKind/outcome)
                                       │
                                       ▼
                          GET /api/skills/[id]/stats 可查
```

---

## 7. 附录：权限矩阵复核（P4.4）

对照 `design.md §6.3`，复核现有实现：

| 操作 | 要求 | 实现位置 | 状态 |
|------|------|----------|------|
| 浏览 curated 精选库 | 全员可读 | `GET /api/admin/curated-skills`（auth-only） | ✅ |
| install **global** skill | platform OWNER | `install/route.ts` `getUserHighestRole === OWNER` | ✅ |
| install **team** skill | team OWNER/ADMIN | `install/route.ts` `isTeamAdmin` | ✅ |
| install **user** skill | 本人（或 OWNER 代装） | `install/route.ts` `targetUserId !== callerId → OWNER` | ✅ |
| 绑定到数字员工 | agent 可编辑即可 | `digital-employees/[id]` `getAccessibleAgent` | ✅ |
| `seed-from-builtin` | platform OWNER | `assertPlatformAdmin` | ✅ |
| curated 新增/编辑/软删 | platform OWNER | curated route `assertPlatformAdmin` | ✅ |
| path-traversal 防护 | — | `skill-materialize` `isWithinSkillsRoot` + `canonSkillPath` | ✅ |
| 体积上限 | ≤512KB | `materializeSkill` `MAX_SKILL_SIZE_BYTES`（P4.3） | ✅ |
| frontmatter 必填 | name+description | `materializeSkill`（P4.1） | ✅ |

**复核结论**：现有 RBAC 与 `design.md §6.3` 一致，无缺口。P4.1/P4.3 补齐了 frontmatter 与体积的「内容治理」（此前只有访问治理）。

---

## 8. 常见问题

**Q: 我的 skill 装了但会话里没生效？**
A: 三步排查：
1. `SkillPackage.filePath` 是否非空且在 `SKILLS_ROOT` 内？（`scripts/verify-p1-data.ts`）
2. 数字员工是否绑定了它？（`GET /api/digital-employees/[id]` 看 skillBindings）
3. 会话 cwd 下 `.pi/skills/<slug>/SKILL.md` 是否存在？（P0 sync 是否跑了）

**Q: 模型不主动用我的 skill？**
A: 检查 `description` 是否写清了「何时用」；确认没设 `disable-model-invocation: true`。

**Q: 想让某 skill 只能手动触发？**
A: frontmatter 加 `disable-model-invocation: true`。
