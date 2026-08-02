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
 *   - Body: { username, roleCodes?: string[], password?: string, ... }
 *   - 行为:如果不提供 password,生成随机密码(22 字符 base64url,16 字节),
 *     bcrypt 哈希,必须改密标志位 true;如果提供明文 password(≥ 8 字符),
 *     bcrypt 哈希后必须改密标志位 false。可选地把用户绑到指定全局角色。
 *   - 返回 { id, username, initialPassword } —— initialPassword 仅在后端
 *     生成随机密码时返回明文;管理员指定密码的场景下为 null。
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
  const fullName = sp.get("full_name") ?? "";
  const phone = sp.get("phone") ?? "";
  const email = sp.get("email") ?? "";
  const disabledParam = sp.get("disabled");

  const where: Record<string, unknown> = {};
  if (username) where.username = { contains: username };
  if (fullName) {
    // 兼容字段命名:前端传 full_name,DB 列也是 full_name
    where.full_name = { contains: fullName };
  }
  if (phone) {
    where.phone = { contains: phone };
  }
  if (email) {
    where.email = { contains: email };
  }
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
        email: true,
        full_name: true,
        phone: true,
        gender: true,
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

  // 拍平 roleCodes + 把 disabled 转 status (1=启用 2=禁用) 供前端表格使用
  const flat = records.map((r) => ({
    id: r.id,
    username: r.username,
    email: r.email,
    full_name: r.full_name,
    phone: r.phone,
    gender: r.gender,
    disabled: r.disabled,
    status: r.disabled ? 2 : 1,
    mustChangePassword: r.mustChangePassword,
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
    email?: string;
    full_name?: string;
    phone?: string;
    gender?: number;
    password?: string;
    /** 创建后同时把该用户加入这个团队(可选)。 */
    teamId?: string;
    /** 加入团队时的角色:ADMIN | MEMBER(默认 MEMBER)。仅 teamId 提供时生效。 */
    teamRole?: "ADMIN" | "MEMBER";
  } | null;
  if (!body || !body.username) return badRequest("username required");

  const username = body.username.trim();
  if (!username) return badRequest("username required");

  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) return conflict("username exists");

  // 新增:email 唯一性校验(提供时)
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (email) {
    const dupEmail = await prisma.user.findUnique({ where: { email } });
    if (dupEmail) return conflict("email exists");
  }

  // 新增:gender 必须是 1 或 2,NULL/缺省则不写入
  let gender: number | null = null;
  if (body.gender === 1 || body.gender === 2) {
    gender = body.gender;
  }

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

  // 密码: 管理员可在创建时指定明文密码(≥ 8 字符),否则生成随机密码。
  // 指定密码的明文仅在创建响应中不返回——这是「管理员主动设的最终密码」场景,
  // 与 reset-password 生成的临时密码语义不同。只是为了提供“管理员在前端 设
  // 定」的体验,与 put-password 接口设计一致。
  let initialPassword: string | null = null;
  let passwordHash: string;
  if (typeof body.password === "string" && body.password.trim().length > 0) {
    const newPassword = body.password.trim();
    if (newPassword.length < 8) {
      return badRequest("password must be at least 8 characters");
    }
    passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  } else {
    initialPassword = generateInitialPassword();
    passwordHash = await bcrypt.hash(initialPassword, BCRYPT_COST);
  }

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash,
      mustChangePassword: true,
      createdBy: callerId,
      // 可选字段:邮箱用作唯一登录别名/找回账号,其他为画像字段
      email: email || null,
      full_name: typeof body.full_name === "string" ? body.full_name.trim() || null : null,
      phone: typeof body.phone === "string" ? body.phone.trim() || null : null,
      gender,
    },
    select: { id: true, username: true, email: true },
  });

  if (roleIds.length > 0) {
    await prisma.userRole.createMany({
      data: roleIds.map((rid) => ({ userId: user.id, roleId: rid })),
    });
  }

  // 创建后同时加入团队(可选):解决“平台管理员创了用户但用户不在任何团队 →
  // /api/agent/new 报 no project selected”的常见缺口。
  // - teamId 提供时必须存在;不存在返 400(不动已创建的 user)。
  // - teamRole 默认 MEMBER,仅接受 ADMIN/MEMBER。
  // - 如果该用户已是该团队成员,跳过(幂等)。
  // - 不会自动绑 lastProjectId:用户进团队后 ProjectPicker 让他选,避免静默选错项目。
  let teamJoined: { teamId: string; role: string } | null = null;
  if (typeof body.teamId === "string" && body.teamId.trim().length > 0) {
    const teamId = body.teamId.trim();
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { id: true },
    });
    if (!team) return badRequest("teamId does not exist");
    const teamRole: "ADMIN" | "MEMBER" =
      body.teamRole === "ADMIN" ? "ADMIN" : "MEMBER";
    const existing = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: user.id } },
      select: { teamId: true },
    });
    if (!existing) {
      await prisma.teamMember.create({
        data: { teamId, userId: user.id, role: teamRole },
      });
      teamJoined = { teamId, role: teamRole };
    }
  }

  void auditLog({
    userId: callerId,
    action: "user.create",
    resourceType: "user",
    resourceId: user.id,
    metadata: {
      after: {
        username: user.username,
        roleCodes: body.roleCodes ?? [],
        teamJoined,
      },
    },
  });

  return NextResponse.json({
    code: 200,
    message: "success",
    data: {
      id: user.id,
      username: user.username,
      // 仅当后端生成随机密码时返回明文；管理员指定密码的场景返回 null,
      // 前端能靠这个信号区分“需提示保存密码”还是“密码已知,不用提示”。
      initialPassword,
      teamJoined,
    },
  });
}