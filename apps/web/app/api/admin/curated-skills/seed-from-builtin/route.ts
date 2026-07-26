/**
 * app/api/admin/curated-skills/seed-from-builtin/route.ts
 *
 * POST /api/admin/curated-skills/seed-from-builtin
 *   - platform OWNER only
 *   - 扫 3 个 builtin 目录 (<dashboard>/skills, ~/.pi/agent/skills,
 *     ~/.claude/skills),解析每个 SKILL.md frontmatter,按 sourceFilePath
 *     幂等 upsert 到 SkillCuratedEntry。
 *   - 返回 { created, updated, skipped, total }
 */
import { NextRequest, NextResponse } from "next/server";
import { assertPlatformAdmin } from "@/lib/permissions";
import { enforceNotMustChange } from "@/lib/must-change-password";
import { seedFromBuiltin } from "@/lib/curated-skills";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = enforceNotMustChange(req);
  if (gate) return gate;

  const admin = await assertPlatformAdmin(req);
  if (!admin) {
    if (!req.headers.get("x-user-id")) {
      return NextResponse.json({ error: "auth required" }, { status: 401 });
    }
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const result = await seedFromBuiltin();
    return NextResponse.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[POST /api/admin/curated-skills/seed-from-builtin] unexpected:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}