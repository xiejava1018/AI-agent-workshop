-- AlterTable
-- 用户管理补齐 email / full_name / phone / gender 四个可空字段。
-- 全部 nullable,旧数据 NULL 即可,不破坏既有账号。
-- email 由 schema.prisma 的 @unique 管理,Prisma migrate 会自动同步唯一索引,
-- 此处只声明列,不重复建索引。
ALTER TABLE "User" ADD COLUMN "email"     TEXT;
ALTER TABLE "User" ADD COLUMN "full_name" TEXT;
ALTER TABLE "User" ADD COLUMN "phone"     TEXT;
ALTER TABLE "User" ADD COLUMN "gender"    INTEGER;
