-- CreateTable
CREATE TABLE "McpServer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "transport" TEXT NOT NULL DEFAULT 'stdio',
    "endpoint" TEXT NOT NULL DEFAULT '',
    "command" TEXT NOT NULL DEFAULT '',
    "configEnc" TEXT NOT NULL DEFAULT '',
    "scope" TEXT NOT NULL DEFAULT 'global',
    "teamId" TEXT,
    "userId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "McpServer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "McpServer_teamId_idx" ON "McpServer"("teamId");

-- CreateIndex
CREATE INDEX "McpServer_userId_idx" ON "McpServer"("userId");

