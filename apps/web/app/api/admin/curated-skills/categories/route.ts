/**
 * app/api/admin/curated-skills/categories/route.ts
 *
 * GET /api/admin/curated-skills/categories
 *   - 返回类别聚合 + 计数,仅统计 enabled=true
 *   - 全员 authed (前端 meta.roles 把守)
 */
import { NextRequest, NextResponse } from "next/server";
import { getCategoriesWithCounts } from "@/lib/curated-skills";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const categories = await getCategoriesWithCounts();
    return NextResponse.json({ categories });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[GET /api/admin/curated-skills/categories] unexpected:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}