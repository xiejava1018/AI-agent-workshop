-- CreateTable
CREATE TABLE "DelegationTree" (
    "id" TEXT NOT NULL,
    "rootSessionId" TEXT NOT NULL,
    "parentSessionId" TEXT,
    "childSessionId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'sync',
    "depth" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'running',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DelegationTree_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DelegationTree_rootSessionId_idx" ON "DelegationTree"("rootSessionId");

-- CreateIndex
CREATE INDEX "DelegationTree_childSessionId_idx" ON "DelegationTree"("childSessionId");

