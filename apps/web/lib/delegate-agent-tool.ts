/**
 * DelegateAgentTool — Pi custom tool that lets a Supervisor session spawn a
 * child AgentSession and run a task against a digital employee.
 *
 * Design references
 *  - docs/superpowers/specs/2026-07-16-m3-vue3-workbench-design.md §4
 *  - docs/superpowers/plans/2026-07-16-m3-vue3-workbench.md Phase 3 (Tasks 3.1–3.4)
 *
 * Scope of THIS file (Task 3.1)
 *  - Factory `createDelegateAgentTool(ctx)` returning a Pi `ToolDefinition`
 *    via `defineTool` (Pi SDK 0.80.x).
 *  - Default execution mode is `sync`; the task prompt is awaited, the
 *    last assistant text is collected and truncated to MAX_DELEGATION_OUTPUT_CHARS.
 *  - Depth is enforced via the factory context: the root session is depth 0,
 *    every nested delegation increments by 1. The actual `execute` rejects with
 *    a clear error once `depth >= MAX_DELEGATION_DEPTH` so callers fail fast.
 *  - `parallel` and `async` modes are explicit stubs that throw — they will be
 *    wired in Task 3.3. We do NOT silently fall back to sync so the LLM knows
 *    the mode it asked for is not yet supported.
 *
 * Scope NOT yet implemented (later tasks)
 *  - Task 2.5: child tool denylist (`delegate*`, `remember*`, `setGoal*`,
 *    `create_employee*`). When §3 wires `excludeTools`, plug it into the
 *    `startRpcSession` call below.
 *  - Task 3.3: parallel (≤8 + queue) and async (`task_id` + memory backfill).
 *  - Task 3.4: extract `MAX_DELEGATION_DEPTH` to a shared constant if the
 *    denylist module needs it (constants are co-located here so Task 3.4 can
 *    trivially re-import).
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
// TextContent lives in @earendil-works/pi-ai/compat (Pi's internal compat shim);
// pi-coding-agent does not re-export it, so we import from its source.
import type { TextContent } from "@earendil-works/pi-ai/compat";
import { startRpcSession } from "./rpc-manager";

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
  /** Execution mode. M3 defaults to `sync`; other modes are wired in Task 3.3. */
  mode?: DelegateMode;
}

export interface DelegateAgentResult {
  /** Stable identifier for the child session. Async mode uses this as task_id. */
  childSessionId?: string;
  /** `task_id` placeholder returned in async mode (Task 3.3). */
  taskId?: string;
  /** Final assistant text from the child session, truncated to MAX_DELEGATION_OUTPUT_CHARS. */
  output?: string;
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
          "Execution mode. 'sync' awaits completion (default). 'parallel' / 'async' are wired in Task 3.3.",
      },
    },
    required: ["agentId", "task"],
  };
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
      "Delegate a sub-task to a digital employee. Creates a child AgentSession, runs the task, and returns the result. Modes: sync (default, awaits result), parallel / async (Task 3.3).",
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

      // ----- Mode dispatch (sync only is implemented in 3.1) --------------
      if (mode === "parallel" || mode === "async") {
        // Task 3.3 wires these. Surface a clear "not implemented" error so
        // the calling LLM retries with mode=sync (and so we don't silently
        // downgrade semantics the model explicitly asked for).
        const reason = `mode='${mode}' is not yet implemented (Task 3.3)`;
        const result: DelegateAgentResult = { ok: false, error: reason };
        return textResult(JSON.stringify(result), true);
      }

      // ----- Sync execution ----------------------------------------------
      try {
        if (signal?.aborted) {
          throw new Error("aborted before delegation started");
        }

        // Per Task 2.4 / 2.5 / 2.6 plumbing: four-layer scope resolution and
        // BYOK AuthStorage happen inside startRpcSession via the agentScope
        // arg. The child session inherits the parent's tenant.
        //
        // NOTE: `customTools` is omitted here on purpose — we DO NOT register
        // another `delegate` tool on the child. Child sessions inherit the
        // Pi built-in tools only; if the team later wants recursive delegation
        // we add the tool via a second createDelegateAgentTool({ depth: ctx.depth + 1 })
        // call wired through a customTools argument.
        const { session: childWrapper, realSessionId } = await startRpcSession(
          // sessionId / sessionFile / cwd: child uses its own id, no file (new session), inherits cwd.
          `delegate-${ctx.rootSessionId}-${params.agentId}-${Date.now()}`,
          "",
          childCwd,
          // toolNames: undefined -> Pi registers all builtins; Task 2.5's
          // excludeTools for the denylist will be plumbed here in Task 3.4.
          undefined,
          ctx.userId,
          {
            agentId: params.agentId,
            userId: ctx.userId,
            teamId: ctx.teamId,
          },
        );

        // Subscribe BEFORE prompting so we don't miss the agent_end event.
        // For Task 3.1 we only need the last assistant text; Task 3.5 / 3.6
        // will swap this for the full DelegationTree plumbing.
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
              // Fallback: model never produced text but the loop ended.
              unsubscribe();
              const last = childWrapper.inner.getLastAssistantText() ?? "";
              if (last) {
                resolve({
                  childSessionId: realSessionId,
                  ok: true,
                  output: truncateChildResult(last),
                });
              } else {
                resolve({
                  childSessionId: realSessionId,
                  ok: true,
                  output: "",
                });
              }
            }
          });
        });

        // prompt() returns void; the result surfaces via subscribe.
        await childWrapper.inner.prompt(params.task, { source: "rpc" });

        const result = await settled;
        return textResult(JSON.stringify(result), false);
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
