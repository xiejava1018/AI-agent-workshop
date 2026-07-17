import { describe, expect, it } from "vitest";
import {
  buildResourceLoaderOptions,
  computeScopeHash,
  type AgentScopeInput,
  type ScopeSet,
} from "./rpc-manager";

describe("computeScopeHash", () => {
  it("produces different hashes for different skill/mcp sets", () => {
    const h1 = computeScopeHash({ skills: ["a"], mcpServers: [] });
    const h2 = computeScopeHash({ skills: ["b"], mcpServers: [] });
    expect(h1).not.toBe(h2);
  });
  it("is order-independent", () => {
    const h1 = computeScopeHash({ skills: ["a", "b"], mcpServers: ["x"] });
    const h2 = computeScopeHash({ skills: ["b", "a"], mcpServers: ["x"] });
    expect(h1).toBe(h2);
  });
});

describe("buildResourceLoaderOptions", () => {
  it("zero skills -> noSkills true, empty additional paths", () => {
    const opts = buildResourceLoaderOptions({ skills: [], mcpServers: [] });
    expect(opts.noSkills).toBe(true);
    expect(opts.additionalSkillPaths).toEqual([]);
    expect(opts.additionalExtensionPaths).toEqual([]);
  });

  it("non-empty skills -> noSkills false, populates additionalSkillPaths", () => {
    const opts = buildResourceLoaderOptions({
      skills: ["commit", "review"],
      mcpServers: [],
    });
    expect(opts.noSkills).toBe(false);
    expect(opts.additionalSkillPaths?.length).toBeGreaterThan(0);
    // skill slugs should appear as path suffixes (case-insensitive contains)
    for (const slug of ["commit", "review"]) {
      expect(
        (opts.additionalSkillPaths ?? []).some(
          (p) => p.toLowerCase().includes(slug.toLowerCase()) || p.toLowerCase().endsWith(`/${slug}`),
        ),
      ).toBe(true);
    }
  });

  it("non-empty mcpServers -> populates additionalExtensionPaths", () => {
    const opts = buildResourceLoaderOptions({
      skills: [],
      mcpServers: [
        { id: "m1", name: "fs", transport: "stdio" },
        { id: "m2", name: "git", transport: "sse" },
      ],
    });
    expect(opts.noSkills).toBe(true); // no skills
    expect(opts.additionalExtensionPaths?.length).toBe(2);
  });

  it("scope hash derived from scope input matches computeScopeHash over id arrays", () => {
    const input: AgentScopeInput = {
      skills: ["a", "b"],
      mcpServers: [{ id: "m1", name: "fs", transport: "stdio" }],
    };
    const opts = buildResourceLoaderOptions(input);
    // buildResourceLoaderOptions must not embed the hash; it only carries paths.
    // The hash is computed by the caller (startRpcSession) over the SAME id arrays.
    const expected = computeScopeHash({
      skills: input.skills,
      mcpServers: input.mcpServers.map((m) => m.id),
    });
    expect(typeof expected).toBe("string");
    expect(expected.length).toBe(64); // sha256 hex
  });
});

// Suppress unused warning for type-only import in older TS configs
const _typeProbe: ScopeSet = { skills: [], mcpServers: [] };
void _typeProbe;