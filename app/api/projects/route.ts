import { NextRequest, NextResponse } from "next/server";
import { statSync } from "fs";
import { allowFileRoot } from "@/lib/allowed-roots";  // fork 已有
import { prisma } from "@/lib/prisma";

async function assertCanCreate(userId: string): Promise<{ teamId: string; role: string } | null> {
  const tm = await prisma.teamMember.findFirst({
    where: { userId, role: { in: ["OWNER", "ADMIN"] } },
  });
  if (!tm) return null;
  return { teamId: tm.teamId, role: tm.role };
}

export async function GET(req: NextRequest) {
  const userId = req.headers.get("x-user-id");
  if (!userId) return NextResponse.json({ error: "auth required" }, { status: 401 });
  // M1 简化: 列 user 加入的 team 下的所有 projects
  const memberships = await prisma.teamMember.findMany({ where: { userId } });
  const teamIds = memberships.map(m => m.teamId);
  const projects = await prisma.project.findMany({ where: { teamId: { in: teamIds } } });
  return NextResponse.json({ projects });
}

export async function POST(req: NextRequest) {
  const userId = req.headers.get("x-user-id");
  if (!userId) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const authz = await assertCanCreate(userId);
  if (!authz) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { name, root_path } = await req.json();
  if (!name || !root_path) return NextResponse.json({ error: "missing fields" }, { status: 400 });

  try {
    statSync(root_path);  // 校验路径存在
  } catch {
    return NextResponse.json({ error: "root_path does not exist" }, { status: 400 });
  }

  const project = await prisma.project.create({
    data: { name, rootPath: root_path, teamId: authz.teamId, createdBy: userId },
  });
  allowFileRoot(root_path);  // fork 的白名单 cache
  return NextResponse.json({ project });
}