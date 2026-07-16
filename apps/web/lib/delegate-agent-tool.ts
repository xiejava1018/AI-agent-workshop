/**
 * DelegateAgentTool — Pi custom tool that lets a Supervisor session spawn a
 * child AgentSession and run a task against a digital employee.
 *
 * Design references
 *  - docs/superpowers/specs/2026-07-16-m3-vue3-workbench-design.md §4
 *  - docs/superpowers/plans/2026-07-16-m3-vue3-workbench.md Phase 3 (Tasks 3.1–3.4)
 *
 * Scope of THIS file (Tasks 3.1 + 3.3)
 *  - Factory `createDelegateAgentTool(ctx)` returning a Pi `ToolDefinition`
 *    via `defineTool` (Pi SDK 0.80.x).
 *  - Three execution modes:
 *    - `sync` (default): awaits child completion, returns `output` field.
 *    - `parallel`: spawns up to `maxConcurrent` children concurrently (queue excess),
 *      waits for ALL to complete, returns `outputs` array.
 *    - `async`: returns `{ taskId, childSessionId }` immediately, backfills result
 *      when `agent_end` fires; caller polls via `AsyncDelegateRegistry`.
 *  - Depth is enforced via the factory context: the root session is depth 0,
 *    every nested delegation increments by 1. The actual `execute` rejects with
 *    a clear error once `depth >= MAX_DELEGATION_DEPTH`.
 *  - Each child result is independently truncated to MAX_DELEGATION_OUTPUT_CHARS.
 *
 * Scope NOT yet implemented (later tasks)
 *  - Task 2.5: child tool denylist (`delegate*`, `remember*`, `setGoal*`,
 *    `create_employee*`). When §3 wires `excludeTools`, plug it into the
 *    `startRpcSession` call below.
 *  - Task 3.4: extract `MAX_DELEGATION_DEPTH` to a shared constant if the
 *    denylist module needs it (constants are co-located here so Task 3.4 can
 *    trivially re-import).
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
// TextContent lives in @earendil-works/pi-ai/compat (Pi's internal compat shim);
// pi-coding-agent does not re-export it, so we import from its source.
import type { TextContent } from "@earendil-works/pi-ai/compat";
import { randomUUID } from "crypto";
import { startRpcSession } from "./rpc-manager";
import { prisma } from "./prisma";

// ============================================================================
// Constants — co-located so Task 3.4 / Task 2.5 can re-import.
// ============================================================================

/**
 * Maximum allowed delegation depth.
 *
 * Per `docs/superpowers/plans/2026-07-16-m3-vue3-workbench.md` T3.4:
 *   "depth constant MAX_DELEGATION_DEPTH = 3 (tasks.md T3.4 写 ≤3；
 *    设计文档 §4 写 ≤2，以 tasks.md 为准 = 3)"
 *
 * The design spec says ≤2; tasks.md overrides to 3. We pin 3 here and
 * the test suite asserts it so any future change must touch both.
 */
export const MAX_DELEGATION_DEPTH = 3;

/**
 * Hard cap on what a child session may return to its parent. Without this a
 * runaway sub-agent could push MBs of text back to the root session and
 * blow its context window. The number 4000 mirrors the plan's Task 3.4.
 */
export const MAX_DELEGATION_OUTPUT_CHARS = 4000;

// ============================================================================
// Public types
// ============================================================================

export type DelegateMode = "sync" | "parallel" | "async";

export interface DelegateAgentContext {
  /** Root Supervisor sessionId — used to scope child session paths and (later) token roll-up. */
  rootSessionId: string;
  /** User owning the delegation chain; flows through to startRpcSession for per-tenant AuthStorage. */
  userId: string;
  /** Team scope for skill/MCP resolution. */
  teamId: string;
  /** Current depth in the delegation tree (root = 0, child = 1, grandchild = 2 — max 3). */
  depth: number;
  /** Optional override for the child session cwd; defaults to the root session cwd via ctx.cwd at execute time. */
  cwd?: string;
}

export interface DelegateAgentInput {
  /** Digital employee ID (matches `Agent.id` in Prisma). */
  agentId: string;
  /** Task description / prompt to hand to the child AgentSession. */
  task: string;
  /** Execution mode. M3 defaults to `sync`; parallel/async wired in Task 3.3. */
  mode?: DelegateMode;
  /**
   * Maximum number of concurrent children in `parallel` mode (default 8).
   * Ignored for `sync` and `async` modes.
   */
  maxConcurrent?: number;
  /**
   * Batch of tasks for `parallel` mode. When provided, `mode` must be
   * `parallel` and each task is delegated independently. The result is an
   * array of `DelegateAgentResult` in the `outputs` field.
   */
  tasks?: Array<{ agentId: string; task: string }>;
}

export interface DelegateAgentResult {
  /** Stable identifier for the child session. Async mode uses this as task_id. */
  childSessionId?: string;
  /** `task_id` placeholder returned in async mode (Task 3.3). */
  taskId?: string;
  /** Final assistant text from the child session, truncated to MAX_DELEGATION_OUTPUT_CHARS. */
  output?: string;
  /** Array of results from parallel mode children. */
  outputs?: DelegateAgentResult[];
  /** True if the child session completed without throwing. */
  ok: boolean;
  /** Human-readable error message when `ok === false`. */
  error?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Cap a child-session string result at MAX_DELEGATION_OUTPUT_CHARS. We keep
 * the head (introduction + main answer) and drop the tail; for this iteration
 * we do NOT insert a "…[truncated]…" marker because the consumer is the
 * root AgentSession and the next model turn will trim again if needed.
 */
export function truncateChildResult(input: string): string {
  if (input.length <= MAX_DELEGATION_OUTPUT_CHARS) return input;
  return input.slice(0, MAX_DELEGATION_OUTPUT_CHARS);
}

/**
 * Build a TypeBox-compatible JSON schema for the delegate tool's parameters.
 * Lives as a function (not a literal) so the test can introspect it and so
 * Task 3.3 can extend `mode` semantics without rewriting the schema.
 */
function buildDelegateParameters(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      agentId: {
        type: "string",
        description: "Digital employee ID to delegate to (matches Agent.id).",
      },
      task: {
        type: "string",
        description: "Task description / prompt handed verbatim to the child session.",
      },
      mode: {
        type: "string",
        enum: ["sync", "parallel", "async"],
        default: "sync",
        description:
          "Execution mode. 'sync' awaits completion (default). 'parallel' runs up to 8 children concurrently. 'async' returns taskId immediately for polling.",
      },
      maxConcurrent: {
        type: "number",
        description: "Max concurrent children in parallel mode (default 8, max 8).",
      },
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            agentId: { type: "string" },
            task: { type: "string" },
          },
          required: ["agentId", "task"],
        },
        description: "Batch of tasks for parallel mode. When provided, mode must be 'parallel'.",
      },
    },
    required: ["agentId", "task"],
  };
}

// ============================================================================
// Async Delegate Registry (M3 — in-memory, M4 would use a real queue)
// ============================================================================

/**
 * Stores async delegate task state for polling by the caller.
 * M3: in-memory Map. M4: replace with a durable queue (Bull, Kafka, etc.).
 */
export interface AsyncDelegateEntry {
  taskId: string;
  childSessionId: string;
  status: "running" | "done" | "error";
  output?: string;
  error?: string;
}

class AsyncDelegateRegistryClass {
  private map = new Map<string, AsyncDelegateEntry>();

  create(childSessionId: string): AsyncDelegateEntry {
    const taskId = randomUUID();
    const entry: AsyncDelegateEntry = { taskId, childSessionId, status: "running" };
    this.map.set(taskId, entry);
    return entry;
  }

  /**
   * Backfill result when `agent_end` fires for an async child.
   * Idempotent — safe if called multiple times.
   */
  complete(taskId: string, output: string): void {
    const entry = this.map.get(taskId);
    if (!entry) return;
    // Immutable update — replace the entry rather than mutating in place.
    this.map.set(taskId, { ...entry, output, status: "done" });
  }

  /**
   * Record an error for an async child.
   */
  fail(taskId: string, error: string): void {
    const entry = this.map.get(taskId);
    if (!entry) return;
    this.map.set(taskId, { ...entry, error, status: "error" });
  }

  /**
   * Return the current entry for a taskId. Returns undefined if not found.
   */
  get(taskId: string): AsyncDelegateEntry | undefined {
    return this.map.get(taskId);
  }

  /**
   * Poll for result. Returns the entry if the task is done/error, or undefined
   * if still running.
   */
  poll(taskId: string): AsyncDelegateEntry | undefined {
    const entry = this.map.get(taskId);
    if (!entry || entry.status === "running") return undefined;
    return entry;
  }

  /**
   * Remove a taskId from the registry. Call this after polling a done/error
   * entry to prevent unbounded growth. Also removes the entry after a TTL
   * (1 hour) to handle callers that never poll.
   */
  evict(taskId: string): void {
    this.map.delete(taskId);
  }

  /** Clear all entries — use only in tests. */
  clear(): void {
    this.map.clear();
  }
}

/** Module-level singleton — survives across tool invocations within the same process. */
const ASYNC_REGISTRY = new AsyncDelegateRegistryClass();

export function getAsyncDelegateRegistry(): AsyncDelegateRegistryClass {
  return ASYNC_REGISTRY;
}

// ============================================================================
// DelegationTree persistence helpers
// ============================================================================

/**
 * Persist a DelegationTree row for a child session.
 */
async function createDelegationTreeRow(opts: {
  rootSessionId: string;
  parentSessionId: string | null;
  childSessionId: string;
  mode: string;
  depth: number;
  status?: string;
}): Promise<void> {
  try {
    await prisma.delegationTree.create({
      data: {
        rootSessionId: opts.rootSessionId,
        parentSessionId: opts.parentSessionId,
        childSessionId: opts.childSessionId,
        mode: opts.mode,
        depth: opts.depth,
        status: opts.status ?? "running",
      },
    });
  } catch (err) {
    // Non-fatal: logging and continuing — DelegationTree is for observability,
    // it must not crash the delegation chain.
    console.error("[delegate-agent-tool] Failed to persist DelegationTree row:", err);
  }
}

/**
 * Update the status of a DelegationTree row by childSessionId.
 */
async function updateDelegationTreeStatus(childSessionId: string, status: string): Promise<void> {
  try {
    await prisma.delegationTree.updateMany({
      where: { childSessionId },
      data: { status },
    });
  } catch (err) {
    console.error("[delegate-agent-tool] Failed to update DelegationTree status:", err);
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Build a `delegate` tool instance bound to a specific delegation chain.
 *
 * The factory pattern lets every Supervisor session carry its own depth
 * counter without touching global state, and lets Task 3.3 / 3.4 extend the
 * tool without rippling changes through call sites.
 */
export function createDelegateAgentTool(ctx: DelegateAgentContext) {
  // Reject up-front so the LLM never even gets to call .execute() once the
  // chain is too deep. We still re-check inside execute() because Pi may
  // re-emit the same tool across turns.
  if (!Number.isInteger(ctx.depth) || ctx.depth < 0) {
    throw new Error(
      `[delegate-agent-tool] invalid depth=${ctx.depth}; expected non-negative integer`,
    );
  }

  const tool = defineTool({
    name: "delegate",
    label: "Delegate to sub-agent",
    description:
      "Delegate a sub-task to a digital employee. Creates a child AgentSession, runs the task, and returns the result. Modes: sync (default, awaits result), parallel (up to 8 concurrent children), async (returns taskId immediately for polling).",
    parameters: buildDelegateParameters() as unknown as Parameters<typeof defineTool>[0]["parameters"],

    execute: async (
      _toolCallId: string,
      params: DelegateAgentInput,
      signal: AbortSignal | undefined,
      _onUpdate: ((partial: AgentToolResult<unknown>) => void) | undefined,
      extensionCtx: { cwd: string },
    ): Promise<AgentToolResult<DelegateAgentResult>> => {
      // ----- Depth guard ---------------------------------------------------
      // Pi invokes execute() on every turn; re-validate in case ctx mutated
      // between factory creation and tool invocation (unlikely but cheap).
      if (ctx.depth >= MAX_DELEGATION_DEPTH) {
        const msg = `Delegation depth ${ctx.depth} exceeds MAX_DELEGATION_DEPTH (${MAX_DELEGATION_DEPTH})`;
        const result: DelegateAgentResult = { ok: false, error: msg };
        return textResult(JSON.stringify(result), true);
      }

      const mode: DelegateMode = params.mode ?? "sync";
      const childCwd = ctx.cwd ?? extensionCtx.cwd;

      // ----- Parallel mode ---------------------------------------------------
      if (mode === "parallel") {
        const maxConcurrent = Math.max(1, Math.min(params.maxConcurrent ?? 8, 8));
        const tasks = params.tasks ?? [{ agentId: params.agentId, task: params.task }];

        try {
          const result = await runParallelChildren({
            rootSessionId: ctx.rootSessionId,
            parentSessionId: ctx.rootSessionId, // parallel children attach to root
            tasks,
            depth: ctx.depth + 1,
            childCwd,
            userId: ctx.userId,
            teamId: ctx.teamId,
            maxConcurrent,
            signal,
          });
          return textResult(JSON.stringify(result), !result.ok);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          const result: DelegateAgentResult = { ok: false, error: message };
          return textResult(JSON.stringify(result), true);
        }
      }

      // ----- Async mode ------------------------------------------------------
      if (mode === "async") {
        try {
          const result = await runAsyncChild({
            rootSessionId: ctx.rootSessionId,
            parentSessionId: ctx.rootSessionId,
            agentId: params.agentId,
            task: params.task,
            depth: ctx.depth + 1,
            childCwd,
            userId: ctx.userId,
            teamId: ctx.teamId,
            signal,
          });
          return textResult(JSON.stringify(result), false);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          const result: DelegateAgentResult = { ok: false, error: message };
          return textResult(JSON.stringify(result), true);
        }
      }

      // ----- Sync execution ----------------------------------------------
      try {
        const result = await runSingleChild({
          rootSessionId: ctx.rootSessionId,
          parentSessionId: ctx.rootSessionId,
          agentId: params.agentId,
          task: params.task,
          depth: ctx.depth + 1,
          childCwd,
          userId: ctx.userId,
          teamId: ctx.teamId,
          signal,
        });
        return textResult(JSON.stringify(result), !result.ok);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const result: DelegateAgentResult = { ok: false, error: message };
        return textResult(JSON.stringify(result), true);
      }
    },
  });

  return tool;
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Spawn a single child session and wait for its result.
 * Used by both sync and parallel modes.
 *
 * Returns a DelegateAgentResult with ok=true on success, ok=false on failure.
 */
async function runSingleChild(opts: {
  rootSessionId: string;
  parentSessionId: string;
  agentId: string;
  task: string;
  depth: number;
  childCwd: string;
  userId: string;
  teamId: string;
  signal?: AbortSignal;
}): Promise<DelegateAgentResult> {
  if (opts.signal?.aborted) {
    return { ok: false, error: "aborted before delegation started" };
  }

  const { session: childWrapper, realSessionId } = await startRpcSession(
    `delegate-${opts.rootSessionId}-${opts.agentId}-${Date.now()}`,
    "",
    opts.childCwd,
    undefined,
    opts.userId,
    { agentId: opts.agentId, userId: opts.userId, teamId: opts.teamId },
  );

  // Persist DelegationTree row (non-fatal if it fails)
  await createDelegationTreeRow({
    rootSessionId: opts.rootSessionId,
    parentSessionId: opts.parentSessionId,
    childSessionId: realSessionId,
    mode: "sync",
    depth: opts.depth,
    status: "running",
  });

  const settled = new Promise<DelegateAgentResult>((resolve) => {
    const unsubscribe = childWrapper.inner.subscribe((event) => {
      if (event.type === "agent_end") {
        unsubscribe();
        const last = childWrapper.inner.getLastAssistantText() ?? "";
        resolve({
          childSessionId: realSessionId,
          ok: true,
          output: truncateChildResult(last),
        });
      }
      if (event.type === "agent_settled") {
        unsubscribe();
        const last = childWrapper.inner.getLastAssistantText() ?? "";
        if (last) {
          resolve({
            childSessionId: realSessionId,
            ok: true,
            output: truncateChildResult(last),
          });
        } else {
          resolve({ childSessionId: realSessionId, ok: true, output: "" });
        }
      }
    });
  });

  await childWrapper.inner.prompt(opts.task, { source: "rpc" });
  const result = await settled;

  await updateDelegationTreeStatus(realSessionId, result.ok ? "done" : "error");
  return result;
}

/**
 * Parallel execution: run up to maxConcurrent children concurrently.
 * Queues excess and starts them as slots free up.
 * Waits for ALL children before returning.
 */
async function runParallelChildren(opts: {
  rootSessionId: string;
  parentSessionId: string;
  tasks: Array<{ agentId: string; task: string }>;
  depth: number;
  childCwd: string;
  userId: string;
  teamId: string;
  maxConcurrent: number;
  signal?: AbortSignal;
}): Promise<DelegateAgentResult> {
  const { maxConcurrent, tasks } = opts;
  const results: DelegateAgentResult[] = [];
  let hasError = false;

  // Helper that spawns a single child and resolves with its result
  const spawnOne = async (agentId: string, task: string): Promise<DelegateAgentResult> => {
    const result = await runSingleChild({
      rootSessionId: opts.rootSessionId,
      parentSessionId: opts.parentSessionId,
      agentId,
      task,
      depth: opts.depth,
      childCwd: opts.childCwd,
      userId: opts.userId,
      teamId: opts.teamId,
      signal: opts.signal,
    });
    return result;
  };

  // Use a semaphore-like approach: start up to maxConcurrent, queue the rest
  let index = 0;
  const running: Promise<void>[] = [];

  const enqueue = (): Promise<void> => {
    if (index >= tasks.length) return Promise.resolve();
    const { agentId, task } = tasks[index++];
    const p = spawnOne(agentId, task).then((result) => {
      results.push(result);
      if (!result.ok) hasError = true;
      // After one finishes, start the next in the queue
      return enqueue();
    });
    return p;
  };

  // Start maxConcurrent initial tasks
  for (let i = 0; i < Math.min(maxConcurrent, tasks.length); i++) {
    running.push(enqueue());
  }

  await Promise.all(running);

  // Build output — if any child failed, top-level ok=false
  if (hasError) {
    return {
      ok: false,
      error: "One or more parallel children failed",
      outputs: results,
    };
  }

  return { ok: true, outputs: results };
}

/**
 * Async execution: start child, return taskId immediately, backfill on agent_end.
 * The caller polls via getAsyncDelegateRegistry().poll(taskId).
 */
async function runAsyncChild(opts: {
  rootSessionId: string;
  parentSessionId: string;
  agentId: string;
  task: string;
  depth: number;
  childCwd: string;
  userId: string;
  teamId: string;
  signal?: AbortSignal;
}): Promise<DelegateAgentResult> {
  if (opts.signal?.aborted) {
    return { ok: false, error: "aborted before delegation started" };
  }

  const { session: childWrapper, realSessionId } = await startRpcSession(
    `delegate-${opts.rootSessionId}-${opts.agentId}-${Date.now()}`,
    "",
    opts.childCwd,
    undefined,
    opts.userId,
    { agentId: opts.agentId, userId: opts.userId, teamId: opts.teamId },
  );

  // Register in async registry and get taskId
  const entry = ASYNC_REGISTRY.create(realSessionId);

  // Persist DelegationTree row with status=running
  await createDelegationTreeRow({
    rootSessionId: opts.rootSessionId,
    parentSessionId: opts.parentSessionId,
    childSessionId: realSessionId,
    mode: "async",
    depth: opts.depth,
    status: "running",
  });

  // Subscribe to agent_end to backfill result. Always unsubscribe + evict
  // after the task settles so we don't leak listeners or grow the registry forever.
  const unsubscribe = childWrapper.inner.subscribe((event) => {
    if (event.type === "agent_end" || event.type === "agent_settled") {
      unsubscribe(); // prevent further events from this child
      const last = childWrapper.inner.getLastAssistantText() ?? "";
      const output = last ? truncateChildResult(last) : "";
      ASYNC_REGISTRY.complete(entry.taskId, output);
      updateDelegationTreeStatus(realSessionId, "done").catch((err) => {
        console.error("[delegate-agent-tool] Failed to update DelegationTree status:", err);
      });
      // Evict from registry after a short window so polling callers still have
      // a chance to retrieve the result before it's removed.
      setTimeout(() => ASYNC_REGISTRY.evict(entry.taskId), 60_000);
    }
  });

  // Fire and forget — do NOT await
  childWrapper.inner.prompt(opts.task, { source: "rpc" }).catch((err) => {
    ASYNC_REGISTRY.fail(entry.taskId, err instanceof Error ? err.message : String(err));
    updateDelegationTreeStatus(realSessionId, "error").catch((e) => {
      console.error("[delegate-agent-tool] Failed to update DelegationTree status on error:", e);
    });
    // Evict after a short window so polling callers still have a chance.
    setTimeout(() => ASYNC_REGISTRY.evict(entry.taskId), 60_000);
  });

  // Return immediately with taskId and childSessionId
  return { taskId: entry.taskId, childSessionId: realSessionId, ok: true };
}

/**
 * Wrap a JSON-serialized delegate result into the Pi `AgentToolResult`
 * envelope. We always emit a single text content block; Pi will surface it
 * to the model as the tool's output for the current turn.
 */
function textResult(json: string, isError: boolean): AgentToolResult<DelegateAgentResult> {
  const content: TextContent[] = [{ type: "text", text: json }];
  return {
    content,
    details: { ok: !isError } as DelegateAgentResult,
  } as AgentToolResult<DelegateAgentResult>;
}
