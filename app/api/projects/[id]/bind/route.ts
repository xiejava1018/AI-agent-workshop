import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { statSync } from "fs";
import { allowFileRoot } from "@/lib/allowed-roots";  // fork 已有
import { assertWithinRoot } from "@/lib/path-safety";

const prisma = new PrismaClient();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = req.headers.get("x-user-id");
  if (!userId) return NextResponse.json({ error: "auth required" }, { status: 401 });

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });

  // membership 校验
  const tm = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId: project.teamId, userId } },
  });
  if (!tm) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // 路径自检 (assertWithinRoot(project.rootPath, project.rootPath) is the design-doc §2.5 self-check)
  try {
    assertWithinRoot(project.rootPath, project.rootPath);
  } catch {
    return NextResponse.json({ error: "path invalid" }, { status: 500 });
  }

  // 验证路径存在并加入 fork 白名单 cache
  try {
    statSync(project.rootPath);
  } catch {
    return NextResponse.json({ error: "root_path does not exist" }, { status: 400 });
  }
  allowFileRoot(project.rootPath);

  // 写 last_project_id
  await prisma.user.update({
    where: { id: userId },
    data: { lastProjectId: id },
  });

  return NextResponse.json({ ok: true, lastProjectId: id });
}