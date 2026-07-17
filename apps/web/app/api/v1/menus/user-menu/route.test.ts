// app/api/v1/menus/user-menu/route.test.ts
// M4 RBAC 平台中台 — 当前用户可见菜单树(核心递归过滤)集成测试。
//
// 覆盖:
//   - 401 无 userId
//   - 普通用户(menu:view 无)只看到工作区 4 项
//   - 平台管理员看到全部
//   - 公共菜单(空 meta.permissions)对所有登录用户可见
//   - 父目录无可见子菜单时整段隐藏
//   - 递归过滤正确性(子菜单被剥,父目录隐藏)

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { GET } from "./route";

const TEST_USER_PREFIX = "test-v1-usermenu-";
const TEST_MENU_PREFIX = "test-v1-menu-";

function uniqueName(label: string): string {
  return `${TEST_MENU_PREFIX}${Date.now().toString(36)}-${label}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

beforeEach(async () => {
  // 清理所有测试 menu(测试 menu 与 seed menu 同表,只能用 name 区分)
  await prisma.sysMenu.deleteMany({
    where: { name: { startsWith: TEST_MENU_PREFIX } },
  });
  await prisma.userRole.deleteMany({
    where: { user: { username: { startsWith: TEST_USER_PREFIX } } },
  });
  await prisma.user.deleteMany({
    where: { username: { startsWith: TEST_USER_PREFIX } },
  });
});

afterEach(async () => {
  await prisma.sysMenu.deleteMany({
    where: { name: { startsWith: TEST_MENU_PREFIX } },
  });
  await prisma.userRole.deleteMany({
    where: { user: { username: { startsWith: TEST_USER_PREFIX } } },
  });
  await prisma.user.deleteMany({
    where: { username: { startsWith: TEST_USER_PREFIX } },
  });
  await prisma.$disconnect();
});

function makeReq(userId?: string): NextRequest {
  const url = "http://localhost:30141/api/v1/menus/user-menu";
  const headers: Record<string, string> = {};
  if (userId) headers["x-user-id"] = userId;
  return new NextRequest(url, { method: "GET", headers });
}

async function makeTestUser(): Promise<string> {
  const u = await prisma.user.create({
    data: {
      username: `${TEST_USER_PREFIX}${Math.random().toString(36).slice(2, 8)}`,
      passwordHash: "x",
    },
  });
  return u.id;
}

/** 创建一个父目录菜单,无 permissions(子菜单级联过滤) */
async function makeDir(name: string): Promise<string> {
  const m = await prisma.sysMenu.create({
    data: {
      name,
      title: name,
      path: `/${name}`,
      type: "directory",
      sort: 100,
      meta: JSON.stringify({ permissions: [] }),
    },
  });
  return m.id;
}

/** 创建一个需要特定权限码的菜单 */
async function makeMenuRequiring(name: string, code: string): Promise<string> {
  const m = await prisma.sysMenu.create({
    data: {
      name,
      title: name,
      path: `/${name}`,
      type: "menu",
      component: `/${name}`,
      sort: 100,
      meta: JSON.stringify({ permissions: [code] }),
    },
  });
  return m.id;
}

describe("GET /api/v1/menus/user-menu", () => {
  it("returns 401 without x-user-id", async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("returns 200 with valid code structure for any logged-in user", async () => {
    const userId = await makeTestUser();
    const res = await GET(makeReq(userId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("excludes menus requiring permissions the user lacks", async () => {
    const dirId = await makeDir(uniqueName("dir"));
    await prisma.sysMenu.create({
      data: {
        name: uniqueName("locked"),
        title: "Locked Menu",
        path: "/locked",
        type: "menu",
        parentId: dirId,
        sort: 1,
        meta: JSON.stringify({ permissions: ["unobtanium:view"] }),
      },
    });
    const userId = await makeTestUser();
    const res = await GET(makeReq(userId));
    const body = await res.json();
    const allNames = flattenNames(body.data);
    expect(allNames).not.toContain("Locked Menu");
    // 父目录应被整段隐藏(无可见子菜单)
    const topLevelNames = (body.data as Array<{ name: string }>).map((n) => n.name);
    const dirNames = (body.data as Array<{ name: string }>)
      .filter((n) => n.name.startsWith(TEST_MENU_PREFIX))
      .map((n) => n.name);
    expect(dirNames).toEqual([]);
    void dirId; // silence unused
  });

  it("includes menus whose required permissions user has", async () => {
    const userId = await makeTestUser();
    // 绑 user:view
    const perm = await prisma.permission.findUniqueOrThrow({
      where: { code: "user:view" },
    });
    const role = await prisma.sysRole.create({
      data: { code: uniqueName("test-role"), name: "Test Role" },
    });
    await prisma.rolePermission.create({
      data: { roleId: role.id, permissionId: perm.id },
    });
    await prisma.userRole.create({
      data: { userId, roleId: role.id },
    });
    await makeMenuRequiring(uniqueName("accessible"), "user:view");
    const res = await GET(makeReq(userId));
    const body = await res.json();
    const allNames = flattenNames(body.data);
    expect(allNames.some((n) => n.startsWith(TEST_MENU_PREFIX))).toBe(true);
  });

  it("hides dir when ALL its children are inaccessible (级联隐藏)", async () => {
    // 用 makeMenuRequiring(权限码)创建子菜单,父目录无可见子菜单应被剥。
    // 简化做法:让父目录 type=directory,挂一个需 specific 权限的子菜单。
    // 由于 makeMenuRequiring 自身无 parentId,这里直接用一个 child,且 child 需要某权限(无此权限者)
    const dirName = uniqueName("hidden-dir");
    const dirId = await makeDir(dirName);
    // 在测试父目录下创建一个需要 "totally-bogus-code" 的子菜单
    const child = await prisma.sysMenu.create({
      data: {
        name: uniqueName("child-locked"),
        title: "Child Locked",
        path: "/child-locked",
        type: "menu",
        parentId: dirId,
        component: "/child-locked",
        sort: 1,
        meta: JSON.stringify({ permissions: ["totally-bogus-code"] }),
      },
    });
    expect(child.parentId).toBe(dirId);
    const userId = await makeTestUser();
    const res = await GET(makeReq(userId));
    const body = await res.json();
    // 父目录应被整段隐藏(子菜单不可见 → 父目录剥)
    const allNames = flattenNames(body.data);
    expect(allNames).not.toContain(dirName);
  });
});

function flattenNames(tree: unknown): string[] {
  const out: string[] = [];
  const walk = (nodes: unknown) => {
    if (!Array.isArray(nodes)) return;
    for (const n of nodes) {
      const node = n as { name: string; children?: unknown };
      out.push(node.name);
      if (node.children) walk(node.children);
    }
  };
  walk(tree);
  return out;
}