// app/api/admin/curated-skills/[id]/route.test.ts
// 技能精选库 单条 entry CRUD (PATCH/DELETE/GET) 集成测试 (T6.3)

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { GET as listGET, POST } from "../route";
import { GET, PATCH, DELETE } from "./route";

const TEST_SLUG_PREFIX = "test-curated-id-";

function uniqueSlug(label: string): string {
  return `${TEST_SLUG_PREFIX}${Date.now().toString(36)}-${label}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

async function makePlatformAdminUser(): Promise<string> {
  const u = await prisma.user.create({
    data: {
      username: `test-curated-id-admin-${Math.random().toString(36).slice(2, 10)}`,
      passwordHash: "x",
    },
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
    data: {
      username: `test-curated-id-member-${Math.random().toString(36).slice(2, 10)}`,
      passwordHash: "x",
    },
  });
  return u.id;
}

async function createEntry(userId: string, slug: string): Promise<string> {
  const res = await POST(
    new NextRequest("http://localhost:30141/api/admin/curated-skills", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-user-id": userId },
      body: JSON.stringify({ slug, name: "Orig", category: "general" }),
    }),
  );
  const body = await res.json();
  return body.id;
}

function makeReq(
  method: string,
  id: string,
  opts: { userId?: string; body?: unknown } = {},
): NextRequest {
  const url = `http://localhost:30141/api/admin/curated-skills/${id}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.userId) headers["x-user-id"] = opts.userId;
  return new NextRequest(url, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

beforeEach(async () => {
  await prisma.skillCuratedEntry.deleteMany({
    where: { slug: { startsWith: TEST_SLUG_PREFIX } },
  });
  await prisma.userRole.deleteMany({
    where: { user: { username: { startsWith: "test-curated-id-" } } },
  });
  await prisma.user.deleteMany({
    where: { username: { startsWith: "test-curated-id-" } },
  });
});

afterEach(async () => {
  await prisma.skillCuratedEntry.deleteMany({
    where: { slug: { startsWith: TEST_SLUG_PREFIX } },
  });
  await prisma.userRole.deleteMany({
    where: { user: { username: { startsWith: "test-curated-id-" } } },
  });
  await prisma.user.deleteMany({
    where: { username: { startsWith: "test-curated-id-" } },
  });
});

describe("GET /api/admin/curated-skills/[id]", () => {
  it("returns 401 without x-user-id", async () => {
    const res = await GET(makeReq("GET", "fake-id"), {
      params: Promise.resolve({ id: "fake-id" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown id", async () => {
    const userId = await makeMemberUser();
    const res = await GET(makeReq("GET", "nonexistent-id", { userId }), {
      params: Promise.resolve({ id: "nonexistent-id" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns entry for known id", async () => {
    const userId = await makePlatformAdminUser();
    const slug = uniqueSlug("get");
    const id = await createEntry(userId, slug);
    const res = await GET(makeReq("GET", id, { userId }), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe(slug);
  });
});

describe("PATCH /api/admin/curated-skills/[id]", () => {
  it("returns 401 without x-user-id", async () => {
    const res = await PATCH(
      makeReq("PATCH", "x", { body: { name: "New" } }),
      { params: Promise.resolve({ id: "x" }) },
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin", async () => {
    const userId = await makeMemberUser();
    const res = await PATCH(
      makeReq("PATCH", "x", { userId, body: { name: "New" } }),
      { params: Promise.resolve({ id: "x" }) },
    );
    expect(res.status).toBe(403);
  });

  it("returns 404 for unknown id", async () => {
    const userId = await makePlatformAdminUser();
    const res = await PATCH(
      makeReq("PATCH", "nonexistent", { userId, body: { name: "New" } }),
      { params: Promise.resolve({ id: "nonexistent" }) },
    );
    expect(res.status).toBe(404);
  });

  it("updates partial fields", async () => {
    const userId = await makePlatformAdminUser();
    const slug = uniqueSlug("patch");
    const id = await createEntry(userId, slug);
    const res = await PATCH(
      makeReq("PATCH", id, {
        userId,
        body: { name: "NewName", summary: "new summary", featured: true },
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("NewName");
    expect(body.summary).toBe("new summary");
    expect(body.featured).toBe(true);
    // 未传字段保留
    expect(body.category).toBe("general");
  });

  it("toggles enabled=false (disable)", async () => {
    const userId = await makePlatformAdminUser();
    const slug = uniqueSlug("disable");
    const id = await createEntry(userId, slug);
    const res = await PATCH(
      makeReq("PATCH", id, { userId, body: { enabled: false } }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).enabled).toBe(false);
  });
});

describe("DELETE /api/admin/curated-skills/[id]", () => {
  it("returns 401 without x-user-id", async () => {
    const res = await DELETE(makeReq("DELETE", "x"), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin", async () => {
    const userId = await makeMemberUser();
    const res = await DELETE(
      makeReq("DELETE", "x", { userId }),
      { params: Promise.resolve({ id: "x" }) },
    );
    expect(res.status).toBe(403);
  });

  it("soft-deletes entry (enabled=false, row kept)", async () => {
    const userId = await makePlatformAdminUser();
    const slug = uniqueSlug("del");
    const id = await createEntry(userId, slug);
    const res = await DELETE(
      makeReq("DELETE", id, { userId }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(204);
    const row = await prisma.skillCuratedEntry.findUniqueOrThrow({
      where: { id },
    });
    expect(row.enabled).toBe(false);
    // 列表默认不返回
    const list = await listGET(
      new NextRequest(
        `http://localhost:30141/api/admin/curated-skills?q=${slug}`,
        { headers: { "x-user-id": userId } },
      ),
    );
    const listBody = await list.json();
    expect(listBody.entries.some((e: { slug: string }) => e.slug === slug)).toBe(false);
  });
});
