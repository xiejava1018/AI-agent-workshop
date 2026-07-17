-- CreateTable
CREATE TABLE "SkillPackage" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "scope" TEXT NOT NULL DEFAULT 'global',
    "teamId" TEXT,
    "userId" TEXT,
    "source" TEXT NOT NULL DEFAULT '',
    "filePath" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "SkillPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillInvocation" (
    "id" TEXT NOT NULL,
    "skillPackageId" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillInvocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SkillPackage_teamId_idx" ON "SkillPackage"("teamId");

-- CreateIndex
CREATE INDEX "SkillPackage_userId_idx" ON "SkillPackage"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SkillPackage_scope_slug_teamId_userId_key" ON "SkillPackage"("scope", "slug", "teamId", "userId");

-- CreateIndex
CREATE INDEX "SkillInvocation_skillPackageId_idx" ON "SkillInvocation"("skillPackageId");

