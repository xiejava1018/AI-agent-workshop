import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  MAX_DELEGATION_DEPTH,
  DELEGATION_DENYLIST,
  createDelegateAgentTool,
  truncateChildResult,
  getAsyncDelegateRegistry,
  AsyncDelegateEntry,
} from "./delegate-agent-tool";
import { randomUUID } from "crypto";

// Use vi.hoisted so mockSessionInner is defined at the same hoisting level as vi.mock
const { mockSessionInner, emitAgentEnd, emitAgentSettled } = vi.hoisted(() => {
  const callbacks: Array<(event: { type: string }) => void> = [];

  const inner = {
    subscribe: vi.fn((cb: (event: { type: string }) => void) => {
      callbacks.push(cb);
      return () => {
        const idx = callbacks.indexOf(cb);
        if (idx !== -1) callbacks.splice(idx, 1);
      };
    }),
    getLastAssistantText: vi.fn().mockReturnValue(""),
    prompt: vi.fn().mockResolvedValue(undefined),
    _callbacks: callbacks, // expose for emitAgentEnd
  };

  function emitAgentEnd(text = "mock output") {
    inner.getLastAssistantText.mockReturnValue(text);
    const cbs = [...callbacks];
    callbacks.length = 0;
    for (const cb of cbs) cb({ type: "agent_end" });
  }

  function emitAgentSettled(text = "") {
    inner.getLastAssistantText.mockReturnValue(text);
    const cbs = [...callbacks];
    callbacks.length = 0;
    for (const cb of cbs) cb({ type: "agent_settled" });
  }

  return { mockSessionInner: inner, emitAgentEnd, emitAgentSettled };
});

// Mock the prisma module
vi.mock("./prisma", () => ({
  prisma: {
    delegationTree: {
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({}),
    },
  },
}));

// Mock rpc-manager — returns the controlled mockSessionInner
vi.mock("./rpc-manager", () => {
  const mockSession = {
    inner: mockSessionInner,
    sessionId: "test-child-session",
  };
  return {
    startRpcSession: vi.fn().mockResolvedValue({
      session: mockSession,
      realSessionId: "test-child-session",
    }),
  };
});

import { startRpcSession } from "./rpc-manager";

describe("delegate-agent-tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionInner.getLastAssistantText.mockReturnValue("");
    mockSessionInner.prompt.mockResolvedValue(undefined);
  });

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

    it("declares maxConcurrent and tasks parameters for parallel mode", () => {
      const tool = createDelegateAgentTool({
        rootSessionId: "r1",
        userId: "u1",
        teamId: "t1",
        depth: 0,
      });

      const params = tool.parameters as unknown as {
        properties?: Record<string, unknown>;
      };
      expect(params.properties?.maxConcurrent).toBeDefined();
      expect(params.properties?.tasks).toBeDefined();
    });
  });

  describe("AsyncDelegateRegistry", () => {
    it("create returns a new entry with running status and a taskId", () => {
      const registry = getAsyncDelegateRegistry();
      const entry = registry.create("child-session-1");
      expect(entry.taskId).toBeDefined();
      expect(entry.taskId.length).toBeGreaterThan(0);
      expect(entry.childSessionId).toBe("child-session-1");
      expect(entry.status).toBe("running");
    });

    it("complete updates the entry status to done and stores output", () => {
      const registry = getAsyncDelegateRegistry();
      const entry = registry.create("child-session-2");
      registry.complete(entry.taskId, "test output");
      const updated = registry.get(entry.taskId);
      expect(updated?.status).toBe("done");
      expect(updated?.output).toBe("test output");
    });

    it("fail updates the entry status to error and stores error", () => {
      const registry = getAsyncDelegateRegistry();
      const entry = registry.create("child-session-3");
      registry.fail(entry.taskId, "something went wrong");
      const updated = registry.get(entry.taskId);
      expect(updated?.status).toBe("error");
      expect(updated?.error).toBe("something went wrong");
    });

    it("poll returns undefined for running tasks", () => {
      const registry = getAsyncDelegateRegistry();
      const entry = registry.create("child-session-4");
      expect(registry.poll(entry.taskId)).toBeUndefined();
    });

    it("poll returns the entry when task is done", () => {
      const registry = getAsyncDelegateRegistry();
      const entry = registry.create("child-session-5");
      registry.complete(entry.taskId, "result");
      const polled = registry.poll(entry.taskId);
      expect(polled).toBeDefined();
      expect(polled?.status).toBe("done");
      expect(polled?.output).toBe("result");
    });

    it("poll returns the entry when task has errored", () => {
      const registry = getAsyncDelegateRegistry();
      const entry = registry.create("child-session-6");
      registry.fail(entry.taskId, "failed");
      const polled = registry.poll(entry.taskId);
      expect(polled).toBeDefined();
      expect(polled?.status).toBe("error");
      expect(polled?.error).toBe("failed");
    });
  });

  describe("execute — sync mode", () => {
    it("depth 0 tool returns a result with childSessionId on agent_end", async () => {
      const tool = createDelegateAgentTool({
        rootSessionId: "r1",
        userId: "u1",
        teamId: "t1",
        depth: 0,
      });

      // Manually trigger prompt resolution and agent_end event to unblock the settled promise.
      // This lets us control the sequencing without relying on microtask ordering.
      mockSessionInner.prompt.mockImplementationOnce(() => {
        // After prompt is called, synchronously emit agent_end
        mockSessionInner.getLastAssistantText.mockReturnValue("sync result");
        const cbs = [...mockSessionInner._callbacks];
        for (const cb of cbs) cb({ type: "agent_end" });
        return Promise.resolve();
      });

      const result = await (tool.execute as Function)(
        "call-1",
        { agentId: "agent-1", task: "do the thing" },
        undefined,
        undefined,
        { cwd: "/tmp" },
      );

      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      if (!parsed.ok) console.error("sync test result:", parsed);
      expect(parsed.ok).toBe(true);
      expect(parsed.childSessionId).toBe("test-child-session");
      expect(parsed.output).toBe("sync result");
    }, 10000);

    it("depth >= MAX_DELEGATION_DEPTH returns error without spawning", async () => {
      const tool = createDelegateAgentTool({
        rootSessionId: "r1",
        userId: "u1",
        teamId: "t1",
        depth: MAX_DELEGATION_DEPTH,
      });

      const result = await (tool.execute as Function)(
        "call-1",
        { agentId: "agent-1", task: "do the thing" },
        undefined,
        undefined,
        { cwd: "/tmp" },
      );

      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain("exceeds MAX_DELEGATION_DEPTH");
      // startRpcSession should not have been called
      expect(startRpcSession).not.toHaveBeenCalled();
    });

    it("aborted signal returns error before spawning", async () => {
      const tool = createDelegateAgentTool({
        rootSessionId: "r1",
        userId: "u1",
        teamId: "t1",
        depth: 0,
      });

      const ac = new AbortController();
      ac.abort();

      const result = await (tool.execute as Function)(
        "call-1",
        { agentId: "agent-1", task: "do the thing" },
        ac.signal,
        undefined,
        { cwd: "/tmp" },
      );

      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain("aborted");
    });

    it("passes DELEGATION_DENYLIST as excludeTools to startRpcSession", async () => {
      const tool = createDelegateAgentTool({
        rootSessionId: "r1",
        userId: "u1",
        teamId: "t1",
        depth: 0,
      });

      mockSessionInner.prompt.mockImplementationOnce(() => {
        mockSessionInner.getLastAssistantText.mockReturnValue("sync result");
        const cbs = [...mockSessionInner._callbacks];
        for (const cb of cbs) cb({ type: "agent_end" });
        return Promise.resolve();
      });

      await (tool.execute as Function)(
        "call-1",
        { agentId: "agent-1", task: "do the thing" },
        undefined,
        undefined,
        { cwd: "/tmp" },
      );

      expect(startRpcSession).toHaveBeenCalledTimes(1);
      const callArgs = (startRpcSession as ReturnType<typeof vi.fn>).mock.calls[0];
      // excludeTools is the 8th positional argument
      expect(callArgs[7]).toEqual(DELEGATION_DENYLIST);
    });
  });

  describe("execute — parallel mode", () => {
    it("depth enforced in parallel mode", async () => {
      const tool = createDelegateAgentTool({
        rootSessionId: "r1",
        userId: "u1",
        teamId: "t1",
        depth: MAX_DELEGATION_DEPTH,
      });

      const result = await (tool.execute as Function)(
        "call-1",
        { agentId: "agent-1", task: "do the thing", mode: "parallel" },
        undefined,
        undefined,
        { cwd: "/tmp" },
      );

      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain("exceeds MAX_DELEGATION_DEPTH");
    });
  });

  describe("execute — async mode", () => {
    it("depth enforced in async mode", async () => {
      const tool = createDelegateAgentTool({
        rootSessionId: "r1",
        userId: "u1",
        teamId: "t1",
        depth: MAX_DELEGATION_DEPTH,
      });

      const result = await (tool.execute as Function)(
        "call-1",
        { agentId: "agent-1", task: "do the thing", mode: "async" },
        undefined,
        undefined,
        { cwd: "/tmp" },
      );

      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain("exceeds MAX_DELEGATION_DEPTH");
    });

    it("async mode returns immediately with taskId and childSessionId (no await on child)", async () => {
      const tool = createDelegateAgentTool({
        rootSessionId: "r1",
        userId: "u1",
        teamId: "t1",
        depth: 0,
      });

      const result = await (tool.execute as Function)(
        "call-1",
        { agentId: "agent-1", task: "do the thing", mode: "async" },
        undefined,
        undefined,
        { cwd: "/tmp" },
      );

      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      expect(parsed.ok).toBe(true);
      expect(parsed.taskId).toBeDefined();
      expect(parsed.taskId.length).toBeGreaterThan(0);
      expect(parsed.childSessionId).toBe("test-child-session");
      // prompt should have been called (fire and forget)
      expect(mockSessionInner.prompt).toHaveBeenCalled();
    });

    it("async registry receives backfill when agent_end fires", async () => {
      const tool = createDelegateAgentTool({
        rootSessionId: "r1",
        userId: "u1",
        teamId: "t1",
        depth: 0,
      });

      // Execute and await the immediate return
      const result = await (tool.execute as Function)(
        "call-1",
        { agentId: "agent-1", task: "do the thing", mode: "async" },
        undefined,
        undefined,
        { cwd: "/tmp" },
      );

      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      const taskId = parsed.taskId;

      // Simulate agent_end firing with output
      emitAgentEnd("async result output");

      const registry = getAsyncDelegateRegistry();
      const polled = registry.poll(taskId);
      expect(polled).toBeDefined();
      expect(polled?.status).toBe("done");
      expect(polled?.output).toBe("async result output");
    });

    it("async registry records error when prompt fails", async () => {
      const tool = createDelegateAgentTool({
        rootSessionId: "r1",
        userId: "u1",
        teamId: "t1",
        depth: 0,
      });

      // Make prompt reject
      mockSessionInner.prompt.mockRejectedValueOnce(new Error("network failure"));

      const result = await (tool.execute as Function)(
        "call-1",
        { agentId: "agent-1", task: "do the thing", mode: "async" },
        undefined,
        undefined,
        { cwd: "/tmp" },
      );

      const parsed = JSON.parse((result as { content: Array<{ text: string }> }).content[0].text);
      const taskId = parsed.taskId;

      const registry = getAsyncDelegateRegistry();
      const polled = registry.poll(taskId);
      expect(polled).toBeDefined();
      expect(polled?.status).toBe("error");
      expect(polled?.error).toBe("network failure");
    });

    it("passes DELEGATION_DENYLIST as excludeTools to startRpcSession", async () => {
      const tool = createDelegateAgentTool({
        rootSessionId: "r1",
        userId: "u1",
        teamId: "t1",
        depth: 0,
      });

      await (tool.execute as Function)(
        "call-1",
        { agentId: "agent-1", task: "do the thing", mode: "async" },
        undefined,
        undefined,
        { cwd: "/tmp" },
      );

      expect(startRpcSession).toHaveBeenCalledTimes(1);
      const callArgs = (startRpcSession as ReturnType<typeof vi.fn>).mock.calls[0];
      // excludeTools is the 8th positional argument
      expect(callArgs[7]).toEqual(DELEGATION_DENYLIST);
    });
  });

  describe("DELEGATION_DENYLIST", () => {
    it("is exported as a non-empty readonly tuple", () => {
      expect(Array.isArray(DELEGATION_DENYLIST)).toBe(true);
      expect(DELEGATION_DENYLIST.length).toBeGreaterThan(0);
    });

    it("contains delegate, remember, setGoal, and create_employee prefixes", () => {
      const entries = [...DELEGATION_DENYLIST];
      expect(entries).toContain("delegate");
      expect(entries).toContain("remember");
      expect(entries).toContain("setGoal");
      expect(entries).toContain("create_employee");
    });
  });
});
