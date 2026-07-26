-- SkillCuratedEntry: 平台精选的技能展示条目 (运营/治理层)
-- 独立于 SkillPackage,纯粹描述"该向用户展示哪些 builtin skill / 哪些是推荐位"
CREATE TABLE "SkillCuratedEntry" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT 'general',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "icon" TEXT NOT NULL DEFAULT '',
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "author" TEXT NOT NULL DEFAULT '',
    "sourceKind" TEXT NOT NULL DEFAULT 'builtin',
    "sourceFilePath" TEXT NOT NULL DEFAULT '',
    "sourceBuiltinPath" TEXT NOT NULL DEFAULT '',
    "sourceUrl" TEXT NOT NULL DEFAULT '',
    "visibility" TEXT NOT NULL DEFAULT 'global',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "installCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillCuratedEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SkillCuratedEntry_slug_key" ON "SkillCuratedEntry"("slug");
CREATE INDEX "SkillCuratedEntry_category_idx" ON "SkillCuratedEntry"("category");
CREATE INDEX "SkillCuratedEntry_featured_idx" ON "SkillCuratedEntry"("featured");
CREATE INDEX "SkillCuratedEntry_enabled_idx" ON "SkillCuratedEntry"("enabled");
CREATE INDEX "SkillCuratedEntry_sourceFilePath_idx" ON "SkillCuratedEntry"("sourceFilePath");