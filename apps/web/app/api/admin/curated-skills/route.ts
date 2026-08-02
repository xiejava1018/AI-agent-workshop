/**
 * app/api/admin/curated-skills/route.ts
 *
 * 技能精选库 admin CRUD (运营/治理层)
 *
 * 设计:openspec/changes/skill-curated-library/design.md §3
 *
 * GET   /api/admin/curated-skills?category=&tag=&featured=&enabled=&q=&limit=&offset=
 *       - 全员 authed (含 team MEMBER);M4 RBAC 用 assertPlatformAdmin 仅限 PUT/PATCH/DELETE
 *       - 注:本期 GET 不强制 platform:access,但 admin UI 上前端路由 meta.roles=OWNER 把守
 * POST  /api/admin/curated-skills
 *       - platform OWNER only (assertPlatformAdmin → 校验 platform:access 权限码)
 *       - body: 见 lib/curated-skills.ts UpsertCuratedInput
 *
 * SECURITY: role 始终从 DB 派生 (assertPlatformAdmin);x-user-role header 不被信任。
 */
import { NextRequest, NextResponse } from "next/server";
import { assertPlatformAdmin } from "@/lib/permissions";
import { enforceNotMustChange } from "@/lib/must-change-password";
import {
  CuratedSkillError,
  listCuratedEntries,
  createCuratedEntry,
} from "@/lib/curated-skills";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  // authed (任何登录用户);不强制 platform:access,但 admin UI 前端路由 meta.roles=OWNER 把守
  if (!req.headers.get("x-user-id")) {
    return NextResponse.json({ error: "auth required" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const filters = {
    category: searchParams.get("category") ?? undefined,
    tag: searchParams.get("tag") ?? undefined,
    featured:
      searchParams.get("featured") === "true"
        ? true
        : searchParams.get("featured") === "false"
          ? false
          : undefined,
    enabled:
      searchParams.get("enabled") === "false" ? false : true, // default true
    q: searchParams.get("q") ?? undefined,
    limit: searchParams.has("limit") ? Number(searchParams.get("limit")) : undefined,
    offset: searchParams.has("offset") ? Number(searchParams.get("offset")) : undefined,
  };

  try {
    const result = await listCuratedEntries(filters);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CuratedSkillError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    // eslint-disable-next-line no-console
    console.error("[GET /api/admin/curated-skills] unexpected:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

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

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    const created = await createCuratedEntry(
      {
        slug: String(body.slug ?? ""),
        name: String(body.name ?? ""),
        description: typeof body.description === "string" ? body.description : undefined,
        summary: typeof body.summary === "string" ? body.summary : undefined,
        category: typeof body.category === "string" ? body.category : undefined,
        tags: Array.isArray(body.tags)
          ? (body.tags.filter((t) => typeof t === "string") as string[])
          : undefined,
        icon: typeof body.icon === "string" ? body.icon : undefined,
        version: typeof body.version === "string" ? body.version : undefined,
        author: typeof body.author === "string" ? body.author : undefined,
        sourceKind:
          typeof body.sourceKind === "string" ? (body.sourceKind as never) : undefined,
        sourceFilePath:
          typeof body.sourceFilePath === "string" ? body.sourceFilePath : undefined,
        sourceBuiltinPath:
          typeof body.sourceBuiltinPath === "string" ? body.sourceBuiltinPath : undefined,
        sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : undefined,
        visibility: typeof body.visibility === "string" ? body.visibility : undefined,
        featured: typeof body.featured === "boolean" ? body.featured : undefined,
        enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
        installCount:
          typeof body.installCount === "number" ? body.installCount : undefined,
      },
      admin.userId,
    );
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof CuratedSkillError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    // eslint-disable-next-line no-console
    console.error("[POST /api/admin/curated-skills] unexpected:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}