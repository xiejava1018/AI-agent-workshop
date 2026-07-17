// app/api/v1/permissions/route.test.ts
// M4 RBAC 平台中台 — 权限码列表端点的集成测试。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { GET } from "./route";

const TEST_USER_PREFIX = "test-v1-perm-";

function uniqueUsername(label: string): string {
  return `${TEST_USER_PREFIX}${Date.now().toString(36)}-${label}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

beforeEach(async () => {
  await prisma.userRole.deleteMany({
    where: { user: { username: { startsWith: TEST_USER_PREFIX } } },
  });
  await prisma.user.deleteMany({
    where: { username: { startsWith: TEST_USER_PREFIX } },
  });
});

afterEach(async () => {
  await prisma.userRole.deleteMany({
    where: { user: { username: { startsWith: TEST_USER_PREFIX } } },
  });
  await prisma.user.deleteMany({
    where: { username: { startsWith: TEST_USER_PREFIX } },
  });
  await prisma.$disconnect();
});

function makeReq(userId?: string): NextRequest {
  const url = "http://localhost:30141/api/v1/permissions";
  const headers: Record<string, string> = {};
  if (userId) headers["x-user-id"] = userId;
  return new NextRequest(url, { method: "GET", headers });
}

async function makeTestUser(): Promise<string> {
  const u = await prisma.user.create({
    data: {
      username: uniqueUsername("u"),
      passwordHash: "x",
    },
  });
  return u.id;
}

describe("GET /api/v1/permissions", () => {
  it("returns 401 without x-user-id", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("returns 200 with permission codes for any logged-in user", async () => {
    const userId = await makeTestUser();
    const res = await GET(makeReq(userId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    // 应至少包含 seed 出来的 58 条
    expect(body.data.length).toBeGreaterThanOrEqual(58);
    // 应包含 platform:access(已被 seed)
    const codes = body.data.map((p: { code: string }) => p.code);
    expect(codes).toContain("platform:access");
    expect(codes).toContain("user:view");
  });

  it("orders by module ascending first", async () => {
    const userId = await makeTestUser();
    const res = await GET(makeReq(userId));
    const body = await res.json();
    const data: Array<{ module: string; sort: number; code: string }> = body.data;
    // module 必须非递减
    for (let i = 1; i < data.length; i++) {
      expect(data[i - 1].module <= data[i].module).toBe(true);
    }
  });
});