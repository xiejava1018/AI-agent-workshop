-- CreateTable
CREATE TABLE "AgentSkillBinding" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "skillPackageId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'inherit',

    CONSTRAINT "AgentSkillBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMcpBinding" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "mcpServerId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'inherit',

    CONSTRAINT "AgentMcpBinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSkillBinding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "skillPackageId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'inherit',

    CONSTRAINT "UserSkillBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentSkillBinding_agentId_idx" ON "AgentSkillBinding"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentSkillBinding_agentId_skillPackageId_key" ON "AgentSkillBinding"("agentId", "skillPackageId");

-- CreateIndex
CREATE INDEX "AgentMcpBinding_agentId_idx" ON "AgentMcpBinding"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMcpBinding_agentId_mcpServerId_key" ON "AgentMcpBinding"("agentId", "mcpServerId");

-- CreateIndex
CREATE INDEX "UserSkillBinding_userId_idx" ON "UserSkillBinding"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSkillBinding_userId_skillPackageId_key" ON "UserSkillBinding"("userId", "skillPackageId");

