# 技能精选库 — 数据库菜单迁移

## 背景

DB 中 `platform-skill` 菜单当前 `component='/platform/index'`，指向的是「平台管理」页（用户/审计/监控），与「技能精选库」语义不符。

本次新增了独立页面 `views/skill-curated/index.vue`，需要把菜单的 `component` 改为 `/skill-curated/index`。

> **为什么不直接 reseed？** `prisma/seed/menus.ts` 已经改对了（见本次提交），但 `prisma db seed` 不会 UPDATE 已存在的 menu 行（upsert by `name` 但 component 字段在 seed 之外可能被运维手改过）。为安全起见，提供幂等 UPDATE。

## 执行 SQL

在 `apps/web` 的 Postgres 上执行（连接串见 `apps/web/.env` 的 `DATABASE_URL`）：

```sql
UPDATE "SysMenu"
SET "component" = '/skill-curated/index',
    "updatedAt" = NOW()
WHERE "name" = 'platform-skill'
  AND "component" <> '/skill-curated/index';
```

预期影响：1 行（如已对则 0 行）。

## 验证

执行后：

1. 用 platform_admin 账号登录 dashboard (`http://localhost:3006`)
2. 左侧菜单点击「技能精选库」
3. 应看到「技能精选库」页面（左侧分类 + 右侧卡片/表格切换），不再是「平台管理」页
4. F12 控制台无 `[ComponentLoader] 未找到组件` 报错

## 回滚

```sql
UPDATE "SysMenu"
SET "component" = '/platform/index',
    "updatedAt" = NOW()
WHERE "name" = 'platform-skill';
```

回滚后菜单会重新指向「平台管理」页（但该页本身没改，行为不变）。
