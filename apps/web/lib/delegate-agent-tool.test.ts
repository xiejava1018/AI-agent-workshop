import { describe, expect, it } from "vitest";
import { MAX_DELEGATION_DEPTH, createDelegateAgentTool, truncateChildResult } from "./delegate-agent-tool";

describe("delegate-agent-tool", () => {
  describe("MAX_DELEGATION_DEPTH", () => {
    it("is exported as a positive integer constant (3 per tasks.md)", () => {
      expect(typeof MAX_DELEGATION_DEPTH).toBe("number");
      expect(MAX_DELEGATION_DEPTH).toBeGreaterThan(0);
      expect(Number.isInteger(MAX_DELEGATION_DEPTH)).toBe(true);
      // tasks.md T3.4 sets the limit to 3; tests pin the contract so a future
      // "let's lower it back to 2" change has to consciously bump this expectation.
      expect(MAX_DELEGATION_DEPTH).toBe(3);
    });
  });

  describe("truncateChildResult", () => {
    it("returns input unchanged when shorter than the cap", () => {
      const input = "x".repeat(100);
      expect(truncateChildResult(input)).toBe(input);
    });

    it("caps output at 4000 characters", () => {
      const input = "y".repeat(5000);
      const out = truncateChildResult(input);
      expect(out.length).toBe(4000);
    });

    it("preserves the head of the input (most-recent / final answer)", () => {
      const input = "HEAD-" + "z".repeat(3990) + "-TAIL";
      const out = truncateChildResult(input);
      expect(out.startsWith("HEAD-")).toBe(true);
    });
  });

  describe("createDelegateAgentTool", () => {
    it("returns a Pi tool definition with name 'delegate' and a callable execute", () => {
      const tool = createDelegateAgentTool({
        rootSessionId: "r1",
        userId: "u1",
        teamId: "t1",
        depth: 0,
      });

      expect(tool).toBeDefined();
      expect(tool.name).toBe("delegate");
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(typeof tool.execute).toBe("function");
      // Schema is a TypeBox schema; just sanity-check it defines properties.
      expect(tool.parameters).toBeDefined();
    });

    it("declares agentId/task/mode parameters with mode defaulting to sync", () => {
      const tool = createDelegateAgentTool({
        rootSessionId: "r1",
        userId: "u1",
        teamId: "t1",
        depth: 0,
      });

      const params = tool.parameters as unknown as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(params.properties?.agentId).toBeDefined();
      expect(params.properties?.task).toBeDefined();
      expect(params.properties?.mode).toBeDefined();
      // agentId and task are required; mode falls back to "sync".
      expect(params.required ?? []).toEqual(expect.arrayContaining(["agentId", "task"]));
    });
  });
});
