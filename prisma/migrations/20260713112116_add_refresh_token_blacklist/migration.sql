-- CreateTable
CREATE TABLE "RefreshTokenBlacklist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jti" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "RefreshTokenBlacklist_jti_key" ON "RefreshTokenBlacklist"("jti");

-- CreateIndex
CREATE INDEX "RefreshTokenBlacklist_expiresAt_idx" ON "RefreshTokenBlacklist"("expiresAt");
