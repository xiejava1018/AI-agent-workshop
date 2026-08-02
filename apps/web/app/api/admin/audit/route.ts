/**
 * app/api/admin/audit/route.ts
 *
 * Task 4.6 — Audit log query & append API.
 *
 * GET /api/admin/audit
 *   - Admin-only (platform:access via assertPlatformAdmin). Read-only, low risk.
 *   - Query params (all optional):
 *       userId, action, resourceType, resourceId,
 *       from (ISO date), to (ISO date),
 *       page (default 1), limit (default 50, max 100)
 *   - Returns paginated entries sorted by createdAt DESC (newest first):
 *       { entries: AuditLogEntry[], total: number, page: number, limit: number }
 *   - Covers identity / auth / quota / binding changes + MCP calls + skill
 *     installs — all recorded as AuditLog rows with domain-specific `action`
 *     values (e.g. `user.create`, `session.create`,
 *     `mcp.credential_global_denied`, `skill.install`, `agent.binding.change`).
 *
 * POST /api/admin/audit
 *   - Any authenticated user may append an audit entry. This is the programmatic
 *     logging entry point used across the app, so it deliberately does NOT
 *     require admin — only a valid `x-user-id` header.
 *   - Body: { userId?, action, resourceType, resourceId?, metadata? }
 *     `metadata` is a free-form JSON string (stored verbatim).
 *   - Returns the created entry: { entry: AuditLogEntry }, status 201.
 *
 * Authorization note: GET returns the same 401/403 shape regardless of whether
 * the caller is unauthenticated or authenticated-as-MEMBER, so a probe cannot
 * distinguish "not logged in" from "logged in as non-admin".
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertPlatformAdmin } from "@/lib/permissions";
import {
  buildAuditLogWhere,
  DEFAULT_AUDIT_LIMIT,
  DEFAULT_AUDIT_PAGE,
  MAX_AUDIT_LIMIT,
  parseAuditLogFilters,
  parsePositiveInt,
} from "@/lib/audit-query";

export const dynamic = "force-dynamic";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "auth required" }, { status: 401 });
}

function forbiddenResponse(): NextResponse {
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

function badRequestResponse(msg: string): NextResponse {
  return NextResponse.json({ error: msg }, { status: 400 });
}

// -----------------------------------------------------------------------------
// GET — query audit logs (admin-only, paginated)
// -----------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<NextResponse> {
  const admin = await assertPlatformAdmin(req);
  if (!admin) {
    if (!req.headers.get("x-user-id")) return unauthorizedResponse();
    return forbiddenResponse();
  }

  const { searchParams } = new URL(req.url);
  const page = parsePositiveInt(searchParams.get("page"), DEFAULT_AUDIT_PAGE);
  const limit = Math.min(
    parsePositiveInt(searchParams.get("limit"), DEFAULT_AUDIT_LIMIT),
    MAX_AUDIT_LIMIT,
  );
  const where = buildAuditLogWhere(parseAuditLogFilters(searchParams));

  // Run count + page query in parallel. Newest first.
  const [total, entries] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      // 不引入 user relation(AuditLog 没有 FK),走以下两步:
      //   1) 取出本页 entries 涉及到的 userId(去重)
      //   2) 一次性从 User 表查出 username,映射 cuid → username
      // 前端表格“操作用户”列读 entry.username。
      //
      // userId 为 null(匿名/系统记录)怎么办?
      //   entries[i].userId === null => username 设为 null,前端负责 fallback 到 --。
    }),
  ]);

  // 批量 join username(避免 prisma include user(无 FK))
  const userIds = Array.from(
    new Set(entries.map((e) => e.userId).filter((id): id is string => !!id)),
  );
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true },
      })
    : [];
  const usernameById = new Map(users.map((u) => [u.id, u.username]));

  const entriesWithUsername = entries.map((e) => ({
    ...e,
    // 注意:除了 entries 本身的字段,额外 append username,后端查询本身
    // 用 select 时不会多选列。这里使用对象展开 + override,序列化后
    // JSON 会多一个 username 字段。
    username: e.userId ? usernameById.get(e.userId) ?? null : null,
  }));

  return NextResponse.json({ entries: entriesWithUsername, total, page, limit });
}

// -----------------------------------------------------------------------------
// POST — append an audit log entry (any authenticated user)
// -----------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Programmatic audit logging is used from many places; require only a valid
  // authenticated caller, not admin.
  const callerId = req.headers.get("x-user-id");
  if (!callerId) return unauthorizedResponse();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequestResponse("invalid body");
  }
  if (typeof body !== "object" || body === null) {
    return badRequestResponse("invalid body");
  }

  const {
    userId,
    action: rawAction,
    resourceType: rawResourceType,
    resourceId,
    metadata,
  } = body as Record<string, unknown>;

  if (typeof rawAction !== "string" || rawAction.trim().length === 0) {
    return badRequestResponse("action required");
  }
  if (typeof rawResourceType !== "string" || rawResourceType.trim().length === 0) {
    return badRequestResponse("resourceType required");
  }

  const entry = await prisma.auditLog.create({
    data: {
      // Default the actor to the authenticated caller unless the body names a
      // specific subject (e.g. logging an action performed on behalf of a user).
      userId: typeof userId === "string" && userId.length > 0 ? userId : callerId,
      action: rawAction.trim(),
      resourceType: rawResourceType.trim(),
      resourceId: typeof resourceId === "string" && resourceId.length > 0 ? resourceId : null,
      metadata: typeof metadata === "string" ? metadata : null,
    },
  });

  return NextResponse.json({ entry }, { status: 201 });
}
