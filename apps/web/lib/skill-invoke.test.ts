import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseSkillCommand, buildSkillInjection } from "./skill-invoke";

// Mock prisma before importing the module under test
vi.mock("./prisma", () => ({
  prisma: {
    skillPackage: {
      findFirst: vi.fn(),
    },
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

describe("buildSkillInjection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns skill instructions for known skill", async () => {
    const { prisma } = await import("./prisma");
    vi.mocked(prisma.skillPackage.findFirst).mockResolvedValue({
      id: "1",
      slug: "commit",
      name: "Commit",
      description: "Helps with commits",
      scope: "global",
      teamId: null,
      userId: null,
      source: "",
      filePath: "",
      enabled: true,
    });

    const injection = await buildSkillInjection("commit");
    expect(injection).toBeDefined();
    expect(injection?.includes("commit")).toBe(true);
  });

  it("returns null for unknown skill", async () => {
    const { prisma } = await import("./prisma");
    vi.mocked(prisma.skillPackage.findFirst).mockResolvedValue(null);

    const injection = await buildSkillInjection("nonexistent-skill-xyz");
    expect(injection).toBeNull();
  });
});
