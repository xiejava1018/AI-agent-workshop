import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertPlatformAdmin } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const admin = await assertPlatformAdmin(req);
  if (!admin) {
    return NextResponse.json(
      { error: req.headers.get("x-user-id") ? "forbidden" : "auth required" },
      { status: req.headers.get("x-user-id") ? 403 : 401 },
    );
  }

  const { id } = await params;
  const entry = await prisma.auditLog.findUnique({
    where: { id },
  });
  if (!entry) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // AuditLog 没有 FK 到 User,需要单独查询 username。userId 为 null(系统/匿名
  // 记录)时 username 也为 null,前端负责 fallback。
  const username = entry.userId
    ? (
        await prisma.user.findUnique({
          where: { id: entry.userId },
          select: { username: true },
        })
      )?.username ?? null
    : null;

  return NextResponse.json({ entry: { ...entry, username } });
}
