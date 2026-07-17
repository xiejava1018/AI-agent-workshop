import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseSkillCommand, buildSkillInjection, safeReadSkillFile } from "./skill-invoke";

// Mock prisma
vi.mock("./prisma", () => ({
  prisma: {
    skillPackage: {
      findFirst: vi.fn(),
    },
    skillInvocation: {
      create: vi.fn(),
    },
  },
}));

// Mock fs
vi.mock("fs", () => ({
  default: {
    readFileSync: vi.fn(),
  },
}));

describe("parseSkillCommand", () => {
  it("extracts skill name from /<skill> prefix", () => {
    const result = parseSkillCommand("/commit fix this code");
    expect(result?.skillName).toBe("commit");
    expect(result?.remainingInput).toBe("fix this code");
  });

  it("returns null for non-skill input", () => {
    const result = parseSkillCommand("hello world");
    expect(result).toBeNull();
  });

  it("handles skill with @ prefix (@MCP)", () => {
    const result = parseSkillCommand("@fs read /tmp");
    expect(result?.skillName).toBe("fs");
    expect(result?.remainingInput).toBe("read /tmp");
  });
});

describe("safeReadSkillFile", () => {
  it("returns null for empty filePath", () => {
    expect(safeReadSkillFile("")).toBeNull();
    expect(safeReadSkillFile(null as any)).toBeNull();
    expect(safeReadSkillFile(undefined as any)).toBeNull();
  });

  it("returns null for path traversal attempts", () => {
    // These should be rejected as they escape SKILLS_ROOT
    expect(safeReadSkillFile("/etc/passwd")).toBeNull();
    expect(safeReadSkillFile("../../../etc/passwd")).toBeNull();
    expect(safeReadSkillFile(".skills/../../etc/passwd")).toBeNull();
  });
});

describe("buildSkillInjection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockGlobalSkill = {
    id: "skill-global",
    slug: "commit",
    name: "Commit Helper",
    description: "Helps with commits",
    scope: "global",
    teamId: null as string | null,
    userId: null as string | null,
    source: "",
    filePath: ".skills/commit/SKILL.md",  // relative path within SKILLS_ROOT
    enabled: true,
  };

  it("returns skill instructions for known skill with file content", async () => {
    const { prisma } = await import("./prisma");
    const fs = await import("fs");

    vi.mocked(prisma.skillPackage.findFirst).mockResolvedValue(mockGlobalSkill as any);
    vi.mocked(fs.default.readFileSync).mockReturnValue("# Commit Instructions\nDo commit things.");
    vi.mocked(prisma.skillInvocation.create).mockResolvedValue({ 
      id: "1", skillPackageId: "skill-global", userId: null, sessionId: null, createdAt: new Date() 
    });

    const injection = await buildSkillInjection({ skillName: "commit" });
    expect(injection).toBeDefined();
    expect(injection?.includes("commit")).toBe(true);
    expect(injection?.includes("Commit Instructions")).toBe(true);
  });

  it("returns null for unknown skill", async () => {
    const { prisma } = await import("./prisma");
    vi.mocked(prisma.skillPackage.findFirst).mockResolvedValue(null);

    const injection = await buildSkillInjection({ skillName: "nonexistent-skill-xyz" });
    expect(injection).toBeNull();
  });

  it("resolves user-scoped skill when userId provided", async () => {
    const { prisma } = await import("./prisma");
    const fs = await import("fs");

    const userSkill = { ...mockGlobalSkill, id: "skill-user", scope: "user", userId: "user-123", filePath: "" };

    vi.mocked(prisma.skillPackage.findFirst).mockResolvedValue(userSkill as any);
    vi.mocked(fs.default.readFileSync).mockReturnValue("");
    vi.mocked(prisma.skillInvocation.create).mockResolvedValue({ 
      id: "2", skillPackageId: "skill-user", userId: "user-123", sessionId: null, createdAt: new Date() 
    });

    const injection = await buildSkillInjection({ skillName: "commit", userId: "user-123" });
    expect(injection).toBeDefined();
    expect(injection?.includes("commit")).toBe(true);
  });

  it("resolves team-scoped skill when teamId provided without userId", async () => {
    const { prisma } = await import("./prisma");
    const fs = await import("fs");

    const teamSkill = { ...mockGlobalSkill, id: "skill-team", scope: "team", teamId: "team-456", filePath: "" };

    // When no userId, user scope query with userId:null won't find the user skill
    // So it falls through to team scope
    vi.mocked(prisma.skillPackage.findFirst)
      .mockResolvedValueOnce(null)  // user scope returns null (no user skill with userId:null)
      .mockResolvedValueOnce(teamSkill as any);  // team scope found

    vi.mocked(fs.default.readFileSync).mockReturnValue("");
    vi.mocked(prisma.skillInvocation.create).mockResolvedValue({ 
      id: "3", skillPackageId: "skill-team", userId: null, sessionId: null, createdAt: new Date() 
    });

    const injection = await buildSkillInjection({ skillName: "commit", teamId: "team-456" });
    expect(injection).toBeDefined();
    expect(injection?.includes("commit")).toBe(true);
  });

  it("resolves user scope first when both userId and teamId provided", async () => {
    const { prisma } = await import("./prisma");
    const fs = await import("fs");

    const userSkill = { ...mockGlobalSkill, id: "skill-user", scope: "user", userId: "user-123", filePath: "" };

    vi.mocked(prisma.skillPackage.findFirst).mockResolvedValue(userSkill as any);
    vi.mocked(fs.default.readFileSync).mockReturnValue("");
    vi.mocked(prisma.skillInvocation.create).mockResolvedValue({ 
      id: "4", skillPackageId: "skill-user", userId: "user-123", sessionId: null, createdAt: new Date() 
    });

    const injection = await buildSkillInjection({ skillName: "commit", teamId: "team-456", userId: "user-123" });
    expect(injection).toBeDefined();
    expect(injection?.includes("commit")).toBe(true);
  });

  it("falls back to team scope when user scope not found", async () => {
    const { prisma } = await import("./prisma");
    const fs = await import("fs");

    const teamSkill = { ...mockGlobalSkill, id: "skill-team", scope: "team", teamId: "team-456", filePath: "" };

    vi.mocked(prisma.skillPackage.findFirst)
      .mockResolvedValueOnce(null)  // user scope - not found
      .mockResolvedValueOnce(teamSkill as any); // team scope - found

    vi.mocked(fs.default.readFileSync).mockReturnValue("");
    vi.mocked(prisma.skillInvocation.create).mockResolvedValue({ 
      id: "5", skillPackageId: "skill-team", userId: null, sessionId: null, createdAt: new Date() 
    });

    const injection = await buildSkillInjection({ skillName: "commit", teamId: "team-456", userId: "user-123" });
    expect(injection).toBeDefined();
    // Should have called at least user and team scope lookups
    expect(prisma.skillPackage.findFirst.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("falls back to global when no user or team scope found", async () => {
    const { prisma } = await import("./prisma");
    const fs = await import("fs");

    vi.mocked(prisma.skillPackage.findFirst)
      .mockResolvedValueOnce(null)  // user scope - not found
      .mockResolvedValueOnce(null)  // team scope - not found
      .mockResolvedValueOnce(mockGlobalSkill as any); // global - found

    vi.mocked(fs.default.readFileSync).mockReturnValue("");
    vi.mocked(prisma.skillInvocation.create).mockResolvedValue({ 
      id: "6", skillPackageId: "skill-global", userId: null, sessionId: null, createdAt: new Date() 
    });

    const injection = await buildSkillInjection({ skillName: "commit", teamId: "team-456", userId: "user-123" });
    expect(injection).toBeDefined();
    // Should have called all three scopes
    expect(prisma.skillPackage.findFirst.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("writes SkillInvocation audit log with userId and sessionId", async () => {
    const { prisma } = await import("./prisma");
    const fs = await import("fs");

    vi.mocked(prisma.skillPackage.findFirst).mockResolvedValue(mockGlobalSkill as any);
    vi.mocked(fs.default.readFileSync).mockReturnValue("");
    vi.mocked(prisma.skillInvocation.create).mockResolvedValue({ 
      id: "7", skillPackageId: "skill-global", userId: "user-123", sessionId: "session-789", createdAt: new Date() 
    });

    await buildSkillInjection({ skillName: "commit", userId: "user-123", sessionId: "session-789" });

    expect(prisma.skillInvocation.create).toHaveBeenCalledWith({
      data: {
        skillPackageId: "skill-global",
        userId: "user-123",
        sessionId: "session-789",
      },
    });
  });

  it("handles missing file gracefully", async () => {
    const { prisma } = await import("./prisma");
    const fs = await import("fs");

    vi.mocked(prisma.skillPackage.findFirst).mockResolvedValue(mockGlobalSkill as any);
    vi.mocked(fs.default.readFileSync).mockImplementation(() => {
      throw new Error("File not found");
    });
    vi.mocked(prisma.skillInvocation.create).mockResolvedValue({ 
      id: "8", skillPackageId: "skill-global", userId: null, sessionId: null, createdAt: new Date() 
    });

    const injection = await buildSkillInjection({ skillName: "commit" });
    expect(injection).toBeDefined();
    expect(injection?.includes("commit")).toBe(true);
  });

  it("handles SkillInvocation create failure gracefully", async () => {
    const { prisma } = await import("./prisma");
    const fs = await import("fs");

    vi.mocked(prisma.skillPackage.findFirst).mockResolvedValue(mockGlobalSkill as any);
    vi.mocked(fs.default.readFileSync).mockReturnValue("");
    vi.mocked(prisma.skillInvocation.create).mockRejectedValue(new Error("DB error"));

    // Should not throw, should still return injection
    const injection = await buildSkillInjection({ skillName: "commit", userId: "user-123" });
    expect(injection).toBeDefined();
    expect(injection?.includes("commit")).toBe(true);
  });
});
