/**
 * app/api/admin/curated-skills/[id]/route.ts
 *
 * 技能精选库 单条 entry 操作
 *
 * GET    /api/admin/curated-skills/[id]
 *        - 全员 authed (前端路由 meta.roles 把守)
 * PATCH  /api/admin/curated-skills/[id]
 *        - platform OWNER only
 *        - body 任意子集 (与 POST 同形)
 * DELETE /api/admin/curated-skills/[id]
 *        - platform OWNER only
 *        - 软删:enabled=false,不删行
 */
import { NextRequest, NextResponse } from "next/server";
import { assertPlatformAdmin } from "@/lib/permissions";
import { enforceNotMustChange } from "@/lib/must-change-password";
import {
  CuratedSkillError,
  getCuratedEntryById,
  softDeleteCuratedEntry,
  updateCuratedEntry,
} from "@/lib/curated-skills";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!req.headers.get("x-user-id")) {
    return NextResponse.json({ error: "auth required" }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    const entry = await getCuratedEntryById(id);
    if (!entry) {
      return NextResponse.json({ error: "entry not found" }, { status: 404 });
    }
    return NextResponse.json(entry);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[GET /api/admin/curated-skills/[id]] unexpected:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = enforceNotMustChange(req);
  if (gate) return gate;

  const admin = await assertPlatformAdmin(req);
  if (!admin) {
    if (!req.headers.get("x-user-id")) {
      return NextResponse.json({ error: "auth required" }, { status: 401 });
    }
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  try {
    const patch = {
      name:
        typeof body.name === "string" && body.name ? body.name : undefined,
      description:
        typeof body.description === "string" ? body.description : undefined,
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
        typeof body.sourceBuiltinPath === "string"
          ? body.sourceBuiltinPath
          : undefined,
      sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : undefined,
      visibility: typeof body.visibility === "string" ? body.visibility : undefined,
      featured: typeof body.featured === "boolean" ? body.featured : undefined,
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      installCount:
        typeof body.installCount === "number" ? body.installCount : undefined,
    };
    const updated = await updateCuratedEntry(id, patch);
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof CuratedSkillError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    // eslint-disable-next-line no-console
    console.error("[PATCH /api/admin/curated-skills/[id]] unexpected:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gate = enforceNotMustChange(req);
  if (gate) return gate;

  const admin = await assertPlatformAdmin(req);
  if (!admin) {
    if (!req.headers.get("x-user-id")) {
      return NextResponse.json({ error: "auth required" }, { status: 401 });
    }
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params;
  try {
    await softDeleteCuratedEntry(id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof CuratedSkillError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    // eslint-disable-next-line no-console
    console.error("[DELETE /api/admin/curated-skills/[id]] unexpected:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}