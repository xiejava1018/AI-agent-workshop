/**
 * app/api/v1/users/route.ts
 *
 * M4 RBAC 平台中台 — 用户列表+创建。
 *
 * GET /api/v1/users
 *   - 鉴权:user:view
 *   - Query: page, pageSize, username(模糊), disabled(过滤)
 *   - 返回 { records, total, page, pageSize },records 含 roleCodes[] / permissions[]
 *
 * POST /api/v1/users
 *   - 鉴权:user:create
 *   - Body: { username, roleCodes?: string[] }
 *   - 行为:生成随机密码(22 字符 base64url,16 字节),bcrypt 哈希,必须改密标志位 true,
 *     可选地把用户绑到指定全局角色。
 *   - 返回 { id, username, initialPassword } —— 明文密码仅返回一次。
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { assertAnyPermission } from "@/lib/permissions";
import { auditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";

const BCRYPT_COST = 10;
const PASSWORD_BYTES = 16;

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "auth required" }, { status: 401 });
}
function forbidden(): NextResponse {
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}
function badRequest(msg: string): NextResponse {
  return NextResponse.json({ error: msg }, { status: 400 });
}
function conflict(msg: string): NextResponse {
  return NextResponse.json({ error: msg }, { status: 409 });
}

function generateInitialPassword(): string {
  return randomBytes(PASSWORD_BYTES).toString("base64url");
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const userId = req.headers.get("x-user-id");
  if (!userId) return unauthorized();
  if (!(await assertAnyPermission(userId, "user:view"))) return forbidden();

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(sp.get("pageSize") ?? "10", 10) || 10)
  );
  const username = sp.get("username") ?? "";
  const disabledParam = sp.get("disabled");

  const where: Record<string, unknown> = {};
  if (username) where.username = { contains: username };
  if (disabledParam !== null) {
    where.disabled = disabledParam === "true" || disabledParam === "1";
  }

  const [total, records] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        username: true,
        mustChangePassword: true,
        disabled: true,
        createdBy: true,
        createdAt: true,
        userRoles: {
          select: { role: { select: { code: true, name: true } } },
        },
      },
    }),
  ]);

  // 拍平 roleCodes
  const flat = records.map((r) => ({
    id: r.id,
    username: r.username,
    mustChangePassword: r.mustChangePassword,
    disabled: r.disabled,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    roleCodes: r.userRoles.map((ur) => ur.role.code),
    roleNames: r.userRoles.map((ur) => ur.role.name),
  }));

  return NextResponse.json({
    code: 200,
    message: "success",
    data: { records: flat, total, page, pageSize },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const callerId = req.headers.get("x-user-id");
  if (!callerId) return unauthorized();
  if (!(await assertAnyPermission(callerId, "user:create"))) return forbidden();

  const body = (await req.json().catch(() => null)) as {
    username?: string;
    roleCodes?: string[];
  } | null;
  if (!body || !body.username) return badRequest("username required");

  const username = body.username.trim();
  if (!username) return badRequest("username required");

  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) return conflict("username exists");

  let roleIds: string[] = [];
  if (Array.isArray(body.roleCodes) && body.roleCodes.length > 0) {
    const roles = await prisma.sysRole.findMany({
      where: { code: { in: body.roleCodes } },
      select: { id: true },
    });
    if (roles.length !== new Set(body.roleCodes).size) {
      return badRequest("unknown role code(s)");
    }
    roleIds = roles.map((r) => r.id);
  }

  const initialPassword = generateInitialPassword();
  const passwordHash = await bcrypt.hash(initialPassword, BCRYPT_COST);

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash,
      mustChangePassword: true,
      createdBy: callerId,
    },
    select: { id: true, username: true },
  });

  if (roleIds.length > 0) {
    await prisma.userRole.createMany({
      data: roleIds.map((rid) => ({ userId: user.id, roleId: rid })),
    });
  }

  void auditLog({
    userId: callerId,
    action: "user.create",
    resourceType: "user",
    resourceId: user.id,
    metadata: { after: { username: user.username, roleCodes: body.roleCodes ?? [] } },
  });

  return NextResponse.json({
    code: 200,
    message: "success",
    data: { id: user.id, username: user.username, initialPassword },
  });
}