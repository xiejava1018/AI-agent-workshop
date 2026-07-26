// app/api/admin/curated-skills/route.test.ts
// 技能精选库 admin CRUD 集成测试 (T6.2)
//
// 鉴权矩阵 + slug 唯一性 + featured 排序 + 软删 + categories 聚合。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { GET, POST } from "./route";

const TEST_SLUG_PREFIX = "test-curated-";

function uniqueSlug(label: string): string {
  return `${TEST_SLUG_PREFIX}${Date.now().toString(36)}-${label}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

async function makePlatformAdminUser(): Promise<string> {
  const u = await prisma.user.create({
    data: { username: `test-curated-admin-${Math.random().toString(36).slice(2, 10)}`, passwordHash: "x" },
  });
  const roleId = await prisma.sysRole.findUniqueOrThrow({
    where: { code: "platform_admin" },
    select: { id: true },
  });
  await prisma.userRole.create({ data: { userId: u.id, roleId: roleId.id } });
  return u.id;
}

async function makeMemberUser(): Promise<string> {
  const u = await prisma.user.create({
    data: { username: `test-curated-member-${Math.random().toString(36).slice(2, 10)}`, passwordHash: "x" },
  });
  // 无 platform_admin 角色
  return u.id;
}

function makeGetReq(userId?: string, query = ""): NextRequest {
  const url = `http://localhost:30141/api/admin/curated-skills${query}`;
  const headers: Record<string, string> = {};
  if (userId) headers["x-user-id"] = userId;
  return new NextRequest(url, { method: "GET", headers });
}

function makePostReq(opts: { userId?: string; body?: unknown }): NextRequest {
  const url = "http://localhost:30141/api/admin/curated-skills";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.userId) headers["x-user-id"] = opts.userId;
  return new NextRequest(url, {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body),
  });
}

beforeEach(async () => {
  await prisma.skillCuratedEntry.deleteMany({
    where: { slug: { startsWith: TEST_SLUG_PREFIX } },
  });
  await prisma.userRole.deleteMany({
    where: { user: { username: { startsWith: "test-curated-" } } },
  });
  await prisma.user.deleteMany({
    where: { username: { startsWith: "test-curated-" } },
  });
});

afterEach(async () => {
  await prisma.skillCuratedEntry.deleteMany({
    where: { slug: { startsWith: TEST_SLUG_PREFIX } },
  });
  await prisma.userRole.deleteMany({
    where: { user: { username: { startsWith: "test-curated-" } } },
  });
  await prisma.user.deleteMany({
    where: { username: { startsWith: "test-curated-" } },
  });
});

describe("GET /api/admin/curated-skills", () => {
  it("returns 401 without x-user-id", async () => {
    const res = await GET(makeGetReq());
    expect(res.status).toBe(401);
  });

  it("returns 200 with empty list for member (read allowed)", async () => {
    const userId = await makeMemberUser();
    const res = await GET(makeGetReq(userId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.entries)).toBe(true);
    expect(typeof body.total).toBe("number");
  });

  it("filters by category", async () => {
    const userId = await makePlatformAdminUser();
    const slugA = uniqueSlug("a");
    const slugB = uniqueSlug("b");
    await POST(
      makePostReq({
        userId,
        body: { slug: slugA, name: "A", category: "development" },
      }),
    );
    await POST(
      makePostReq({
        userId,
        body: { slug: slugB, name: "B", category: "security" },
      }),
    );
    const res = await GET(makeGetReq(userId, "?category=development"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.entries.some((e: { slug: string }) => e.slug === slugA)).toBe(true);
    expect(body.entries.some((e: { slug: string }) => e.slug === slugB)).toBe(false);
  });

  it("filters by tag (contains)", async () => {
    const userId = await makePlatformAdminUser();
    const slugA = uniqueSlug("tagged");
    await POST(
      makePostReq({
        userId,
        body: { slug: slugA, name: "Tagged", tags: ["svg", "diagram"] },
      }),
    );
    const res = await GET(makeGetReq(userId, "?tag=svg"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.entries.some((e: { slug: string }) => e.slug === slugA)).toBe(true);
  });

  it("filters by featured=true", async () => {
    const userId = await makePlatformAdminUser();
    const slugA = uniqueSlug("feat");
    const slugB = uniqueSlug("nofeat");
    await POST(
      makePostReq({
        userId,
        body: { slug: slugA, name: "F", featured: true },
      }),
    );
    await POST(
      makePostReq({
        userId,
        body: { slug: slugB, name: "NF", featured: false },
      }),
    );
    const res = await GET(makeGetReq(userId, "?featured=true"));
    const body = await res.json();
    expect(body.entries.some((e: { slug: string }) => e.slug === slugA)).toBe(true);
    expect(body.entries.some((e: { slug: string }) => e.slug === slugB)).toBe(false);
  });

  it("excludes soft-deleted by default", async () => {
    const userId = await makePlatformAdminUser();
    const slug = uniqueSlug("soft");
    await POST(makePostReq({ userId, body: { slug, name: "S" } }));
    const created = await prisma.skillCuratedEntry.findUniqueOrThrow({
      where: { slug },
    });
    await prisma.skillCuratedEntry.update({
      where: { id: created.id },
      data: { enabled: false },
    });
    const res = await GET(makeGetReq(userId, `?q=${slug}`));
    const body = await res.json();
    expect(body.entries.some((e: { slug: string }) => e.slug === slug)).toBe(false);
    const resWithDisabled = await GET(makeGetReq(userId, `?q=${slug}&enabled=false`));
    const bodyWithDisabled = await resWithDisabled.json();
    expect(bodyWithDisabled.entries.some((e: { slug: string }) => e.slug === slug)).toBe(true);
  });
});

describe("POST /api/admin/curated-skills", () => {
  it("returns 401 without x-user-id", async () => {
    const res = await POST(makePostReq({ body: { slug: "x", name: "X" } }));
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-platform-admin", async () => {
    const userId = await makeMemberUser();
    const res = await POST(
      makePostReq({ userId, body: { slug: uniqueSlug("forbidden"), name: "X" } }),
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid slug", async () => {
    const userId = await makePlatformAdminUser();
    const res = await POST(
      makePostReq({
        userId,
        body: { slug: "Has Spaces", name: "X" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 201 for OWNER", async () => {
    const userId = await makePlatformAdminUser();
    const slug = uniqueSlug("ok");
    const res = await POST(
      makePostReq({
        userId,
        body: { slug, name: "OK", summary: "hello", tags: ["a", "b"] },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.slug).toBe(slug);
    expect(body.tags).toEqual(["a", "b"]);
  });

  it("returns 409 for duplicate slug", async () => {
    const userId = await makePlatformAdminUser();
    const slug = uniqueSlug("dup");
    await POST(makePostReq({ userId, body: { slug, name: "First" } }));
    const res = await POST(makePostReq({ userId, body: { slug, name: "Second" } }));
    expect(res.status).toBe(409);
  });
});