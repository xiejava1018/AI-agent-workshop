import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const prisma = new PrismaClient();

async function main() {
  const count = await prisma.user.count();
  if (count > 0) {
    // 重启不重新生成 — 但 spec 要求始终输出一行 [BOOTSTRAP] 用于运维确认
    // eslint-disable-next-line no-console
    console.log(`[BOOTSTRAP] root username=root password=<redacted>`);
    return;
  }

  const password = randomBytes(18).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 10);
  const root = await prisma.user.create({
    data: {
      username: "root",
      passwordHash,
      mustChangePassword: true,
    },
  });

  // Create a default team so root has an OWNER TeamMember; otherwise
  // assertCanReadSession's OWNER/ADMIN bypass never fires and root gets 403
  // on every agent session read.
  const team = await prisma.team.create({
    data: {
      name: "Default Team",
      ownerUserId: root.id,
    },
  });
  await prisma.teamMember.create({
    data: {
      teamId: team.id,
      userId: root.id,
      role: "OWNER",
    },
  });

  // 这一行专门给运维/启动日志捕获
  // eslint-disable-next-line no-console
  console.log(`[BOOTSTRAP] root username=root password=${password}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
