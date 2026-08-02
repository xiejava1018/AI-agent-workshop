/**
 * app/api/skills/[id]/stats/route.ts
 *
 * GET /api/skills/[id]/stats — Skill 调用统计（P3 反馈闭环）
 *
 * 聚合 SkillInvocation：总调用次数、成功率、近 7 天次数、最后使用时间。
 * 供数字员工 skill 列表 / 精选库卡片展示「近 7 天 N 次 · 成功率 M%」。
 *
 * 鉴权：任意登录用户可读（stats 是聚合数据，不泄露敏感信息）。
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const userId = req.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "auth required" }, { status: 401 });
  }

  const { id } = await params;

  // 确认 skill 存在
  const pkg = await prisma.skillPackage.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!pkg) {
    return NextResponse.json({ error: "skill not found" }, { status: 404 });
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [total, successCount, last7d, lastUsed] = await Promise.all([
    prisma.skillInvocation.count({ where: { skillPackageId: id } }),
    prisma.skillInvocation.count({
      where: { skillPackageId: id, outcome: "success" },
    }),
    prisma.skillInvocation.count({
      where: { skillPackageId: id, createdAt: { gte: sevenDaysAgo } },
    }),
    prisma.skillInvocation.findFirst({
      where: { skillPackageId: id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  return NextResponse.json({
    totalInvocations: total,
    successRate: total > 0 ? successCount / total : 0,
    last7d,
    lastUsedAt: lastUsed?.createdAt.toISOString() ?? null,
  });
}
