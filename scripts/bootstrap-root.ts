import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const prisma = new PrismaClient();

async function main() {
  const count = await prisma.user.count();
  if (count > 0) return;

  const password = randomBytes(18).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      username: "root",
      passwordHash,
      mustChangePassword: true,
    },
  });

  // 这一行专门给运维/启动日志捕获
  // eslint-disable-next-line no-console
  console.log(`[BOOTSTRAP] root username=root password=${password}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
