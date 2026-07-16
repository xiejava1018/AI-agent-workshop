import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { mkdirSync } from "fs";
import { join } from "path";

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

  // M2.2 follow-up: also create a default Project under that team and
  // bind it to root via lastProjectId. Without this, app/api/agent/new
  // returns 400 "no project selected" (Task 4.2 design), and the fork's
  // chat UI cannot create its first session. The default project is a
  // scratch directory under data/projects/default that the user can
  // immediately cd into for their first chat.
  const defaultProjectPath = join(process.cwd(), "data", "projects", "default");
  mkdirSync(defaultProjectPath, { recursive: true });
  const project = await prisma.project.create({
    data: {
      teamId: team.id,
      name: "Default Project",
      rootPath: defaultProjectPath,
      createdBy: root.id,
    },
  });
  await prisma.user.update({
    where: { id: root.id },
    data: { lastProjectId: project.id },
  });

  // 这一行专门给运维/启动日志捕获
  // eslint-disable-next-line no-console
  console.log(`[BOOTSTRAP] root username=root password=${password}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
