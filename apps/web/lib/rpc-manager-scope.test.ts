import { describe, expect, it } from "vitest";
import { computeScopeHash, type ScopeSet } from "./rpc-manager";

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

// Suppress unused warning for type-only import in older TS configs
const _typeProbe: ScopeSet = { skills: [], mcpServers: [] };
void _typeProbe;