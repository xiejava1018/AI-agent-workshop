// tests/integration/list-sessions-zombie-filter.test.ts
//
// fix-agent-workbench-delete-session-404 — RED phase (TDD).
//
// Reproduces the bug where dashboard "Agent 工作台"侧栏在 platform_admin
// 账号下能看到 DB 有 row 但磁盘无 .jsonl 的"僵尸" session，点删除必
// 跳 404（route.ts DELETE 走 resolveSessionPath → null → 404）。
//
// 测试断言：admin 用 listSessions 必须把"磁盘无 .jsonl"的 session
// 从 items 里过滤掉，从而保证 UI 列出的 id 都能 DELETE 成功。
//
// 当前 route.ts 实现不带这层过滤 → RED 失败。

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

const TEST_SESSION_PREFIX = "test-zombie-session-";
const TEST_TEAM_PREFIX = "test-zombie-team-";
const TEST_USERNAME_PREFIX = "test-zombie-user-";
const TEST_ROLE_PREFIX = "test-zombie-role-";

function uniqueId(label: string, prefix: string): string {
  return `${prefix}${Date.now().toString(36)}-${label}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

async function cleanTestRows(): Promise<void> {
  await prisma.session.deleteMany({
    where: { title: { startsWith: TEST_SESSION_PREFIX } },
  });
  const teams = await prisma.team.findMany({
    where: { name: { startsWith: TEST_TEAM_PREFIX } },
    select: { id: true },
  });
  const teamIds = teams.map((t) => t.id);
  if (teamIds.length > 0) {
    await prisma.project.deleteMany({ where: { teamId: { in: teamIds } } });
  }
  await prisma.teamMember.deleteMany({
    where: { team: { name: { startsWith: TEST_TEAM_PREFIX } } },
  });
  await prisma.team.deleteMany({
    where: { name: { startsWith: TEST_TEAM_PREFIX } },
  });
  const testRoles = await prisma.sysRole.findMany({
    where: { code: { startsWith: TEST_ROLE_PREFIX } },
    select: { id: true },
  });
  for (const r of testRoles) {
    await prisma.userRole.deleteMany({ where: { roleId: r.id } });
    await prisma.rolePermission.deleteMany({ where: { roleId: r.id } });
  }
  await prisma.sysRole.deleteMany({
    where: { code: { startsWith: TEST_ROLE_PREFIX } },
  });
  await prisma.user.deleteMany({
    where: { username: { startsWith: TEST_USERNAME_PREFIX } },
  });
}

beforeEach(async () => {
  await cleanTestRows();
});

afterAll(async () => {
  await cleanTestRows();
  await prisma.$disconnect();
});

/**
 * 创建一个用户 + 一个 team + 一个 project；返回这一组 fixtures 的 id。
 */
async function makeUserTeamProject(label: string): Promise<{
  userId: string;
  teamId: string;
  projectId: string;
}> {
  const username = uniqueId(label, TEST_USERNAME_PREFIX);
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: "not-used",
      mustChangePassword: false,
    },
  });
  const team = await prisma.team.create({
    data: {
      name: uniqueId(label, TEST_TEAM_PREFIX),
      ownerUserId: user.id,
    },
  });
  const project = await prisma.project.create({
    data: {
      teamId: team.id,
      name: "Test Project",
      rootPath: "/tmp/test-project",
      createdBy: user.id,
    },
  });
  return { userId: user.id, teamId: team.id, projectId: project.id };
}

/**
 * 创建一个 DB session row,故意不写任何 .jsonl 文件。
 *
 * 这是"僵尸 session"模拟：DB 有 row,磁盘 .jsonl 不存在,与
 * apps/web/app/api/agent/sessions/route.ts listSessions loop 期望
 * 的"available:false" 行为对应。
 */
async function makeZombieSession(opts: {
  userId: string;
  teamId: string;
  projectId: string;
  title: string;
}): Promise<{ id: string }> {
  const session = await prisma.session.create({
    data: {
      userId: opts.userId,
      teamId: opts.teamId,
      projectId: opts.projectId,
      title: opts.title,
      jsonlPath: `/tmp/nonexistent-zombie-${opts.userId}.jsonl`,
      status: "active",
    },
  });
  return { id: session.id };
}

/**
 * 创建一个 self-contained platform_admin: 用户拿到 platform:access
 * permission (复用 session-privacy.test.ts 的相同模式)。
 */
async function makePlatformAdmin(): Promise<string> {
  const roleCode = uniqueId("plat", TEST_ROLE_PREFIX);
  const user = await prisma.user.create({
    data: {
      username: uniqueId("plat-admin", TEST_USERNAME_PREFIX),
      passwordHash: "not-used",
      mustChangePassword: false,
    },
  });
  const permission = await prisma.permission.upsert({
    where: { code: "platform:access" },
    update: {},
    create: { code: "platform:access", module: "平台准入", name: "进入平台管理", sort: 200 },
  });
  const role = await prisma.sysRole.create({
    data: { code: roleCode, name: "测试-admin", enabled: true, sort: 0 },
  });
  await prisma.rolePermission.create({
    data: { roleId: role.id, permissionId: permission.id },
  });
  await prisma.userRole.create({
    data: { userId: user.id, roleId: role.id },
  });
  return user.id;
}

function makeAgentListReq(opts: { callerId: string }): NextRequest {
  const url = new URL("http://localhost:30141/api/agent/sessions");
  url.searchParams.set("page", "1");
  url.searchParams.set("page_size", "100");
  const headers: Record<string, string> = {
    "x-user-id": opts.callerId,
    "x-must-change-password": "false",
  };
  return new NextRequest(url, { method: "GET", headers });
}

describe("listSessions (platform_admin) 必须过滤磁盘无 .jsonl 的 zombie session", () => {
  it("不返回 DB 有 row 但磁盘 .jsonl 不存在的 zombie session", async () => {
    const fixtures = await makeUserTeamProject("owner");
    const zombieId = (
      await makeZombieSession({
        userId: fixtures.userId,
        teamId: fixtures.teamId,
        projectId: fixtures.projectId,
        title: `${TEST_SESSION_PREFIX}zombie-${Date.now()}`,
      })
    ).id;

    const adminId = await makePlatformAdmin();
    const { GET } = await import("../../app/api/agent/sessions/route");
    const req = makeAgentListReq({ callerId: adminId });

    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    const items = body?.data?.items ?? [];
    const returnedIds = items.map((it: { id: string }) => it.id);

    // RED: 当前 listSessions 在 platform_admin bypass 下返 zombie session,
    //      修复后预期这条断言通过。
    expect(returnedIds).not.toContain(zombieId);
  });
});
