-- 技能精选库:把 platform-skill 菜单的 component 从 /platform/index 改为 /skill-curated/index
-- 详见同目录 MIGRATION.md
UPDATE "SysMenu"
SET "component" = '/skill-curated/index',
    "updatedAt" = NOW()
WHERE "name" = 'platform-skill'
  AND "component" <> '/skill-curated/index';
