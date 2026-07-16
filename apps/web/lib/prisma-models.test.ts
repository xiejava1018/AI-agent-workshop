// lib/prisma-models.test.ts
import { describe, it, expect } from "vitest";
import { prisma } from "./prisma";

describe("M3 models", () => {
  it("creates an Agent (digital employee)", async () => {
    const agent = await prisma.agent.create({
      data: {
        name: "代码审查员",
        description: "review code",
        systemPrompt: "you are a reviewer",
        model: "anthropic/claude-opus-4-8",
        scope: "personal",
      },
    });
    expect(agent.id).toBeTruthy();
    expect(agent.scope).toBe("personal");
    await prisma.agent.delete({ where: { id: agent.id } });
  });

  it("creates skill/mcp bindings with mode", async () => {
    const b = await prisma.agentSkillBinding.create({
      data: { agentId: "a1", skillPackageId: "s1", mode: "include" },
    });
    expect(b.mode).toBe("include");
    await prisma.agentSkillBinding.delete({ where: { id: b.id } });
  });

  it("creates a SkillPackage with scope", async () => {
    const s = await prisma.skillPackage.create({
      data: {
        slug: "commit",
        name: "commit",
        scope: "global",
        source: "builtin",
        filePath: "/skills/commit",
      },
    });
    expect(s.scope).toBe("global");
    await prisma.skillPackage.delete({ where: { id: s.id } });
  });

  it("creates a SkillInvocation record", async () => {
    const s = await prisma.skillPackage.create({
      data: {
        slug: "review",
        name: "review",
        scope: "global",
        source: "builtin",
        filePath: "/skills/review",
      },
    });
    const inv = await prisma.skillInvocation.create({
      data: { skillPackageId: s.id, userId: "u1" },
    });
    expect(inv.skillPackageId).toBe(s.id);
    await prisma.skillInvocation.delete({ where: { id: inv.id } });
    await prisma.skillPackage.delete({ where: { id: s.id } });
  });

  it("creates an McpServer with encrypted config field", async () => {
    const m = await prisma.mcpServer.create({
      data: { name: "fs", transport: "stdio", command: "npx fs-mcp", scope: "team", teamId: "t1", configEnc: "ENCRYPTED" },
    });
    expect(m.configEnc).toBe("ENCRYPTED");
    await prisma.mcpServer.delete({ where: { id: m.id } });
  });

  it("creates a DelegationTree node", async () => {
    const d = await prisma.delegationTree.create({
      data: { rootSessionId: "r1", parentSessionId: "r1", childSessionId: "c1", mode: "sync", depth: 1, status: "running" },
    });
    expect(d.depth).toBe(1);
    await prisma.delegationTree.delete({ where: { id: d.id } });
  });

  it("creates an InviteLink", async () => {
    const inv = await prisma.inviteLink.create({
      data: { teamId: "t1", token: "tok123", role: "MEMBER", expiresAt: new Date(Date.now() + 86400000), requireAccount: true },
    });
    expect(inv.token).toBe("tok123");
    await prisma.inviteLink.delete({ where: { id: inv.id } });
  });

  it("creates PlatformApiKey/UserApiKey with encrypted secret", async () => {
    const p = await prisma.platformApiKey.create({ data: { provider: "anthropic", secretEnc: "ENC" } });
    const u = await prisma.userApiKey.create({ data: { userId: "u1", provider: "openai", secretEnc: "ENC" } });
    expect(p.secretEnc).toBe("ENC");
    expect(u.provider).toBe("openai");
    await prisma.platformApiKey.delete({ where: { id: p.id } });
    await prisma.userApiKey.delete({ where: { id: u.id } });
  });

  it("reads user quota fields", async () => {
    const u = await prisma.user.create({ data: { username: `q_${Date.now()}`, passwordHash: "x", tokenDailyLimit: 100000, maxConcurrentSessions: 5 } });
    expect(u.tokenDailyLimit).toBe(100000);
    await prisma.user.delete({ where: { id: u.id } });
  });

  it("creates a Session metadata row", async () => {
    const s = await prisma.session.create({
      data: { userId: "u1", teamId: "t1", projectId: "p1", title: "s", status: "active", jsonlPath: "/x.jsonl" },
    });
    expect(s.projectId).toBe("p1");
    await prisma.session.delete({ where: { id: s.id } });
  });
});
