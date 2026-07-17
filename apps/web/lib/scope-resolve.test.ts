// lib/scope-resolve.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveAgentSkills, resolveAgentMcpServers } from "./scope-resolve";
import { prisma } from "./prisma";

const mockPkg = (slug: string) => ({ id: `id-${slug}`, slug, name: slug, enabled: true });
const mockMcp = (id: string, name = id, configEnc: string | null = null) => ({
  id,
  name,
  transport: "stdio" as const,
  configEnc,
});

describe("resolveAgentSkills", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves skills across four layers with agent-layer mode convergence", async () => {
    vi.spyOn(prisma.skillPackage, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.userSkillBinding, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.agentSkillBinding, "findMany").mockResolvedValue([]);
    const resolved = await resolveAgentSkills({ agentId: "a1", userId: "u1", teamId: "t1" });
    expect(Array.isArray(resolved.skills)).toBe(true);
  });

  it("personal scope skips team layer", async () => {
    vi.spyOn(prisma.skillPackage, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.userSkillBinding, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.agentSkillBinding, "findMany").mockResolvedValue([]);
    const resolved = await resolveAgentSkills({
      agentId: "a1",
      userId: "u1",
      teamId: null,
      scope: "personal",
    });
    expect(resolved.layersApplied).not.toContain("team");
  });

  it("user layer exclude removes skill from global layer", async () => {
    vi.spyOn(prisma.skillPackage, "findMany")
      .mockResolvedValueOnce([mockPkg("skill-a")]) // global
      .mockResolvedValueOnce([]); // team (skipped by personal)
    vi.spyOn(prisma.userSkillBinding, "findMany").mockResolvedValueOnce([
      { skillPackageId: "id-skill-a", mode: "exclude" },
    ]);
    vi.spyOn(prisma.skillPackage, "findUnique").mockResolvedValueOnce(mockPkg("skill-a"));
    vi.spyOn(prisma.agentSkillBinding, "findMany").mockResolvedValueOnce([]);

    const resolved = await resolveAgentSkills({ agentId: "a1", userId: "u1", teamId: "t1" });
    expect(resolved.skills).not.toContain("skill-a");
  });

  it("agent layer exclude removes skill from team layer", async () => {
    vi.spyOn(prisma.skillPackage, "findMany")
      .mockResolvedValueOnce([mockPkg("skill-b")]) // global
      .mockResolvedValueOnce([mockPkg("skill-b")]) // team
      .mockResolvedValueOnce([]); // user
    vi.spyOn(prisma.userSkillBinding, "findMany").mockResolvedValueOnce([]);
    vi.spyOn(prisma.agentSkillBinding, "findMany").mockResolvedValueOnce([
      { skillPackageId: "id-skill-b", mode: "exclude" },
    ]);
    vi.spyOn(prisma.skillPackage, "findUnique").mockResolvedValueOnce(mockPkg("skill-b"));

    const resolved = await resolveAgentSkills({ agentId: "a1", userId: "u1", teamId: "t1" });
    expect(resolved.skills).not.toContain("skill-b");
  });

  it("returns layersApplied with correct order (global → team → user → agent)", async () => {
    vi.spyOn(prisma.skillPackage, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.userSkillBinding, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.agentSkillBinding, "findMany").mockResolvedValue([]);

    const resolved = await resolveAgentSkills({ agentId: "a1", userId: "u1", teamId: "t1" });
    expect(resolved.layersApplied).toEqual(["global", "team", "user", "agent"]);
  });

  it("user layer include adds skill on top of global", async () => {
    vi.spyOn(prisma.skillPackage, "findMany")
      .mockResolvedValueOnce([mockPkg("global-skill")]) // global
      .mockResolvedValueOnce([mockPkg("team-skill")]) // team
      .mockResolvedValueOnce([]); // user
    vi.spyOn(prisma.userSkillBinding, "findMany").mockResolvedValueOnce([
      { skillPackageId: "id-user-skill", mode: "include" },
    ]);
    vi.spyOn(prisma.skillPackage, "findUnique").mockResolvedValueOnce(mockPkg("user-skill"));
    vi.spyOn(prisma.agentSkillBinding, "findMany").mockResolvedValueOnce([]);

    const resolved = await resolveAgentSkills({ agentId: "a1", userId: "u1", teamId: "t1" });
    expect(resolved.skills).toContain("global-skill");
    expect(resolved.skills).toContain("team-skill");
    expect(resolved.skills).toContain("user-skill");
  });

  it("agent layer include adds skill on top of team", async () => {
    vi.spyOn(prisma.skillPackage, "findMany")
      .mockResolvedValueOnce([mockPkg("g-skill")]) // global
      .mockResolvedValueOnce([mockPkg("t-skill")]) // team
      .mockResolvedValueOnce([]); // user
    vi.spyOn(prisma.userSkillBinding, "findMany").mockResolvedValueOnce([]);
    vi.spyOn(prisma.agentSkillBinding, "findMany").mockResolvedValueOnce([
      { skillPackageId: "id-a-skill", mode: "include" },
    ]);
    vi.spyOn(prisma.skillPackage, "findUnique").mockResolvedValueOnce(mockPkg("a-skill"));

    const resolved = await resolveAgentSkills({ agentId: "a1", userId: "u1", teamId: "t1" });
    expect(resolved.skills).toContain("a-skill");
  });
});

describe("resolveAgentMcpServers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves MCP servers across layers, filters disabled", async () => {
    vi.spyOn(prisma.mcpServer, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.agentMcpBinding, "findMany").mockResolvedValue([]);
    const resolved = await resolveAgentMcpServers({ agentId: "a1", userId: "u1", teamId: "t1" });
    expect(Array.isArray(resolved.mcpServers)).toBe(true);
  });

  it("denies credentialed MCP at global scope and populates deniedGlobalCredential", async () => {
    vi.spyOn(prisma.mcpServer, "findMany").mockResolvedValueOnce([
      { ...mockMcp("mcp-global-creds"), configEnc: "encrypted-secret" },
      { ...mockMcp("mcp-global-clean"), configEnc: null },
    ]);
    vi.spyOn(prisma.agentMcpBinding, "findMany").mockResolvedValueOnce([]);

    const resolved = await resolveAgentMcpServers({ agentId: "a1", userId: "u1", teamId: "t1" });
    expect(resolved.deniedGlobalCredential).toContain("mcp-global-creds");
    expect(resolved.mcpServers.find((s) => s.id === "mcp-global-creds")).toBeUndefined();
    expect(resolved.mcpServers.find((s) => s.id === "mcp-global-clean")).toBeDefined();
  });

  it("personal scope skips team layer", async () => {
    vi.spyOn(prisma.mcpServer, "findMany")
      .mockResolvedValueOnce([]) // global
      .mockResolvedValueOnce([]) // user
      .mockResolvedValueOnce([]); // agent bindings
    vi.spyOn(prisma.agentMcpBinding, "findMany").mockResolvedValueOnce([]);

    const resolved = await resolveAgentMcpServers({
      agentId: "a1",
      userId: "u1",
      teamId: "t1",
      scope: "personal",
    });
    expect(resolved.mcpServers.map((s) => s.id)).not.toContain("team-mcp");
  });

  it("agent layer exclude removes MCP from effective set", async () => {
    vi.spyOn(prisma.mcpServer, "findMany")
      .mockResolvedValueOnce([mockMcp("global-mcp")]) // global
      .mockResolvedValueOnce([]) // team
      .mockResolvedValueOnce([mockMcp("user-mcp")]); // user
    vi.spyOn(prisma.agentMcpBinding, "findMany").mockResolvedValueOnce([
      { mcpServerId: "user-mcp", mode: "exclude" },
    ]);
    vi.spyOn(prisma.mcpServer, "findUnique").mockResolvedValueOnce(mockMcp("user-mcp"));

    const resolved = await resolveAgentMcpServers({ agentId: "a1", userId: "u1", teamId: "t1" });
    expect(resolved.mcpServers.find((s) => s.id === "user-mcp")).toBeUndefined();
  });

  it("agent layer include adds MCP to effective set", async () => {
    vi.spyOn(prisma.mcpServer, "findMany")
      .mockResolvedValueOnce([]) // global
      .mockResolvedValueOnce([]) // team
      .mockResolvedValueOnce([]); // user
    vi.spyOn(prisma.agentMcpBinding, "findMany").mockResolvedValueOnce([
      { mcpServerId: "agent-mcp", mode: "include" },
    ]);
    vi.spyOn(prisma.mcpServer, "findUnique").mockResolvedValueOnce(mockMcp("agent-mcp"));

    const resolved = await resolveAgentMcpServers({ agentId: "a1", userId: "u1", teamId: "t1" });
    expect(resolved.mcpServers.find((s) => s.id === "agent-mcp")).toBeDefined();
  });

  it("mcp not found for binding is skipped gracefully", async () => {
    vi.spyOn(prisma.mcpServer, "findMany")
      .mockResolvedValueOnce([]) // global
      .mockResolvedValueOnce([]) // team
      .mockResolvedValueOnce([]); // user
    vi.spyOn(prisma.agentMcpBinding, "findMany").mockResolvedValueOnce([
      { mcpServerId: "missing-mcp", mode: "exclude" },
    ]);
    vi.spyOn(prisma.mcpServer, "findUnique").mockResolvedValueOnce(null); // MCP gone

    const resolved = await resolveAgentMcpServers({ agentId: "a1", userId: "u1", teamId: "t1" });
    expect(resolved.mcpServers).toHaveLength(0);
  });
});
