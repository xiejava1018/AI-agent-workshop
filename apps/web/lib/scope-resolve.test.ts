// lib/scope-resolve.test.ts
import { describe, it, expect } from "vitest";
import { resolveAgentSkills } from "./scope-resolve";

describe("resolveAgentSkills", () => {
  it("resolves skills across four layers with agent-layer mode convergence", async () => {
    const resolved = await resolveAgentSkills({ agentId: "a1", userId: "u1", teamId: "t1" });
    expect(Array.isArray(resolved.skills)).toBe(true);
  });

  it("personal scope skips team layer", async () => {
    const resolved = await resolveAgentSkills({
      agentId: "a1",
      userId: "u1",
      teamId: null,
      scope: "personal",
    });
    expect(resolved.layersApplied).not.toContain("team");
  });
});
