# Proposal：Skill 系统运行时完善（Skill Runtime Completeness）

> change: skill-curated-library（运营层）已落地；本 change 补齐**运行时消费层**
> 日期：2026-08-02
> 作者：xie
> 状态：Draft —— 待评审后按 tasks.md 分阶段实施

---

## 为什么要做

当前 Skill 系统已经建好了相当完整的**数据层**与**触发机制**：

- 数据层：`SkillPackage`（运行时包）、`SkillCuratedEntry`（运营精选库）、`AgentSkillBinding`（agent 绑定）、`SkillInvocation`（调用审计）都已就位。
- 触发机制：显式 `/skill:<slug>`（`lib/skill-invoke.ts`）与模型自决 `<skill>` 块（`lib/skill-block.ts`），含多租户 scope 校验、`disable-model-invocation`、path-traversal 防护、权威内容替换。

**但是 skill 在运行时实际上是"哑"的**——agent 绑定了 skill，会话里却加载不到，因为 **SKILL.md 文件的物理分发链路从未打通**。这让"数字员工绑定 skill"和"工作台用 skill"两个核心场景形同虚设。

## 核心问题（一句话）

> **SKILL.md 文件从未被放到运行时能找到的地方。** curated 指向开发机绝对路径，install 只写 DB 不落盘，rpc-manager 只留占位相对路径不复制文件，pi SDK 找不到就静默忽略。

详见 `design.md` §3 的三处断点。

## 本 change 要交付什么

1. **打通分发管道**：让 `install` / `seed` 真正把 SKILL.md 落盘到可移植的 `SKILLS_ROOT`，让 `startRpcSession` 在会话启动时把绑定的 skill 文件铺到 `<cwd>/.pi/skills/{slug}`，使 pi 能真正加载。
2. **统一两个消费场景**：数字员工绑定 skill 与工作台 skill 视图合并、来源可追溯。
3. **补齐反馈闭环**：`SkillInvocation` 记录调用结果（成功/失败/token），支撑精选库排序与"哪些 skill 真有用"。
4. **治理与规范**：SKILL.md frontmatter 约定、scope 组织规范、权限矩阵。

## 不做什么（Out of Scope）

- 不重写已稳定的 `skill-block.ts` / `skill-invoke.ts` 触发与安全逻辑。
- 不动 `SkillCuratedEntry` 运营层（已在 `skill-curated-library` change 完成）。
- 不实现 skill 在线编辑器（本期只支持上传/seed/git/npm 来源的成品 SKILL.md）。
- 不做多租户的 skill 权限细粒度（如"team A 的 skill 对 team B 不可见"已有 scope 字段支持，本期只规范化使用）。

## 关联文档

- 本 change：`design.md`（总设计）、`tasks.md`（分阶段任务）
- 已完成：`openspec/changes/skill-curated-library/`（运营精选库）
- 已完成：`openspec/changes/m3-vue3-workbench/`（工作台架构）
