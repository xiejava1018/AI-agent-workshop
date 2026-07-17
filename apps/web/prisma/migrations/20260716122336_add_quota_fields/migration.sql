-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "maxConcurrentSessions" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tokenDailyLimit" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "maxConcurrentSessions" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "tokenDailyLimit" INTEGER NOT NULL DEFAULT 0;

