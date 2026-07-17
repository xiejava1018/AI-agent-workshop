/**
 * Agent directory — Task 3.2 (M3 Supervisor delegation).
 *
 * Purpose
 *   The Supervisor's LLM needs to know which digital employees it may delegate
 *   to, without the user having to enumerate them by hand. `resolveAvailableAgents`
 *   returns a safe, prompt-friendly view of the agents visible to a given
 *   (teamId, userId) pair.
 *
 * Visibility rules (per design §4 + plan T3.2)
 *   - Team scope: any Agent with `scope === "team"` AND `teamId === opts.teamId`
 *     is visible to every member of that team.
 *   - Personal scope: any Agent with `scope === "personal"` AND
 *     `ownerUserId === opts.userId` is visible ONLY to its owner.
 *   - We never leak agents from other teams or other users' personal agents.
 *
 * Security contract
 *   The returned shape intentionally OMITS `systemPrompt` and any bindings:
 *   the Supervisor's LLM only needs to pick `agentId`. The full agent record
 *   (including the prompt) is loaded server-side at delegation time by
 *   `rpc-manager.startRpcSession` (Task 2.4 plumbing). This keeps the system
 *   prompt out of any LLM-facing tool description or context.
 *
 * Caller contract
 *   - `teamId` is required: a Supervisor always operates inside a team context
 *     (Task 3.1's `DelegateAgentContext` requires it).
 *   - `userId` is optional: when omitted, only team-scoped agents are returned.
 *     This is used for preview / listing endpoints that have not yet resolved
 *     a user, or for tests that only care about team scope.
 *   - The function is read-only and side-effect free.
 */

import { prisma } from "./prisma";

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

/**
 * Prompt-friendly view of an Agent that the Supervisor LLM may pick from.
 *
 * Keep this small. The full row (systemPrompt, bindings, etc.) is loaded later
 * by `startRpcSession`; everything in this struct is safe to embed in a tool
 * description or function-call argument.
 */
export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  model: string;
  scope: string;
}

export interface ResolveAvailableAgentsOptions {
  /** Team the Supervisor session is bound to. Required. */
  teamId: string;
  /**
   * Owner of the Supervisor session. When provided, personal agents owned by
   * this user are also included. When omitted, only team-scoped agents are
   * returned.
   */
  userId?: string;
}

// ----------------------------------------------------------------------------
// Implementation
// ----------------------------------------------------------------------------

/**
 * Return the list of digital employees visible to a Supervisor session.
 *
 * Ordering: team-scoped agents first (deterministic order by id ASC), then
 * personal agents (also by id ASC). Stable order matters so the LLM gets
 * the same menu across turns within the same session.
 */
export async function resolveAvailableAgents(
  opts: ResolveAvailableAgentsOptions,
): Promise<AgentInfo[]> {
  if (!opts.teamId) {
    // Defensive: a missing teamId means we cannot scope team agents safely.
    // Surface as an empty list rather than throwing — callers may want to
    // gracefully degrade in test or preview contexts.
    return [];
  }

  const teamWhere = {
    scope: "team",
    teamId: opts.teamId,
  } as const;

  // Personal agents only join the result when the caller passed a userId.
  // We compose the two queries in parallel — each is a small index-backed
  // scan (Agent has indexes on teamId and ownerUserId, see schema.prisma).
  type AgentRow = {
    id: string;
    name: string;
    description: string;
    model: string;
    scope: string;
  };

  const teamPromise: Promise<AgentRow[]> = prisma.agent.findMany({
    where: teamWhere,
    orderBy: { id: "asc" },
    select: { id: true, name: true, description: true, model: true, scope: true },
  });

  const personalPromise: Promise<AgentRow[]> = opts.userId
    ? prisma.agent.findMany({
        where: { scope: "personal", ownerUserId: opts.userId },
        orderBy: { id: "asc" },
        select: { id: true, name: true, description: true, model: true, scope: true },
      })
    : Promise.resolve([]);

  const [teamRows, personalRows] = await Promise.all([teamPromise, personalPromise]);

  return [...toAgentInfo(teamRows), ...toAgentInfo(personalRows)];
}

// ----------------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------------

/**
 * Project a raw `Agent` row down to the LLM-facing `AgentInfo` shape.
 *
 * Centralized so the security contract (`systemPrompt` MUST NOT leak) lives
 * in one place. Adding a new visible field requires touching this function
 * and the `AgentInfo` interface together.
 */
function toAgentInfo(
  rows: Array<{
    id: string;
    name: string;
    description: string;
    model: string;
    scope: string;
  }>,
): AgentInfo[] {
  const out: AgentInfo[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    out[i] = {
      id: r.id,
      name: r.name,
      description: r.description,
      model: r.model,
      scope: r.scope,
    };
  }
  return out;
}
